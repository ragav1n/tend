-- ═══════════════════════════════════════════════════════════════════════════
-- 0003  the sync RPCs
--
-- Two functions, both SECURITY INVOKER so RLS still applies and the
-- service-role key never has to leave the server. The route handlers call them
-- with the user's cookie session.
--
-- Why route handlers plus RPCs instead of the client talking to supabase-js
-- directly, which would be less code:
--
--   * The server has to stamp time and version. A client sending its own
--     updated_at is exactly what the whole design forbids.
--   * An atomic multi-table push with foreign-key ordering has to be one
--     plpgsql function. Three round trips from the client is a partial-failure
--     window where a subtask exists and its parent does not.
--   * Field-level merge needs field_versions, which only the server holds.
--
-- The reason the cursor works at all: row_version comes from a single per-user
-- counter, so no two rows belonging to one user ever share a value, across any
-- table. That makes "row_version > cursor ordered by row_version" a total order
-- with no ties, so a page boundary can never fall in the middle of a group and
-- drop rows.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Idempotency ────────────────────────────────────────────────────────────
-- A dropped ack costs nothing: the retry finds its own mutation_id and gets the
-- original answer back instead of applying twice.

create table public.mutation_log (
  mutation_id uuid primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  result      jsonb not null,
  created_at  timestamptz not null default now()
);

alter table public.mutation_log enable row level security;

create policy mutation_log_select on public.mutation_log
  for select to authenticated using (user_id = (select auth.uid()));

create index mutation_log_gc_idx on public.mutation_log (created_at);

-- ── Shared guards ──────────────────────────────────────────────────────────

/**
 * Columns a client may never write, on any table. Sending one is not an error
 * the client can recover from mid-batch, so they are dropped silently rather
 * than raised: a stale client shipping an extra key should not fail a hundred
 * unrelated mutations queued behind it.
 */
create or replace function public.sync_server_owned_columns()
returns text[]
language sql
immutable
as $$
  select array[
    'updated_at', 'row_version', 'field_versions', 'created_at',
    'completed_at', 'depth', 'parent_depth', 'search_vector', 'user_id'
  ]::text[];
$$;

/** The tables a client is allowed to name in a push. */
create or replace function public.sync_writable_tables()
returns text[]
language sql
immutable
as $$
  select array['tasks', 'projects', 'tags', 'areas', 'task_series', 'task_tags']::text[];
$$;

-- ── Pull ───────────────────────────────────────────────────────────────────

/**
 * Everything that changed above the cursor, oldest first.
 *
 * Tasks carry their tag_ids inline, because task_tags is not its own channel
 * (see the note on that table in 0001). The array is the complete current set,
 * so the client replaces rather than merges and a lost page cannot leave a
 * half-applied tag list.
 */
create or replace function public.sync_pull(
  p_cursor bigint default 0,
  p_limit  integer default 500
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_limit  integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_rows   jsonb;
  v_taken  integer;
  v_next   bigint;
  v_more   boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  with combined as (
    select 'tasks' as tbl, t.row_version,
           (to_jsonb(t) - 'search_vector' - 'parent_depth' - 'user_id')
             || jsonb_build_object('tag_ids', coalesce(
                  (select jsonb_agg(tt.tag_id order by tt.tag_id)
                     from public.task_tags tt where tt.task_id = t.id),
                  '[]'::jsonb)) as row
      from public.tasks t
     where t.user_id = v_uid and t.row_version > p_cursor
    union all
    select 'projects', p.row_version, to_jsonb(p) - 'user_id'
      from public.projects p where p.user_id = v_uid and p.row_version > p_cursor
    union all
    select 'tags', g.row_version, to_jsonb(g) - 'user_id'
      from public.tags g where g.user_id = v_uid and g.row_version > p_cursor
    union all
    select 'areas', a.row_version, to_jsonb(a) - 'user_id'
      from public.areas a where a.user_id = v_uid and a.row_version > p_cursor
    union all
    select 'task_series', s.row_version, to_jsonb(s) - 'user_id'
      from public.task_series s where s.user_id = v_uid and s.row_version > p_cursor
    union all
    select 'user_settings', u.row_version, to_jsonb(u) - 'user_id'
      from public.user_settings u where u.user_id = v_uid and u.row_version > p_cursor
  ),
  -- One extra row is fetched purely to answer "is there more", which is
  -- cheaper and less racy than a second count over the same predicate.
  page as (
    select * from combined order by row_version limit v_limit + 1
  ),
  kept as (
    select * from page order by row_version limit v_limit
  )
  select
    coalesce(jsonb_agg(jsonb_build_object('table', tbl, 'row', row) order by row_version), '[]'::jsonb),
    count(*),
    max(row_version),
    (select count(*) from page) > v_limit
  into v_rows, v_taken, v_next, v_more
  from kept;

  return jsonb_build_object(
    'rows',    v_rows,
    -- Holding the old cursor when a page is empty matters: advancing to the
    -- table maximum would skip rows a concurrent transaction is about to commit
    -- at a lower version.
    'cursor',  coalesce(v_next, p_cursor),
    'hasMore', coalesce(v_more, false),
    'count',   coalesce(v_taken, 0)
  );
end;
$$;

-- ── Push ───────────────────────────────────────────────────────────────────

/**
 * Applies a batch of client mutations in one transaction, in array order.
 *
 * Per-field merge is the interesting part. The client sends the row_version it
 * held while editing. For each column in the patch, the server compares that
 * against field_versions: if the column has not moved since the client read it,
 * the client's value lands. If it has, the server's value stays and the column
 * name comes back in the conflict list. So one device renaming a task while
 * another retitles its notes loses neither edit, and neither device has to know
 * the other exists.
 *
 * Ordering inside the batch is the client's, which already topologically sorts
 * a task ahead of its tag rows using the deps field. The whole function is one
 * transaction, so a foreign key violation anywhere rolls the batch back rather
 * than leaving a subtask whose parent never landed.
 */
create or replace function public.sync_push(p_mutations jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_mutation   jsonb;
  v_id         uuid;
  v_table      text;
  v_entity     uuid;
  v_op         text;
  v_patch      jsonb;
  v_base       bigint;
  v_allowed    jsonb;
  v_dropped    text[];
  v_key        text;
  v_field_ver  bigint;
  v_current    jsonb;
  v_set_list   text;
  v_results    jsonb := '[]'::jsonb;
  v_cached     jsonb;
  v_cursor     bigint;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if jsonb_typeof(p_mutations) is distinct from 'array' then
    raise exception 'mutations must be an array' using errcode = '22023';
  end if;

  if jsonb_array_length(p_mutations) > 200 then
    raise exception 'batch too large' using errcode = '22023';
  end if;

  for v_mutation in select * from jsonb_array_elements(p_mutations) loop
    v_id     := (v_mutation ->> 'mutationId')::uuid;
    v_table  := v_mutation ->> 'table';
    v_entity := (v_mutation ->> 'entityId')::uuid;
    v_op     := v_mutation ->> 'op';
    v_patch  := coalesce(v_mutation -> 'patch', '{}'::jsonb);
    v_base   := coalesce((v_mutation ->> 'baseVersion')::bigint, 0);

    -- Replayed mutation. Hand back the original answer without touching a row.
    select result into v_cached from public.mutation_log where mutation_id = v_id;
    if found then
      v_results := v_results || jsonb_build_array(v_cached);
      continue;
    end if;

    if not (v_table = any (public.sync_writable_tables())) then
      raise exception 'table % is not writable', v_table using errcode = '42501';
    end if;

    v_dropped := '{}'::text[];

    -- Strip anything the client is not allowed to own, and anything that is not
    -- a real column, so the dynamic SET list below can only ever name columns
    -- that exist.
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
      into v_allowed
      from jsonb_each(v_patch)
     where key not in (select unnest(public.sync_server_owned_columns()))
       and key in (
         select column_name from information_schema.columns
          where table_schema = 'public' and table_name = v_table
       );

    if v_op = 'insert' then
      if v_table = 'task_tags' then
        insert into public.task_tags (task_id, tag_id, user_id)
        values ((v_allowed ->> 'task_id')::uuid, (v_allowed ->> 'tag_id')::uuid, v_uid)
        on conflict (task_id, tag_id) do nothing;
      else
        execute format(
          'insert into public.%I select r.* from jsonb_populate_record(null::public.%I, $1) r
             on conflict (id) do nothing',
          v_table, v_table
        ) using (v_allowed || jsonb_build_object('id', v_entity, 'user_id', v_uid));
      end if;

    elsif v_op = 'update' then
      if v_table = 'task_tags' then
        raise exception 'task_tags rows are replaced, never updated' using errcode = '22023';
      end if;

      execute format(
        'select field_versions from public.%I where id = $1 and user_id = $2', v_table
      ) into v_current using v_entity, v_uid;

      -- The row is gone, or belongs to somebody else and RLS hid it. Either way
      -- the mutation is dropped rather than raised: a delete that arrived from
      -- another device first is a normal race, not an error.
      if v_current is null then
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'mutationId', v_id, 'status', 'missing', 'entityId', v_entity));
        insert into public.mutation_log (mutation_id, user_id, result)
        values (v_id, v_uid, jsonb_build_object(
          'mutationId', v_id, 'status', 'missing', 'entityId', v_entity));
        continue;
      end if;

      for v_key in select jsonb_object_keys(v_allowed) loop
        v_field_ver := coalesce((v_current ->> v_key)::bigint, 0);
        -- Strictly greater: a field last written at exactly the version the
        -- client read is a field the client has already seen.
        if v_field_ver > v_base then
          v_allowed := v_allowed - v_key;
          v_dropped := array_append(v_dropped, v_key);
        end if;
      end loop;

      if v_allowed <> '{}'::jsonb then
        select string_agg(format('%I = p.%I', key, key), ', ')
          into v_set_list from jsonb_object_keys(v_allowed) as key;

        execute format(
          'update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) p
            where t.id = $2 and t.user_id = $3',
          v_table, v_set_list, v_table
        ) using v_allowed, v_entity, v_uid;
      end if;

    elsif v_op in ('delete', 'undelete') then
      if v_table = 'task_tags' then
        delete from public.task_tags
         where task_id = (v_patch ->> 'task_id')::uuid
           and tag_id  = (v_patch ->> 'tag_id')::uuid
           and user_id = v_uid;
      else
        -- Tombstone, never a DELETE. tasks has no delete policy at all, so this
        -- is the only shape a removal can take.
        execute format(
          'update public.%I set deleted_at = $1 where id = $2 and user_id = $3', v_table
        ) using (case when v_op = 'delete' then now() else null end), v_entity, v_uid;
      end if;

    else
      raise exception 'unknown op %', v_op using errcode = '22023';
    end if;

    v_cached := jsonb_build_object(
      'mutationId', v_id,
      'status', case when array_length(v_dropped, 1) is null then 'applied' else 'merged' end,
      'entityId', v_entity,
      'droppedFields', to_jsonb(v_dropped)
    );
    insert into public.mutation_log (mutation_id, user_id, result) values (v_id, v_uid, v_cached);
    v_results := v_results || jsonb_build_array(v_cached);
  end loop;

  select counter into v_cursor from public.user_row_version where user_id = v_uid;

  return jsonb_build_object('results', v_results, 'cursor', coalesce(v_cursor, 0));
end;
$$;

revoke all on function public.sync_pull(bigint, integer) from public;
revoke all on function public.sync_push(jsonb) from public;
grant execute on function public.sync_pull(bigint, integer) to authenticated;
grant execute on function public.sync_push(jsonb) to authenticated;

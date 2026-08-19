-- ═══════════════════════════════════════════════════════════════════════════
-- 0018  activity log
--
-- Undo needs somewhere to remember what a change replaced. The row records the
-- fields as they were and as they became, so undoing is an ordinary forward
-- mutation that writes the old values back rather than a server-side revert.
-- That matters for a sync protocol built on last-writer-wins per field: a
-- revert that skipped the outbox would be invisible to every other device.
--
-- group_id is one user gesture. Rescheduling six selected tasks writes six
-- rows sharing a group, and undo takes the whole group, because a person who
-- moved six things and pressed undo did not ask about the sixth one.
--
-- entity_id carries no foreign key, deliberately, and this is the one place in
-- the schema where that is the right call. 0017 was written because a row whose
-- parent had been superseded raised foreign_key_violation and took an entire
-- push batch to the deadletter with it. A log entry outliving the task it
-- describes is not a broken reference, it is what a log is. The composite
-- tenancy rule still holds through user_id, which is what stops one account
-- reading another's history.
--
-- undone_at rather than deleting the row: the entry is still true, it just no
-- longer stands. Undo also writes its own entries into the same group, so the
-- log reads as "this happened, then it was taken back" and the undo stack skips
-- the whole group either way.
--
-- One more thing this table forced into the open. `action` is text plus a check,
-- the way every status column in this schema is, and a check violation was not
-- caught anywhere in sync_push. So a value an older server has never heard of,
-- which is the exact rolling-deploy case the text-plus-check choice exists to
-- survive, would raise out of the whole call and take the batch to the
-- deadletter. That is 0017's bug wearing a different error code, and the update
-- arm had no guard of any kind. Both are fixed below, with status 'rejected'.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.activity_log (
  id             uuid primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,

  -- What happened. text plus a check rather than an enum, because ALTER TYPE
  -- ADD VALUE cannot be reverted and breaks a rolling deploy where an old
  -- client still writes old values.
  action         text not null check (action in (
                   'create', 'update', 'complete', 'reopen', 'delete', 'restore'
                 )),
  -- Which table the entry is about. Only tasks today; the column exists so a
  -- second one does not need a migration of the rows already here.
  entity_table   text not null default 'tasks' check (entity_table in ('tasks')),
  entity_id      uuid not null,
  -- One user gesture. A single edit is a group of one.
  group_id       uuid not null,

  -- Only the fields that moved, in local camelCase, exactly as the client will
  -- feed them back to its own mutation API. Storing the wire shape here would
  -- mean undo had to translate on the way out and could translate it wrongly.
  before         jsonb not null default '{}'::jsonb,
  after          jsonb not null default '{}'::jsonb,
  -- What to say in a toast. Rendered by the client that wrote it, so undoing on
  -- a phone can still name what it took back.
  summary        text not null default '',
  undone_at      timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  row_version    bigint not null default 0,
  field_versions jsonb  not null default '{}'::jsonb,

  unique (user_id, id)
);

alter table public.activity_log enable row level security;

create policy activity_log_select on public.activity_log
  for select to authenticated using (user_id = (select auth.uid()));

create policy activity_log_insert on public.activity_log
  for insert to authenticated with check (user_id = (select auth.uid()));

-- No delete policy, for the same reason tasks has none: a client tombstones and
-- the purge is a service_role job.
create policy activity_log_update on public.activity_log
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create trigger activity_log_stamp
  before insert or update on public.activity_log
  for each row execute function public.stamp_sync_columns();

create index activity_log_sync_idx on public.activity_log (user_id, row_version);
-- The undo stack asks one question: the newest entry still standing. Partial on
-- both flags, so the index holds only the rows that can answer it.
create index activity_log_stack_idx on public.activity_log (user_id, created_at desc)
  where deleted_at is null and undone_at is null;
-- One task's history, newest first.
create index activity_log_entity_idx on public.activity_log (user_id, entity_id, created_at desc)
  where deleted_at is null;

-- ── Sync ───────────────────────────────────────────────────────────────────

/** activity_log joins the writable list. sync_push needs nothing else: it
 *  builds every insert and update from information_schema for the named table. */
create or replace function public.sync_writable_tables()
returns text[]
language sql
immutable
as $$
  select array[
    'tasks', 'projects', 'tags', 'areas', 'task_series', 'task_tags',
    'user_settings', 'focus_sessions', 'activity_log'
  ]::text[];
$$;

/**
 * Push, reproduced whole from 0017 with two check_violation branches and a
 * guard around the update statement. `create or replace` has no partial form,
 * so the newest definition is always the whole thing. Nothing else has changed.
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
  v_col_list   text;
  v_val_list   text;
  v_status     text;
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
    -- The settings row is a singleton keyed by user_id, and the client calls it
    -- 'me'. Casting that to a uuid raises before anything else can run.
    v_entity := case
                  when v_table = 'user_settings' then null
                  else (v_mutation ->> 'entityId')::uuid
                end;
    v_op     := v_mutation ->> 'op';
    v_patch  := coalesce(v_mutation -> 'patch', '{}'::jsonb);
    v_base   := coalesce((v_mutation ->> 'baseVersion')::bigint, 0);

    select result into v_cached from public.mutation_log where mutation_id = v_id;
    if found then
      v_results := v_results || jsonb_build_array(v_cached);
      continue;
    end if;

    if not (v_table = any (public.sync_writable_tables())) then
      raise exception 'table % is not writable', v_table using errcode = '42501';
    end if;

    v_dropped := '{}'::text[];
    v_status  := null;

    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
      into v_allowed
      from jsonb_each(v_patch)
     where key not in (select unnest(public.sync_server_owned_columns()))
       and key in (
         select column_name from information_schema.columns
          where table_schema = 'public' and table_name = v_table
       );

    if v_op = 'insert' then
      if v_table = 'user_settings' then
        -- The signup trigger owns this row. A client that has never pulled still
        -- has settings to show, from its own defaults, and queues an update.
        raise exception 'user_settings is created at signup and can only be updated'
          using errcode = '22023';
      elsif v_table = 'task_tags' then
        begin
          insert into public.task_tags (task_id, tag_id, user_id)
          values ((v_allowed ->> 'task_id')::uuid, (v_allowed ->> 'tag_id')::uuid, v_uid)
          on conflict (task_id, tag_id) do nothing;
        exception when foreign_key_violation then
          -- The tag or the task is not here, which happens when the row this
          -- points at lost a uniqueness race. The task's tag_ids on the next
          -- pull is the answer, so this join row is dropped rather than retried.
          v_status := 'missing';
        end;
      else
        v_allowed := v_allowed || jsonb_build_object('id', v_entity, 'user_id', v_uid);

        -- Both lists come from one aggregation over the same keys, so the
        -- column list and the value list cannot fall out of step. Ordered
        -- anyway, because a reader should not have to know that.
        select string_agg(quote_ident(key), ', ' order by key),
               string_agg('r.' || quote_ident(key), ', ' order by key)
          into v_col_list, v_val_list
          from jsonb_object_keys(v_allowed) as key;

        begin
          execute format(
            'insert into public.%I (%s) select %s
               from jsonb_populate_record(null::public.%I, $1) r
               on conflict (id) do nothing',
            v_table, v_col_list, v_val_list, v_table
          ) using v_allowed;
        exception
          when unique_violation then
            -- Another device created this row first, under a different id. The
            -- block scopes the rollback to this one statement, so the rest of
            -- the batch still commits.
            v_status := 'superseded';
          when foreign_key_violation then
            -- The row this one hangs off is not here, which is the same thing
            -- 0004 already decided for a task_tags row: the parent lost a
            -- uniqueness race and was discarded, or its own insert died. There
            -- is no version of "later" that makes this insert work, so it is
            -- dropped rather than retried, and the batch around it commits.
            v_status := 'missing';
          when check_violation then
            -- A value this schema does not allow. The live case is a newer
            -- client writing something a not-yet-applied migration has never
            -- heard of, which is the cost of the text-plus-check choice this
            -- schema makes everywhere instead of enums. Retrying cannot help.
            v_status := 'rejected';
        end;
      end if;

    elsif v_op = 'update' then
      if v_table = 'task_tags' then
        raise exception 'task_tags rows are replaced, never updated' using errcode = '22023';
      end if;

      if v_table = 'user_settings' then
        select field_versions into v_current
          from public.user_settings where user_id = v_uid;
      else
        execute format(
          'select field_versions from public.%I where id = $1 and user_id = $2', v_table
        ) into v_current using v_entity, v_uid;
      end if;

      if v_current is null then
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'mutationId', v_id, 'status', 'missing', 'entityId', v_entity));
        insert into public.mutation_log (mutation_id, user_id, result)
        values (v_id, v_uid, jsonb_build_object(
          'mutationId', v_id, 'status', 'missing', 'entityId', v_entity));
        continue;
      end if;

      -- A client sends 0 for a row it has never seen a server version of, which
      -- only that row's author can say: a pulled row always arrives stamped. So
      -- there is no other writer to protect and every field in the patch lands.
      if v_base > 0 then
        for v_key in select jsonb_object_keys(v_allowed) loop
          v_field_ver := coalesce((v_current ->> v_key)::bigint, 0);
          -- Strictly greater: a field last written at exactly the version the
          -- client read is a field the client has already seen.
          if v_field_ver > v_base then
            v_allowed := v_allowed - v_key;
            v_dropped := array_append(v_dropped, v_key);
          end if;
        end loop;
      end if;

      if v_allowed <> '{}'::jsonb then
        select string_agg(format('%I = p.%I', key, key), ', ')
          into v_set_list from jsonb_object_keys(v_allowed) as key;

        -- The guards the insert arm has carried since 0004. An update had none,
        -- so one bad value in one patch raised out of the whole call and every
        -- unrelated row in the batch went to the deadletter with it. That is
        -- the failure 0017 fixed for inserts and did not look for here.
        begin
          if v_table = 'user_settings' then
            execute format(
              'update public.user_settings t set %s
                 from jsonb_populate_record(null::public.user_settings, $1) p
                where t.user_id = $2',
              v_set_list
            ) using v_allowed, v_uid;
          else
            execute format(
              'update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) p
                where t.id = $2 and t.user_id = $3',
              v_table, v_set_list, v_table
            ) using v_allowed, v_entity, v_uid;
          end if;
        exception
          when check_violation then
            v_status := 'rejected';
          when foreign_key_violation then
            v_status := 'missing';
        end;
      end if;

    elsif v_op in ('delete', 'undelete') then
      if v_table = 'user_settings' then
        raise exception 'user_settings has no tombstone' using errcode = '22023';
      elsif v_table = 'task_tags' then
        delete from public.task_tags
         where task_id = (v_patch ->> 'task_id')::uuid
           and tag_id  = (v_patch ->> 'tag_id')::uuid
           and user_id = v_uid;
      else
        execute format(
          'update public.%I set deleted_at = $1 where id = $2 and user_id = $3', v_table
        ) using (case when v_op = 'delete' then now() else null end), v_entity, v_uid;
      end if;

    else
      raise exception 'unknown op %', v_op using errcode = '22023';
    end if;

    v_cached := jsonb_build_object(
      'mutationId', v_id,
      'status', coalesce(
        v_status,
        case when array_length(v_dropped, 1) is null then 'applied' else 'merged' end
      ),
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

revoke all on function public.sync_push(jsonb) from public;
grant execute on function public.sync_push(jsonb) to authenticated;

/**
 * Everything that changed above the cursor, oldest first.
 *
 * Reproduced whole from 0016 with one arm added, for the same reason.
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
    union all
    select 'focus_sessions', f.row_version, to_jsonb(f) - 'user_id'
      from public.focus_sessions f where f.user_id = v_uid and f.row_version > p_cursor
    union all
    select 'activity_log', l.row_version, to_jsonb(l) - 'user_id'
      from public.activity_log l where l.user_id = v_uid and l.row_version > p_cursor
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

revoke all on function public.sync_pull(bigint, integer) from public;
grant execute on function public.sync_pull(bigint, integer) to authenticated;

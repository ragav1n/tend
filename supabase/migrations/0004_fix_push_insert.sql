-- ═══════════════════════════════════════════════════════════════════════════
-- 0004  name the columns on insert
--
-- sync_push built its insert as:
--
--   insert into public.tasks select r.* from jsonb_populate_record(...) r
--
-- With no column list Postgres maps the select positionally onto every column
-- in the table, and `tasks` has two GENERATED ALWAYS columns (parent_depth and
-- search_vector). Postgres refuses to accept any value for a generated column,
-- so every single task insert raised 42601 and no task ever reached the server.
-- The client retried, exhausted its attempts, and retired the work to its
-- deadletter.
--
-- The positional mapping is wrong a second way even without generated columns.
-- jsonb_populate_record yields NULL for every column the client did not send,
-- and an explicit NULL is not the same as omitting a column: it overrides the
-- DEFAULT rather than falling back to it. So updated_at, row_version,
-- field_versions and depth, all NOT NULL with defaults, would have been handed
-- NULLs. Naming only what the client actually sent fixes both at once and lets
-- the triggers own everything else, which is what they were written for.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── mutation_log needed an insert policy ───────────────────────────────────
--
-- 0003 enabled RLS on mutation_log and gave it a SELECT policy only. sync_push
-- is SECURITY INVOKER, by design, so that RLS applies to everything it touches
-- and the service-role key is never involved. Which means its own write to
-- mutation_log runs as the user too, and with RLS on and no INSERT policy
-- Postgres rejected it.
--
-- So every push failed at the point where it recorded its idempotency key, on
-- every table, whether or not the insert below was fixed. This was the first
-- failure; the column list was the second one waiting behind it.
--
-- Dropped first so the migration can be run more than once.

drop policy if exists mutation_log_insert on public.mutation_log;

create policy mutation_log_insert on public.mutation_log
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- ── user_row_version needed a read policy ──────────────────────────────────
--
-- 0001 enabled RLS on the counter table and never gave it a policy, so the
-- final `select counter ... into v_cursor` in sync_push read nothing and the
-- push always reported cursor 0. Harmless today, because the machine only ever
-- takes the max of the cursors it has seen and the pull is authoritative, but a
-- push that cannot say where the server got to is a push whose answer nobody
-- can use.

drop policy if exists user_row_version_select on public.user_row_version;

create policy user_row_version_select on public.user_row_version
  for select to authenticated
  using (user_id = (select auth.uid()));

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

    select result into v_cached from public.mutation_log where mutation_id = v_id;
    if found then
      v_results := v_results || jsonb_build_array(v_cached);
      continue;
    end if;

    if not (v_table = any (public.sync_writable_tables())) then
      raise exception 'table % is not writable', v_table using errcode = '42501';
    end if;

    v_dropped := '{}'::text[];

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
        v_allowed := v_allowed || jsonb_build_object('id', v_entity, 'user_id', v_uid);

        -- Both lists come from one aggregation over the same keys, so the
        -- column list and the value list cannot fall out of step. Ordered
        -- anyway, because a reader should not have to know that.
        select string_agg(quote_ident(key), ', ' order by key),
               string_agg('r.' || quote_ident(key), ', ' order by key)
          into v_col_list, v_val_list
          from jsonb_object_keys(v_allowed) as key;

        execute format(
          'insert into public.%I (%s) select %s
             from jsonb_populate_record(null::public.%I, $1) r
             on conflict (id) do nothing',
          v_table, v_col_list, v_val_list, v_table
        ) using v_allowed;
      end if;

    elsif v_op = 'update' then
      if v_table = 'task_tags' then
        raise exception 'task_tags rows are replaced, never updated' using errcode = '22023';
      end if;

      execute format(
        'select field_versions from public.%I where id = $1 and user_id = $2', v_table
      ) into v_current using v_entity, v_uid;

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

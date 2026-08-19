-- ═══════════════════════════════════════════════════════════════════════════
-- 0017  a child with no parent must not take the batch down with it
--
-- Found while reviewing 0016. focus_sessions is the first table whose foreign
-- key points at a parent that can be superseded: two devices completing the
-- same recurring occurrence both generate it, the loser's insert comes back
-- 'superseded' and the client discards its local row. A focus session written
-- against that discarded task then references a task the server does not have.
--
-- The insert raised foreign_key_violation, which is not caught, so the whole
-- sync_push call aborted. The client classifies a raise as fatal and settles the
-- WHOLE claimed batch that way, so one unsendable session killed every unrelated
-- task edit queued behind it, and requeueing them from the badge sent the same
-- batch back into the same wall. Sync stops for that device, permanently.
--
-- Confirmed against PGlite before the fix: a batch of one bad session plus one
-- innocent tag raised, and neither landed.
--
-- The answer is the one 0004 already chose for task_tags, applied to every
-- table: a parent that is not there is not a retryable condition, so the row is
-- dropped with status 'missing' and everything around it commits. The client
-- already understands that status; the local row stays, so nothing a person did
-- disappears from their own device.
--
-- Reproduced whole from 0007 with that one exception branch added. Nothing else
-- in it has changed.
-- ═══════════════════════════════════════════════════════════════════════════

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

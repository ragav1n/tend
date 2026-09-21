-- ── Mail, turned into a task ───────────────────────────────────────────────
--
-- Resend receives on a managed address, `<alias>@<id>.resend.app`, which needs
-- no DNS record at all. The webhook arrives, the sender is checked against the
-- account, and the subject becomes a task.
--
-- It reuses `ingest_task` rather than growing a second write path. The identity
-- is `mail:<message_id>`, which makes the unique index do the work a webhook
-- always needs: Resend retries on any non-2xx, and a retry must not leave two
-- copies. The never-resurrect rule comes along with it, so a captured task you
-- deleted stays deleted even if the same webhook is replayed.

-- ── Priority, which `ingest_task` could not carry ─────────────────────────
--
-- The subject goes through the same quick-add grammar the field uses, so
-- "Read chapter 4 tomorrow !p1" arrives with a priority on it. The feed had no
-- use for the column and mail does.

create or replace function public.ingest_task(p_user uuid, p_item jsonb)
returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid       text := nullif(p_item->>'feed_uid', '');
  v_title     text := coalesce(p_item->>'title', '');
  v_due_date  date := nullif(p_item->>'due_date', '')::date;
  v_due_time  time := nullif(p_item->>'due_time', '')::time;
  v_course    uuid := nullif(p_item->>'course_id', '')::uuid;
  v_notes     text := coalesce(p_item->>'notes', '');
  v_priority  smallint := coalesce((nullif(p_item->>'priority', ''))::smallint, 0);
  v_existing  public.tasks;
  v_snapshot  jsonb;
  v_next      jsonb;
  v_id        uuid;
  v_rank      text;
begin
  if v_uid is null or v_title = '' then
    return 'skipped';
  end if;

  if v_priority < 0 or v_priority > 3 then
    v_priority := 0;
  end if;

  v_next := jsonb_build_object(
    'title', v_title,
    'due_date', to_jsonb(v_due_date),
    'due_time', to_jsonb(v_due_time)
  );

  select * into v_existing
    from public.tasks
   where user_id = p_user and feed_uid = v_uid;

  if not found then
    select coalesce(max(sort_key), 'a0') into v_rank
      from public.tasks
     where user_id = p_user and coalesce(course_id::text, '') = coalesce(v_course::text, '');

    v_id := gen_random_uuid();

    insert into public.tasks (
      id, user_id, title, notes, status, due_date, due_time, priority,
      course_id, feed_uid, feed_snapshot, sort_key, planned_sort_key
    ) values (
      v_id, p_user, v_title, v_notes, 'inbox', v_due_date, v_due_time, v_priority,
      v_course, v_uid, v_next, v_rank || 'z', v_rank || 'z'
    );

    insert into public.activity_log (id, user_id, action, entity_id, group_id, after, summary)
    values (
      gen_random_uuid(), p_user, 'create', v_id, gen_random_uuid(),
      jsonb_build_object('title', v_title),
      'Imported "' || v_title || '"'
    );

    return 'inserted';
  end if;

  if v_existing.deleted_at is not null then
    return 'deleted';
  end if;

  v_snapshot := coalesce(v_existing.feed_snapshot, '{}'::jsonb);

  update public.tasks
     set title = case
                   when v_existing.title is not distinct from (v_snapshot->>'title')
                   then v_title else v_existing.title
                 end,
         due_date = case
                      when v_existing.due_date
                           is not distinct from nullif(v_snapshot->>'due_date', '')::date
                      then v_due_date else v_existing.due_date
                    end,
         due_time = case
                      when v_existing.due_time
                           is not distinct from nullif(v_snapshot->>'due_time', '')::time
                      then v_due_time else v_existing.due_time
                    end,
         course_id = coalesce(v_existing.course_id, v_course),
         feed_snapshot = v_next
   where id = v_existing.id;

  return 'updated';
end;
$$;

revoke all on function public.ingest_task(uuid, jsonb) from public, anon, authenticated;

-- ── Capturing one mail ─────────────────────────────────────────────────────
--
-- A cap, and then `ingest_task`. The cap is here rather than in the route
-- because an inbound address is unauthenticated by construction: anybody who
-- learns it can post to it, and the sender check in the route is the only thing
-- in front of it. If that check is ever wrong, this is what stops a mistake
-- becoming a thousand rows.
--
-- Counted over tasks rather than in a table of its own. The rows are the record,
-- a second counter would be a second thing to keep in step, and the query is
-- one index-bound scan of a day's captures.

create or replace function public.capture_email(p_user uuid, p_item jsonb)
returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_cap   integer := 50;
  v_today integer;
begin
  select count(*) into v_today
    from public.tasks
   where user_id = p_user
     and feed_uid like 'mail:%'
     and created_at >= date_trunc('day', now());

  if v_today >= v_cap then
    return 'over the daily cap';
  end if;

  return public.ingest_task(p_user, p_item);
end;
$$;

revoke all on function public.capture_email(uuid, jsonb) from public, anon, authenticated;

-- The cap query wants the day's captures without walking every task.
create index if not exists tasks_mail_capture_idx
  on public.tasks (user_id, created_at)
  where feed_uid like 'mail:%';

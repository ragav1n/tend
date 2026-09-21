-- ── Deadlines that arrive without being typed ──────────────────────────────
--
-- Canvas exposes one ICS URL per person covering every enrolled course, with no
-- API token and no OAuth. That is the whole integration: a URL in a table, a
-- parser on the client, and one function here that writes what came back.
--
-- Writing happens in SQL rather than through `mutations.ts` for a reason the
-- reminder pipeline already settled. `mutations.ts` is the only client write
-- door and it runs in a browser, so a nightly cron cannot use it. A deadline
-- that only appears when you happen to open the app is a deadline the reminder
-- pipeline never got to email you about.
--
-- Three rules this function exists to hold, each of which is a way an import can
-- ruin the thing it was meant to help:
--
--   1. **Importing twice must not duplicate.** `(user_id, feed_uid)` is unique,
--      unconditionally, so the same feed read every night converges.
--   2. **A deleted task stays deleted.** The unique index covers tombstones, and
--      the function checks `deleted_at` and stops. Otherwise every dismissed
--      assignment comes back the next night, forever, and the feature becomes
--      something you turn off.
--   3. **Your edits win.** The feed owns a field only while that field still
--      holds what the feed last wrote. Moved a due date yourself and the feed
--      stops touching it. That is what `feed_snapshot` is for, and it is why the
--      comparison is against the snapshot rather than against `field_versions`:
--      a per-field version says *that* something changed, not *who* changed it.

-- ── What a course calls itself in Canvas ───────────────────────────────────
-- Canvas writes its own course code into every summary, and it is rarely the one
-- you would type: `CS-6035-O01` for a course you call CS 6035. The matcher folds
-- and looks for containment, and this is the explicit answer for when that is
-- not enough.

alter table public.courses add column if not exists feed_label text not null default '';

-- ── What the feed wrote, and what it wrote last time ──────────────────────

alter table public.tasks add column if not exists feed_uid text;
alter table public.tasks add column if not exists feed_snapshot jsonb not null default '{}'::jsonb;

-- Unconditional on `deleted_at`, and that is the point. A partial index over
-- live rows only would let the feed re-insert anything you deleted.
create unique index if not exists tasks_feed_uid_idx
  on public.tasks (user_id, feed_uid)
  where feed_uid is not null;

-- The client may not send either. It could otherwise claim the feed wrote a
-- value it did not, and take ownership of a field back by lying about it.
create or replace function public.sync_server_owned_columns()
returns text[]
language sql
immutable
as $$
  select array[
    'updated_at', 'row_version', 'field_versions', 'created_at',
    'completed_at', 'cancelled_at', 'depth', 'parent_depth', 'search_vector',
    'user_id', 'feed_uid', 'feed_snapshot'
  ]::text[];
$$;

-- ── The feeds themselves ───────────────────────────────────────────────────
-- The URL is credential-shaped: anybody holding it can read your Canvas
-- calendar. RLS keeps it to its owner, and nothing logs it or puts it in an
-- error message.

create table public.feeds (
  id              uuid primary key,
  user_id         uuid not null references auth.users (id) on delete cascade,
  url             text not null,
  label           text not null default '',
  enabled         boolean not null default true,
  last_fetched_at timestamptz,
  last_error      text,
  last_count      integer not null default 0,
  /** Items the feed carried that matched no course. Surfaced rather than
      swallowed: they land in the Inbox and this is how the UI offers to help. */
  last_unmatched  integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  row_version     bigint not null default 0,
  field_versions  jsonb  not null default '{}'::jsonb,
  unique (user_id, id)
);

create trigger feeds_stamp
  before insert or update on public.feeds
  for each row execute function public.stamp_sync_columns();

create index feeds_sync_idx on public.feeds (user_id, row_version);

alter table public.feeds enable row level security;

create policy feeds_select on public.feeds
  for select to authenticated using (user_id = (select auth.uid()));
create policy feeds_insert on public.feeds
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy feeds_update on public.feeds
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ── Course events ──────────────────────────────────────────────────────────
-- Lectures, exam slots, office hours. Not work: ticking one off means nothing,
-- so these are not tasks. Server-owned, so the client gets a SELECT policy and
-- nothing else, and `sync_push` refuses the table by not listing it as writable.
--
-- No `sync_readable_tables()` function, despite the plan calling for one. The
-- pull is a hand-written union per table, so that union already *is* the
-- readable set, and a second list saying the same thing is a second list to
-- forget to update.

create table public.course_events (
  id             uuid primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  course_id      uuid,
  feed_uid       text not null,
  title          text not null default '',
  starts_on      date not null,
  starts_at      time,
  ends_at        time,
  location       text not null default '',
  kind           text not null default 'event'
                   check (kind in ('event', 'exam', 'class')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  row_version    bigint not null default 0,
  field_versions jsonb  not null default '{}'::jsonb,
  unique (user_id, id),
  unique (user_id, feed_uid),
  foreign key (user_id, course_id) references public.courses (user_id, id) on delete set null
);

create trigger course_events_stamp
  before insert or update on public.course_events
  for each row execute function public.stamp_sync_columns();

create index course_events_sync_idx on public.course_events (user_id, row_version);
create index course_events_day_idx  on public.course_events (user_id, starts_on)
  where deleted_at is null;

alter table public.course_events enable row level security;

create policy course_events_select on public.course_events
  for select to authenticated using (user_id = (select auth.uid()));

-- ── feeds joins the writable list; course_events deliberately does not ─────

create or replace function public.sync_writable_tables()
returns text[]
language sql
immutable
as $$
  select array[
    'tasks', 'projects', 'tags', 'areas', 'task_series', 'task_tags',
    'user_settings', 'focus_sessions', 'activity_log', 'saved_views',
    'terms', 'courses', 'course_components', 'feeds'
  ]::text[];
$$;

-- ── Writing one feed item ──────────────────────────────────────────────────
--
-- Returns what it did, so the route can report a count the person recognises:
-- "12 new, 3 updated, 40 already here".
--
-- `p_item` is the shape `lib/courses/feed.ts` produces, snake-cased on the way
-- in like every other wire payload:
--   { feed_uid, title, due_date, due_time, course_id, notes, url }

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
  v_existing  public.tasks;
  v_snapshot  jsonb;
  v_next      jsonb;
  v_id        uuid;
  v_rank      text;
begin
  if v_uid is null or v_title = '' then
    return 'skipped';
  end if;

  -- What the feed is claiming this time. Stored alongside the row so the next
  -- import can tell its own writing from yours.
  v_next := jsonb_build_object(
    'title', v_title,
    'due_date', to_jsonb(v_due_date),
    'due_time', to_jsonb(v_due_time)
  );

  select * into v_existing
    from public.tasks
   where user_id = p_user and feed_uid = v_uid;

  if not found then
    -- Ranked at the end of whatever list it joins, the same as a typed task.
    select coalesce(max(sort_key), 'a0') into v_rank
      from public.tasks
     where user_id = p_user and coalesce(course_id::text, '') = coalesce(v_course::text, '');

    v_id := gen_random_uuid();

    insert into public.tasks (
      id, user_id, title, notes, status, due_date, due_time,
      course_id, feed_uid, feed_snapshot, sort_key, planned_sort_key
    ) values (
      v_id, p_user, v_title, v_notes, 'inbox', v_due_date, v_due_time,
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

  -- Rule 2. A tombstone is an answer, and re-offering it every night is how a
  -- feature earns being switched off.
  if v_existing.deleted_at is not null then
    return 'deleted';
  end if;

  v_snapshot := coalesce(v_existing.feed_snapshot, '{}'::jsonb);

  -- Rule 3. Each field moves only while it still holds what the feed wrote.
  -- `is distinct from` throughout, because null is a real value here: a task
  -- with the due time cleared has to read as cleared rather than as unset.
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
         -- The course link is filled in but never taken away: a task you filed
         -- by hand keeps that answer.
         course_id = coalesce(v_existing.course_id, v_course),
         feed_snapshot = v_next
   where id = v_existing.id;

  return 'updated';
end;
$$;

-- Only the cron and the import route may call it, and both hold the service
-- role.
--
-- `from public, anon, authenticated` and not just `from public`. Supabase grants
-- execute to the two named roles on creation, and revoking from PUBLIC leaves a
-- named grant untouched: the function stayed callable by any signed-in session
-- until the test in `lib/sync/ingest.test.ts` said so.
revoke all on function public.ingest_task(uuid, jsonb) from public, anon, authenticated;

-- ── And one course event ───────────────────────────────────────────────────

create or replace function public.ingest_course_event(p_user uuid, p_item jsonb)
returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid   text := nullif(p_item->>'feed_uid', '');
  v_title text := coalesce(p_item->>'title', '');
  v_day   date := nullif(p_item->>'starts_on', '')::date;
begin
  if v_uid is null or v_day is null then
    return 'skipped';
  end if;

  -- Server-owned and never edited by hand, so the feed is free to overwrite it
  -- wholesale. No snapshot rule, because there are no local edits to protect.
  insert into public.course_events (
    id, user_id, course_id, feed_uid, title, starts_on, starts_at, ends_at, location, kind
  ) values (
    gen_random_uuid(), p_user,
    nullif(p_item->>'course_id', '')::uuid,
    v_uid, v_title, v_day,
    nullif(p_item->>'starts_at', '')::time,
    nullif(p_item->>'ends_at', '')::time,
    coalesce(p_item->>'location', ''),
    -- `event_kind`, not `kind`. `kind` is the discriminator `import_feed`
    -- branches on, and reading it here stored every exam as a plain event.
    coalesce(nullif(p_item->>'event_kind', ''), 'event')
  )
  on conflict (user_id, feed_uid) do update
     set course_id  = coalesce(public.course_events.course_id, excluded.course_id),
         title      = excluded.title,
         starts_on  = excluded.starts_on,
         starts_at  = excluded.starts_at,
         ends_at    = excluded.ends_at,
         location   = excluded.location,
         kind       = excluded.kind,
         deleted_at = null;

  return 'applied';
end;
$$;

revoke all on function public.ingest_course_event(uuid, jsonb) from public, anon, authenticated;

-- ── The door a signed-in session may use ───────────────────────────────────
--
-- `ingest_task` takes the user as an argument, which is right for a cron
-- iterating over accounts and wrong for a request. So this is the only entry
-- point granted to `authenticated`, and it derives the account from
-- `auth.uid()` rather than accepting one. There is no argument to point at
-- somebody else's rows.
--
-- `security definer` so it may call the two revoked functions, with an explicit
-- `search_path` so nothing it calls can be shadowed. That combination is what
-- keeps `lib/supabase/admin.ts` out of the import route entirely: a bug in an
-- ordinary route still cannot read another account.

create or replace function public.import_feed(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_item     jsonb;
  v_outcome  text;
  v_inserted integer := 0;
  v_updated  integer := 0;
  v_skipped  integer := 0;
  v_events   integer := 0;
begin
  if v_uid is null then
    raise exception 'import_feed needs a session';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    if v_item->>'kind' = 'event' then
      perform public.ingest_course_event(v_uid, v_item);
      v_events := v_events + 1;
    else
      v_outcome := public.ingest_task(v_uid, v_item);
      if v_outcome = 'inserted' then
        v_inserted := v_inserted + 1;
      elsif v_outcome = 'updated' then
        v_updated := v_updated + 1;
      else
        -- 'deleted' and 'skipped' both land here. Somebody who dismissed an
        -- assignment does not need it counted as news.
        v_skipped := v_skipped + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'inserted', v_inserted,
    'updated',  v_updated,
    'skipped',  v_skipped,
    'events',   v_events
  );
end;
$$;

-- `anon` has no account to import into. `authenticated` keeps it, which is the
-- whole point of the wrapper.
revoke all on function public.import_feed(jsonb) from public, anon;
grant execute on function public.import_feed(jsonb) to authenticated;

-- ── And the pull learns to read them ───────────────────────────────────────
--
-- `feeds` is pushable and pullable like any other table. `course_events` is
-- pullable only: it appears here and not in `sync_writable_tables()`, which is
-- the whole of what "server-owned" means in this protocol.

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
    union all
    select 'saved_views', v.row_version, to_jsonb(v) - 'user_id'
      from public.saved_views v where v.user_id = v_uid and v.row_version > p_cursor
    union all
    select 'terms', tm.row_version, to_jsonb(tm) - 'user_id'
      from public.terms tm where tm.user_id = v_uid and tm.row_version > p_cursor
    union all
    select 'courses', c.row_version, to_jsonb(c) - 'user_id'
      from public.courses c where c.user_id = v_uid and c.row_version > p_cursor
    union all
    select 'course_components', cc.row_version, to_jsonb(cc) - 'user_id'
      from public.course_components cc
       where cc.user_id = v_uid and cc.row_version > p_cursor
    union all
    select 'feeds', f.row_version, to_jsonb(f) - 'user_id'
      from public.feeds f where f.user_id = v_uid and f.row_version > p_cursor
    union all
    select 'course_events', ce.row_version, to_jsonb(ce) - 'user_id'
      from public.course_events ce
       where ce.user_id = v_uid and ce.row_version > p_cursor
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

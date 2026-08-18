-- ═══════════════════════════════════════════════════════════════════════════
-- 0001  core schema
--
-- Every synced table carries the same seven columns and the same trigger. The
-- decisions worth knowing before reading:
--
--   * Ids are client-generated UUIDv7, never a server default. An offline
--     create needs its final identity the instant it exists, because subtasks,
--     tag rows and reminders all reference the task before any network call.
--     Server-assigned ids would force a temp-id to real-id remap across the
--     whole local object graph on every sync.
--
--   * row_version is a per-user monotonic counter, and it is the sync cursor.
--     updated_at is assigned before commit, so two concurrent transactions can
--     commit out of timestamp order and a timestamp cursor skips a row
--     permanently. The counter is taken under a row lock held to commit, which
--     removes the race structurally. updated_at stays for display only.
--
--   * Composite tenancy foreign keys. Every parent has a redundant-looking
--     unique (user_id, id) and every child references (user_id, parent_id).
--     That makes it structurally impossible to attach your row to another
--     user's parent, with no RLS, no trigger and no application check involved.
--     The redundant index doubles as the RLS covering index, so it is free.
--
--   * text + CHECK instead of enums everywhere. ALTER TYPE ADD VALUE cannot be
--     reverted or reordered and breaks a rolling deploy where an old client
--     still writes an old value. A check constraint is one drop and add.
--
--   * sort_key is text COLLATE "C". Mandatory: the default ICU collation does
--     not order ASCII the way JavaScript < does, so without it a server
--     ORDER BY sort_key silently disagrees with the client's sort of the same
--     rows, and the two disagree about list order forever.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── The sync counter ───────────────────────────────────────────────────────
-- One row per user. Deliberately not a synced table: it is infrastructure, it
-- never leaves the server, and it has no tombstone or version of its own.

create table public.user_row_version (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  counter  bigint not null default 0
);

alter table public.user_row_version enable row level security;

/**
 * Stamps every server-owned column on a synced row.
 *
 * The UPDATE ... RETURNING takes a row lock on the counter that is held until
 * commit, so two concurrent writers for the same user cannot be handed versions
 * in an order that differs from the order they commit in. That is the entire
 * reason the cursor is trustworthy.
 *
 * field_versions records, per column, the row_version at which that column last
 * changed. sync_push reads it to decide a per-field merge: a client editing the
 * title while another device edited the notes should lose neither.
 */
create or replace function public.stamp_sync_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  next_version bigint;
  new_json     jsonb;
  old_json     jsonb;
  col          text;
begin
  insert into public.user_row_version (user_id, counter)
  values (new.user_id, 1)
  on conflict (user_id)
    do update set counter = public.user_row_version.counter + 1
  returning counter into next_version;

  new.updated_at  := now();
  new.row_version := next_version;

  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    -- Everything on a new row was set at this version, so the first update
    -- from another device has a version to compare against.
    new_json := to_jsonb(new);
    new.field_versions := (
      select coalesce(jsonb_object_agg(key, next_version), '{}'::jsonb)
      from jsonb_each(new_json)
      where key not in ('updated_at', 'row_version', 'field_versions', 'created_at',
                        'search_vector', 'parent_depth')
    );
    return new;
  end if;

  -- created_at is immutable once set. A client that sends one is ignored
  -- rather than rejected, because rejecting would fail a whole offline batch.
  new.created_at := old.created_at;

  new_json := to_jsonb(new);
  old_json := to_jsonb(old);
  new.field_versions := coalesce(old.field_versions, '{}'::jsonb);

  for col in select key from jsonb_each(new_json) loop
    if col not in ('updated_at', 'row_version', 'field_versions', 'created_at',
                   'search_vector', 'parent_depth')
       and new_json -> col is distinct from old_json -> col then
      new.field_versions := new.field_versions || jsonb_build_object(col, next_version);
    end if;
  end loop;

  return new;
end;
$$;

-- ── Profiles and settings ──────────────────────────────────────────────────

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  display_name text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.user_settings (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  timezone               text not null default 'UTC',
  -- ISO day of week, 1 Monday through 7 Sunday.
  week_start             smallint not null default 1 check (week_start between 1 and 7),
  all_day_reminder_time  time not null default '09:00',
  digest_enabled         boolean not null default true,
  -- Constrained so the "at or past digest_time and none sent today" catch-up
  -- window can never wrap midnight.
  digest_time            time not null default '07:00'
                           check (digest_time between '04:00' and '20:00'),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  row_version            bigint not null default 0,
  field_versions         jsonb  not null default '{}'::jsonb
);

/**
 * Gives every new account its profile, settings and sync counter in one go.
 * Doing it here rather than on first write means the very first pull has
 * something coherent to return instead of an empty result the client cannot
 * distinguish from "not signed in".
 */
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
    on conflict (id) do nothing;
  insert into public.user_row_version (user_id, counter) values (new.id, 0)
    on conflict (user_id) do nothing;
  insert into public.user_settings (user_id) values (new.id)
    on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Areas ──────────────────────────────────────────────────────────────────

create table public.areas (
  id             uuid primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  name           text not null default '',
  sort_key       text collate "C" not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  row_version    bigint not null default 0,
  field_versions jsonb  not null default '{}'::jsonb,
  unique (user_id, id)
);

-- ── Projects ───────────────────────────────────────────────────────────────

create table public.projects (
  id             uuid primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  area_id        uuid,
  name           text not null default '',
  notes          text not null default '',
  status         text not null default 'active'
                   check (status in ('active', 'on_hold', 'done', 'cancelled')),
  color          text not null default '#C29B72',
  due_date       date,
  completed_at   timestamptz,
  sort_key       text collate "C" not null default '',
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  row_version    bigint not null default 0,
  field_versions jsonb  not null default '{}'::jsonb,
  unique (user_id, id),
  foreign key (user_id, area_id) references public.areas (user_id, id) on delete set null
);

-- ── Tags ───────────────────────────────────────────────────────────────────

create table public.tags (
  id             uuid primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  name           text not null,
  color          text not null default '#C29B72',
  sort_key       text collate "C" not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  row_version    bigint not null default 0,
  field_versions jsonb  not null default '{}'::jsonb,
  unique (user_id, id)
);

-- Case-insensitive uniqueness among live tags only, which is what ensureTag on
-- the client assumes when it looks a name up before creating one.
create unique index tags_user_name_live_idx
  on public.tags (user_id, lower(name))
  where deleted_at is null;

-- ── Task series ────────────────────────────────────────────────────────────

create table public.task_series (
  id              uuid primary key,
  user_id         uuid not null references auth.users (id) on delete cascade,
  -- Reserves the RRULE escape hatch without paying for it now.
  kind            text not null default 'structured' check (kind in ('structured', 'rrule')),
  freq            text not null check (freq in ('daily', 'weekly', 'monthly', 'yearly')),
  interval        integer not null default 1 check (interval between 1 and 365),
  byday           smallint[] not null default '{}',
  bymonthday      smallint[] not null default '{}',
  bymonth         smallint[] not null default '{}',
  -- 1 through 5 for "nth", -1 for "last", 0 for unused.
  month_week      smallint not null default 0 check (month_week between -1 and 5),
  anchor_mode     text not null default 'due_date'
                    check (anchor_mode in ('due_date', 'completion_date')),
  catchup_policy  text not null default 'skip_to_future'
                    check (catchup_policy in ('skip_to_future', 'keep_backlog')),
  ends_mode       text not null default 'never'
                    check (ends_mode in ('never', 'on_date', 'after_count')),
  ends_on         date,
  ends_after_count integer check (ends_after_count is null or ends_after_count > 0),
  completed_count integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  row_version     bigint not null default 0,
  field_versions  jsonb  not null default '{}'::jsonb,
  unique (user_id, id)
);

-- ── Tasks ──────────────────────────────────────────────────────────────────

create table public.tasks (
  id             uuid primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  project_id     uuid,
  parent_task_id uuid,
  series_id      uuid,

  -- Server-owned. 0 top level, 1 subtask.
  depth          smallint not null default 0 check (depth in (0, 1)),
  -- Always 0, and it exists for exactly one reason: the self-reference below
  -- points at (user_id, id, depth), so a parent is required to be a top-level
  -- task. That caps the tree at depth 1 with no trigger and no check that a
  -- concurrent transaction could race past.
  parent_depth   smallint generated always as (0) stored,

  title          text not null,
  notes          text not null default '',
  status         text not null default 'inbox'
                   check (status in ('inbox', 'active', 'waiting', 'done', 'cancelled')),
  priority       smallint not null default 0 check (priority between 0 and 3),

  -- Wall clock, never an instant. A task due "tomorrow 9am" is due at 9am
  -- wherever you are standing, so storing a timestamptz would silently
  -- reschedule everything you own when you fly somewhere else.
  due_date       date,
  due_time       time,
  start_date     date,
  -- "I intend to do this today", which is what makes a Today list a plan
  -- rather than a pile of deadlines. Distinct from due_date on purpose.
  planned_for    date,
  estimate_minutes integer check (estimate_minutes is null or estimate_minutes > 0),

  -- Server-derived from status, so a client cannot backdate a completion.
  completed_at   timestamptz,
  cancel_reason  text check (cancel_reason is null
                   or cancel_reason in ('skipped', 'obsolete', 'duplicate', 'other')),
  archived_at    timestamptz,

  sort_key         text collate "C" not null default '',
  planned_sort_key text collate "C" not null default '',

  occurrence_date date,
  occurrence_seq  integer,

  search_vector  tsvector generated always as (
                   to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(notes, ''))
                 ) stored,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  row_version    bigint not null default 0,
  field_versions jsonb  not null default '{}'::jsonb,

  unique (user_id, id),
  -- Carries depth so a child can require a top-level parent.
  unique (user_id, id, depth),

  foreign key (user_id, project_id) references public.projects (user_id, id) on delete set null,
  foreign key (user_id, series_id)  references public.task_series (user_id, id) on delete set null,
  foreign key (user_id, parent_task_id, parent_depth)
    references public.tasks (user_id, id, depth) on delete cascade,

  -- A subtask belongs to its parent's project. Storing it twice invites the two
  -- to disagree, and the client already relies on this.
  constraint tasks_subtask_has_no_project
    check (parent_task_id is null or project_id is null),
  constraint tasks_depth_matches_parent
    check ((parent_task_id is null and depth = 0) or (parent_task_id is not null and depth = 1))
);

/**
 * Two columns the client is never allowed to send, kept honest here rather than
 * only in the RPC: depth follows parent_task_id, and completed_at follows
 * status. A client that could set completed_at could fake a streak.
 */
create or replace function public.derive_task_columns()
returns trigger
language plpgsql
as $$
begin
  new.depth := case when new.parent_task_id is null then 0 else 1 end;

  if tg_op = 'INSERT' then
    new.completed_at := case when new.status = 'done' then now() else null end;
  elsif new.status is distinct from old.status then
    new.completed_at := case when new.status = 'done' then now() else null end;
  else
    new.completed_at := old.completed_at;
  end if;

  return new;
end;
$$;

-- Exactly one open occurrence per series. Two devices completing the same
-- instance offline both generate occurrence 5; the first writer wins and the
-- loser gets a 23505 it resolves by accepting the server's row. A retried batch
-- re-inserting the identical row hits the same constraint and counts as success.
create unique index tasks_series_occurrence_idx
  on public.tasks (series_id, occurrence_seq)
  where series_id is not null and deleted_at is null;

-- ── Task tags ──────────────────────────────────────────────────────────────
-- The join carries a denormalized user_id so its RLS policy stays a bare
-- comparison instead of an EXISTS back to tasks, which would run per row. The
-- composite foreign keys guarantee that denormalized value cannot lie.

create table public.task_tags (
  task_id     uuid not null,
  tag_id      uuid not null,
  user_id     uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (task_id, tag_id),
  foreign key (user_id, task_id) references public.tasks (user_id, id) on delete cascade,
  foreign key (user_id, tag_id)  references public.tags  (user_id, id) on delete cascade
);

/**
 * No row_version on this table, and that is the point.
 *
 * A hard-deleted join row cannot be pulled incrementally: once it is gone there
 * is nothing left to carry a cursor. Tombstoning a three-column table to fix
 * that is a lot of machinery for a set of uuids. So the tag set is not its own
 * sync channel at all. It rides along on the task: a change here touches the
 * parent task, the stamp trigger gives that task a fresh row_version, and the
 * next pull sends the task with its complete tag_ids array. The client replaces
 * the set wholesale, which is idempotent and cannot half-apply.
 */
create or replace function public.touch_task_from_tags()
returns trigger
language plpgsql
as $$
begin
  update public.tasks
     set updated_at = now()
   where id = coalesce(new.task_id, old.task_id);
  return coalesce(new, old);
end;
$$;

create trigger task_tags_touch_task
  after insert or delete on public.task_tags
  for each row execute function public.touch_task_from_tags();

-- ── Sync triggers ──────────────────────────────────────────────────────────
-- Postgres fires BEFORE triggers in alphabetical order by name, and that
-- ordering is load-bearing here: tasks_derive has to set depth and completed_at
-- before tasks_stamp diffs the row to build field_versions, or those two
-- columns never appear in it. Do not rename either one without checking that
-- "derive" still sorts before "stamp".

create trigger tasks_derive
  before insert or update on public.tasks
  for each row execute function public.derive_task_columns();

create trigger tasks_stamp
  before insert or update on public.tasks
  for each row execute function public.stamp_sync_columns();

create trigger projects_stamp
  before insert or update on public.projects
  for each row execute function public.stamp_sync_columns();

create trigger tags_stamp
  before insert or update on public.tags
  for each row execute function public.stamp_sync_columns();

create trigger areas_stamp
  before insert or update on public.areas
  for each row execute function public.stamp_sync_columns();

create trigger task_series_stamp
  before insert or update on public.task_series
  for each row execute function public.stamp_sync_columns();

create trigger user_settings_stamp
  before insert or update on public.user_settings
  for each row execute function public.stamp_sync_columns();

-- ── Indexes ────────────────────────────────────────────────────────────────
-- Every pull is "rows for this user above this cursor", so the cursor index is
-- the one that matters on every table.

create index tasks_sync_idx        on public.tasks        (user_id, row_version);
create index projects_sync_idx     on public.projects     (user_id, row_version);
create index tags_sync_idx         on public.tags         (user_id, row_version);
create index areas_sync_idx        on public.areas        (user_id, row_version);
create index task_series_sync_idx  on public.task_series  (user_id, row_version);

create index tasks_due_idx     on public.tasks (user_id, due_date)
  where deleted_at is null and status not in ('done', 'cancelled');
create index tasks_project_idx on public.tasks (user_id, project_id)
  where deleted_at is null;
create index tasks_parent_idx  on public.tasks (user_id, parent_task_id)
  where deleted_at is null;
create index tasks_search_idx  on public.tasks using gin (search_vector);
create index task_tags_tag_idx on public.task_tags (user_id, tag_id);

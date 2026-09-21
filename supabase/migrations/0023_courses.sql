-- ── Terms, courses, and what each piece of a course is worth ───────────────
--
-- A course is not a project. It runs for a term, it holds several projects worth
-- of work, and it has a property no project has: the work inside it is weighted,
-- so knowing where you stand needs the weights and not just a count of what is
-- finished.
--
-- Three tables and five columns on `tasks`, rather than an `assignments` table
-- beside it. An assignment is a task: one thing to complete, to schedule, to be
-- reminded about and to undo. That is the same call `tasks.parent_task_id` made
-- for subtasks instead of a `subtasks` table, and for the same reason: a second
-- table means every list query needs a second read and a union to show one
-- person's work.
--
-- `course_id` and `project_id` are independent. "CS 6035" and "Term paper" are
-- both true of the same task, and making a course a kind of project would force
-- a choice nobody wants to make.
--
-- Deliberately absent: a `completed_at` on `courses`. Nothing would set it. The
-- status plus the term's end date already answer "is this over", and a column
-- with no writer is the debt 0022 and phase 6 were spent paying off.

-- ── Terms ──────────────────────────────────────────────────────────────────
-- Thin on purpose, like an area: a name and two dates. Everything else about a
-- semester is a property of the courses in it.

create table public.terms (
  id             uuid primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  name           text not null default '',
  start_date     date not null,
  end_date       date not null,
  sort_key       text collate "C" not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  row_version    bigint not null default 0,
  field_versions jsonb  not null default '{}'::jsonb,
  unique (user_id, id),
  check (end_date >= start_date)
);

-- ── Courses ────────────────────────────────────────────────────────────────
-- `color` is a raw hex rather than a token, for the reason a project's is: it
-- travels through export, and a token would repaint every course on a ramp
-- change.
--
-- `meetings` is `[{ byday, start, end, location }]` with ISO weekdays, wall
-- clock, matching how a task stores a due time. A table for it would be three
-- rows joined back on every render of a timetable nobody edits row by row.
--
-- `grade_scale` is `[{ letter, min, points }]`, empty meaning "use the default".
-- Per course because a seminar graded A/B/C and a lab graded on 93 are both
-- normal, and a global scale would make one of them wrong.

create table public.courses (
  id             uuid primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  term_id        uuid,
  code           text not null default '',
  name           text not null default '',
  color          text not null default '#C29B72',
  credit_hours   numeric(3,1) not null default 3
                   check (credit_hours >= 0 and credit_hours <= 24),
  instructor     text not null default '',
  meetings       jsonb  not null default '[]'::jsonb,
  grade_scale    jsonb  not null default '[]'::jsonb,
  status         text not null default 'active'
                   check (status in ('active', 'done', 'dropped')),
  notes          text not null default '',
  sort_key       text collate "C" not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  row_version    bigint not null default 0,
  field_versions jsonb  not null default '{}'::jsonb,
  unique (user_id, id),
  foreign key (user_id, term_id) references public.terms (user_id, id) on delete set null
);

-- One CS 6035 per term. Case-folded, and only over live rows, so a course
-- dropped and re-added does not collide with its own tombstone. Same shape as
-- the unique index on `tags`.
create unique index courses_code_idx
  on public.courses (user_id, term_id, lower(code))
  where deleted_at is null and code <> '';

-- ── Grade components ───────────────────────────────────────────────────────
-- "Homework is 30% of the grade." `weight` is a percentage rather than a
-- fraction because that is how a syllabus writes it, and `drop_lowest` is here
-- rather than in the arithmetic because it is a rule of the course.
--
-- The weights are not constrained to sum to 100. A syllabus with extra credit
-- sums past it, one still being written sums under it, and refusing the row
-- would mean you cannot enter a course until you have all of it.

create table public.course_components (
  id             uuid primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  course_id      uuid not null,
  name           text not null default '',
  weight         numeric(5,2) not null default 0
                   check (weight >= 0 and weight <= 100),
  drop_lowest    integer not null default 0 check (drop_lowest >= 0),
  sort_key       text collate "C" not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  row_version    bigint not null default 0,
  field_versions jsonb  not null default '{}'::jsonb,
  unique (user_id, id),
  foreign key (user_id, course_id) references public.courses (user_id, id) on delete cascade
);

-- ── What a task carries when it belongs to a course ────────────────────────
--
-- All nullable, because most tasks are not coursework. `points_earned` stays
-- null until something is graded, which is what tells the projection apart from
-- a zero: an untouched final is not a final you failed.

alter table public.tasks add column course_id       uuid;
alter table public.tasks add column component_id    uuid;
alter table public.tasks add column points_possible numeric(7,2);
alter table public.tasks add column points_earned   numeric(7,2);
alter table public.tasks add column graded_at       date;

-- Composite tenancy foreign keys, the pattern every parent link here uses: the
-- denormalized user_id cannot lie about which account a row belongs to.
--
-- `set null` on a hard delete. The soft path is the one that runs in practice,
-- and clearing `course_id` there is the client's job, the same way deleting a
-- project files its tasks back into the Inbox.
alter table public.tasks
  add constraint tasks_course_fk
  foreign key (user_id, course_id) references public.courses (user_id, id)
  on delete set null;

alter table public.tasks
  add constraint tasks_component_fk
  foreign key (user_id, component_id) references public.course_components (user_id, id)
  on delete set null;

-- ── Triggers ───────────────────────────────────────────────────────────────

create trigger terms_stamp
  before insert or update on public.terms
  for each row execute function public.stamp_sync_columns();

create trigger courses_stamp
  before insert or update on public.courses
  for each row execute function public.stamp_sync_columns();

create trigger course_components_stamp
  before insert or update on public.course_components
  for each row execute function public.stamp_sync_columns();

-- ── Indexes ────────────────────────────────────────────────────────────────
-- Every pull is "rows for this user above this cursor", so that index comes
-- first on every synced table.

create index terms_sync_idx             on public.terms             (user_id, row_version);
create index courses_sync_idx           on public.courses           (user_id, row_version);
create index course_components_sync_idx on public.course_components (user_id, row_version);

create index courses_term_idx on public.courses (user_id, term_id)
  where deleted_at is null;
create index course_components_course_idx on public.course_components (user_id, course_id)
  where deleted_at is null;
create index tasks_course_idx on public.tasks (user_id, course_id)
  where deleted_at is null;

-- ── Row level security ─────────────────────────────────────────────────────
-- Select, insert and update. No delete policy, matching every tombstoned table
-- here: purging is a service_role cron, not something a session does.

alter table public.terms             enable row level security;
alter table public.courses           enable row level security;
alter table public.course_components enable row level security;

create policy terms_select on public.terms
  for select to authenticated using (user_id = (select auth.uid()));
create policy terms_insert on public.terms
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy terms_update on public.terms
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy courses_select on public.courses
  for select to authenticated using (user_id = (select auth.uid()));
create policy courses_insert on public.courses
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy courses_update on public.courses
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy course_components_select on public.course_components
  for select to authenticated using (user_id = (select auth.uid()));
create policy course_components_insert on public.course_components
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy course_components_update on public.course_components
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ── And they join the sync channel ─────────────────────────────────────────

create or replace function public.sync_writable_tables()
returns text[]
language sql
immutable
as $$
  select array[
    'tasks', 'projects', 'tags', 'areas', 'task_series', 'task_tags',
    'user_settings', 'focus_sessions', 'activity_log', 'saved_views',
    'terms', 'courses', 'course_components'
  ]::text[];
$$;

-- ── And the pull learns to read them ───────────────────────────────────────
--
-- `sync_push` needed nothing: it builds its statement from the table name after
-- checking it against `sync_writable_tables()`. The pull is a hand-written union
-- per table, so a table added to the writable list and not to this one is a
-- table a client can write and never read back. `lib/sync/mapping.test.ts`
-- greps for exactly that, which is how this arrived.

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

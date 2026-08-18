-- ═══════════════════════════════════════════════════════════════════════════
-- 0002  row level security
--
-- Three rules, and every policy in this file follows all three.
--
--   1. Always `(select auth.uid())`, never bare `auth.uid()`. Bare, it is a
--      STABLE function reference inside the row filter and Postgres
--      re-evaluates it per row. Wrapped in a scalar subquery the planner hoists
--      it into a one-time InitPlan. On a table scan of a few thousand tasks
--      that is the difference between one call and a few thousand. This is the
--      single highest-leverage line in the schema, and lib/sync/migrations.test.ts
--      greps this directory to make sure it cannot regress.
--
--   2. No EXISTS and no joins inside a policy. That is why task_tags carries a
--      denormalized user_id: joining back to tasks per row to prove ownership
--      would run the join once per candidate row. The composite foreign keys in
--      0001 guarantee the denormalized value cannot lie, so the cheap check is
--      also the correct one.
--
--   3. tasks has no DELETE policy at all. Clients cannot hard-delete; they set
--      deleted_at and the row keeps its content for the retention window.
--      Physical purge is a service_role cron. A buggy client, or a compromised
--      session, can never destroy history.
--
-- Sharing later needs no rewrite. Postgres ORs permissive policies together, so
-- a project_members table means appending a second SELECT policy per table
-- without touching anything below.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles      enable row level security;
alter table public.user_settings enable row level security;
alter table public.areas         enable row level security;
alter table public.projects      enable row level security;
alter table public.tags          enable row level security;
alter table public.task_series   enable row level security;
alter table public.tasks         enable row level security;
alter table public.task_tags     enable row level security;

-- ── profiles ───────────────────────────────────────────────────────────────

create policy profiles_select on public.profiles
  for select to authenticated using (id = (select auth.uid()));

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ── user_settings ──────────────────────────────────────────────────────────

create policy user_settings_select on public.user_settings
  for select to authenticated using (user_id = (select auth.uid()));

create policy user_settings_update on public.user_settings
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ── areas ──────────────────────────────────────────────────────────────────

create policy areas_select on public.areas
  for select to authenticated using (user_id = (select auth.uid()));

create policy areas_insert on public.areas
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy areas_update on public.areas
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ── projects ───────────────────────────────────────────────────────────────

create policy projects_select on public.projects
  for select to authenticated using (user_id = (select auth.uid()));

create policy projects_insert on public.projects
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy projects_update on public.projects
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ── tags ───────────────────────────────────────────────────────────────────

create policy tags_select on public.tags
  for select to authenticated using (user_id = (select auth.uid()));

create policy tags_insert on public.tags
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy tags_update on public.tags
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ── task_series ────────────────────────────────────────────────────────────

create policy task_series_select on public.task_series
  for select to authenticated using (user_id = (select auth.uid()));

create policy task_series_insert on public.task_series
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy task_series_update on public.task_series
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ── tasks ──────────────────────────────────────────────────────────────────
-- Note the absence of a DELETE policy. That is rule 3 and it is deliberate.

create policy tasks_select on public.tasks
  for select to authenticated using (user_id = (select auth.uid()));

create policy tasks_insert on public.tasks
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy tasks_update on public.tasks
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ── task_tags ──────────────────────────────────────────────────────────────
-- The one table that does get a DELETE policy. The sync layer models "the tag
-- set for task X" as a replaceable set, which avoids putting tombstones on a
-- three-column join table, so removing a tag really does remove the row.

create policy task_tags_select on public.task_tags
  for select to authenticated using (user_id = (select auth.uid()));

create policy task_tags_insert on public.task_tags
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy task_tags_delete on public.task_tags
  for delete to authenticated using (user_id = (select auth.uid()));

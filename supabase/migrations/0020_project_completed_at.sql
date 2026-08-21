-- ═══════════════════════════════════════════════════════════════════════════
-- 0020  a project's completed_at
--
-- `projects.completed_at` has existed since 0001 and has never once been set.
-- `sync_server_owned_columns()` strips completed_at from every push, for every
-- table, so no client can write it, and only `tasks` had a trigger deriving it.
-- The column was a promise nothing kept: a project could be marked done and
-- still report no date it was finished on.
--
-- Same shape as `derive_task_columns`, and the same reason for the name.
-- Postgres fires BEFORE triggers in alphabetical order, so `projects_derive`
-- has to sort ahead of `projects_stamp` or the stamp diffs the row before this
-- has touched it and completed_at never enters field_versions. "derive" sorts
-- before "stamp". Do not rename either one without rechecking that.
--
-- Cancelled is not done. A project abandoned in March has no completion date,
-- and giving it one would put it in any report that counts finished work.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.derive_project_columns()
returns trigger
language plpgsql
as $$
begin
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

-- ── The backfill runs BEFORE the trigger exists, and it has to ─────────────
-- The else arm above is `new.completed_at := old.completed_at`, and for a row
-- that has been done since 2026 that old value is null. Run the other way round
-- the trigger reverts the backfill on the way through and this whole statement
-- becomes a no-op that reports "UPDATE 4". A PGlite case holds the ordering.
--
-- `updated_at` is the closest honest answer available for a row that turned done
-- under the old schema. The SET expression reads the pre-update value, then
-- projects_stamp overwrites updated_at with now() and bumps row_version, so
-- these rows do come down on every client's next pull. That is correct: the row
-- changed.
--
-- Tombstoned projects are skipped. Churning a row nobody can see, to fill a
-- column nobody will read, is a pull page for nothing.
update public.projects
   set completed_at = updated_at
 where status = 'done' and completed_at is null and deleted_at is null;

create trigger projects_derive
  before insert or update on public.projects
  for each row execute function public.derive_project_columns();

-- Belt and braces, and the one place this file departs from
-- `derive_task_columns`. None of the four trigger functions that came before
-- carry a revoke, because the revokes in this schema are on functions a session
-- can actually call: sync_pull, notifications_tick, the enqueues. A trigger
-- function returns `trigger` and errors if invoked directly, and Postgres checks
-- EXECUTE when the trigger is created rather than each time it fires, so this
-- costs nothing and takes nothing away. A PGlite case pushes a project update as
-- `authenticated` after this line and the trigger still stamps the row. Do not
-- read it as a rule the other four are missing.
revoke execute on function public.derive_project_columns() from anon, authenticated;

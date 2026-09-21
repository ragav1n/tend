-- ── A cancelled task keeps its own timestamp ───────────────────────────────
--
-- `cancelled` has been a legal status since 0001, and unreachable from the UI
-- for just as long. This column is the reason why.
--
-- `_done` already covers the status, so a cancelled task correctly leaves every
-- open list. What it had no way to do was arrive anywhere else. The logbook
-- scans `[_del+_done+completed_at]`, `derive_task_columns` stamps
-- `completed_at` for `done` alone, and IndexedDB does not index null, so a
-- cancelled row sat outside the one index that would have shown it. Cancelling
-- something made it vanish.
--
-- A column of its own rather than widening `completed_at`. That column feeds the
-- weekly review, the day streak and the digest, and a cancellation is not work
-- finished: sharing the column would have the streak reward abandoning things.
--
-- Order matters here. The backfill runs while the OLD trigger is still
-- installed, because that version never mentions `cancelled_at` and leaves what
-- the update wrote alone. Replace the function first and the `else` branch
-- copies `old.cancelled_at` straight back over the backfill, which is the same
-- shape of trap 0020 hit.

alter table public.tasks add column if not exists cancelled_at timestamptz;

comment on column public.tasks.cancelled_at is
  'When the task was cancelled. Server-owned, follows status the way completed_at does.';

-- No rows today. Written anyway: a status set by hand or by an earlier build
-- should not stay invisible after this ships.
update public.tasks
   set cancelled_at = updated_at
 where status = 'cancelled' and cancelled_at is null;

-- ── The trigger, now stamping both ─────────────────────────────────────────
--
-- Re-cancelling an already cancelled task keeps the first timestamp, since the
-- status did not move. Reopening and cancelling again earns a new one.

create or replace function public.derive_task_columns()
returns trigger
language plpgsql
as $$
begin
  new.depth := case when new.parent_task_id is null then 0 else 1 end;

  if tg_op = 'INSERT' then
    new.completed_at := case when new.status = 'done' then now() else null end;
    new.cancelled_at := case when new.status = 'cancelled' then now() else null end;
  elsif new.status is distinct from old.status then
    new.completed_at := case when new.status = 'done' then now() else null end;
    new.cancelled_at := case when new.status = 'cancelled' then now() else null end;
  else
    new.completed_at := old.completed_at;
    new.cancelled_at := old.cancelled_at;
  end if;

  return new;
end;
$$;

-- ── And a client may not send it ───────────────────────────────────────────
--
-- Same reasoning the list already carries for `completed_at`: a client that
-- could set this could date a cancellation to any day it liked.

create or replace function public.sync_server_owned_columns()
returns text[]
language sql
immutable
as $$
  select array[
    'updated_at', 'row_version', 'field_versions', 'created_at',
    'completed_at', 'cancelled_at', 'depth', 'parent_depth', 'search_vector', 'user_id'
  ]::text[];
$$;

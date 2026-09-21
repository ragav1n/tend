-- ── How much of a day there is ─────────────────────────────────────────────
--
-- `estimate_minutes` has been on `tasks` and editable in the detail panel since
-- phase 0, and nothing has ever added two of them together. These two columns
-- are what turn it from a note into an answer.
--
-- `daily_capacity_minutes` is hours of real work in a day, not hours awake. The
-- default is 240: four hours. Somebody who sets it to eight will be told they
-- are fine right up to the week they are not, which is the opposite of the point.
--
-- `work_days` is ISO weekdays, 1 Monday through 7 Sunday. A weekend that
-- contributes nothing is what makes a Friday deadline read as tight rather than
-- as three days away. Stored as an array so "I work Sundays and not Fridays" is
-- expressible, which a `works_weekends boolean` would not be.

alter table public.user_settings
  add column if not exists daily_capacity_minutes integer not null default 240
    check (daily_capacity_minutes between 0 and 1440);

alter table public.user_settings
  add column if not exists work_days smallint[] not null default '{1,2,3,4,5}'::smallint[];

-- Every entry a real weekday.
alter table public.user_settings
  add constraint user_settings_work_days_valid
  check (work_days <@ '{1,2,3,4,5,6,7}'::smallint[]);

-- And deduplicated on the way in, rather than refused.
--
-- A duplicate would count one day's capacity twice, which is the one way this
-- column can produce a wrong answer quietly. A CHECK cannot say it: Postgres
-- forbids a subquery in a constraint, and counting distinct elements needs one.
-- So it is normalized instead, which also sorts, so two clients writing the same
-- set in a different order produce the same stored value and the per-field merge
-- has nothing to argue about.

create or replace function public.normalize_work_days()
returns trigger
language plpgsql
as $$
begin
  if new.work_days is null then
    new.work_days := '{}'::smallint[];
  else
    new.work_days := array(select distinct unnest(new.work_days) order by 1);
  end if;
  return new;
end;
$$;

create trigger user_settings_work_days
  before insert or update on public.user_settings
  for each row execute function public.normalize_work_days();

revoke all on function public.normalize_work_days() from public, anon, authenticated;

comment on column public.user_settings.daily_capacity_minutes is
  'Minutes of real work in a work day. Drives the load strip and the slack figure.';
comment on column public.user_settings.work_days is
  'ISO weekdays that carry capacity, 1 Monday through 7 Sunday.';

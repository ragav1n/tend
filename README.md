# Tend

An offline-first daily task PWA. Tend to what needs doing.

## What this is

One app for daily task management that works with no network, installs on a phone, laptop
or desktop, and emails you so nothing gets forgotten. Postgres is the source of truth,
IndexedDB is the working copy, and the UI never waits on a request.

## Principles

**Offline is correctness, not caching.** Completing a task on the subway and editing that
same task on a laptop has to converge to one answer. Every row carries a client-generated
UUIDv7, the server stamps a monotonic `row_version`, deletes are tombstones, and merges
happen per field rather than per row. So completing a task on your phone while retitling it
on your laptop gives you a completed and retitled task, not one edit erasing the other.

**The write path has exactly one door.** `lib/db/mutations.ts` applies the optimistic local
row and appends the outbox record inside one Dexie transaction. There is no code path where
local state changed but nothing got queued.

**Wall-clock time, not instants.** A task due "tomorrow 9am" is due at 9am wherever you are
standing. Storing an instant means changing timezone silently reschedules everything you own,
and DST silently shifts every recurring task by an hour.

**Motion is the depth.** The design direction is tactile material: one light source from the
top, three elevation levels, and press moves an element in Z. Only `transform` and `opacity`
animate, and `prefers-reduced-motion` is a real path rather than a duration set to zero.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 App Router, React 19, TypeScript strict |
| Styling | Tailwind v4, CSS-first `@theme` tokens in OKLCH |
| Local store | Dexie 4 on IndexedDB, `useLiveQuery` for reads |
| Backend | Supabase: Postgres, Auth, RLS |
| Motion | `motion` v13 |
| Email | Resend + React Email, scheduled by Supabase Cron |
| Hosting | Vercel |

## Running it

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run dev
```

Phase 0 runs with no backend at all. Everything lives in IndexedDB until the Supabase
project is wired up.

```bash
npm run typecheck   # tsc --noEmit, the gate
npm test            # vitest
npm run lint
```

## Turning reminders on

The scheduling lives in Postgres and the sending lives in Vercel, so both sides need
one-time setup. Nothing below is in the repo, because all of it is a secret.

**1. Apply the migrations.** `supabase/migrations/0001` through `0009`, in order.

**2. Enable the extensions**, from the Supabase dashboard or SQL:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
```

`0008` schedules `notifications_tick()` every minute and `0009` schedules the nightly repair,
both the moment `pg_cron` exists and both skipped where it does not, which is what lets the
whole schema run in the test harness.

**3. Put the URL and the shared secret in Vault**, not in the cron command:
`cron.job.command` is readable by anybody who can read the `cron` schema.

```sql
select vault.create_secret('https://your-app.vercel.app/api/cron/reminders', 'tend_reminders_url');
select vault.create_secret('<the same value as CRON_SECRET>', 'tend_cron_secret');
```

**4. Set the environment variables** from `.env.example` on Vercel:
`SUPABASE_SECRET_KEY` (the `sb_secret_` one, not the legacy `service_role` JWT),
`RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_TOKEN_SECRET`, `CRON_SECRET`. Leave `EMAIL_MODE` unset in production, where it defaults to `live`, and set
it to `console` locally.

**5. Point a Resend webhook** at `/api/webhooks/resend` for `email.bounced` and
`email.complained`, and put its signing secret in `RESEND_WEBHOOK_SECRET`.

The daily Vercel cron in `vercel.json` is not optional. A free Supabase project pauses after
seven days with no requests, and `pg_cron` does not count because it runs inside the database
and never arrives as one. Without that ping a week away from the app silently ends every
reminder.

### Checking it

```sql
-- The SQL side: did the tick run, and what did it find?
select * from cron.job_run_details order by start_time desc limit 20;
select * from cron_heartbeats;

-- The queue itself.
select kind, status, scheduled_at, reason, last_error
  from reminder_deliveries order by created_at desc limit 20;
```

`cron.job_run_details` proves the SQL ran. The `reminders_route` row in `cron_heartbeats`
proves the HTTP call landed, which is the part `pg_net` cannot tell you: it is fire and
forget by design. Alert on no heartbeat in ten minutes.

Locally, `EMAIL_MODE=console` runs the whole pipeline and prints the rendered mail instead of
sending it:

```bash
curl -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/cron/reminders
```

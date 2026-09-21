# Tend

An offline-first daily task PWA. Tend to what needs doing.

**Using it:** [docs/using-tend.md](docs/using-tend.md) covers every feature, the
quick-add syntax, setting up a semester, Canvas import and the local model assist.

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
nvm use                      # Node 24, per .nvmrc
npm install
cp .env.example .env.local   # then fill it in
npm run dev
```

Node 22 is the floor: `@supabase/supabase-js` warns on 20 and drops it in a coming
release. `nvm install 24` if you do not have it yet.

Phase 0 runs with no backend at all. Everything lives in IndexedDB until the Supabase
project is wired up.

```bash
npm run typecheck   # tsc --noEmit, the gate. Runs twice: the app, then the worker
npm test            # vitest
npm run lint
npm run build       # next build, then serwist build for the service worker
```

`next dev` ships no service worker. It is built from `app/sw.ts` by the second half of
`npm run build`, so installing the app and testing offline means `npm run build && npm start`.
Serwist has no Turbopack support yet and Next 16 makes Turbopack the default, so the worker
is built by Serwist's own CLI rather than by a webpack plugin. See `serwist.config.mjs`.

## The views

Six lists and four tools. The lists are Today, Upcoming, Inbox, Someday and Logbook, plus
search. The tools are different ways through the same rows:

- **Calendar** shows the month and reschedules by dragging a task to another day. On a phone
  the cells hold dots rather than titles and the day list under the grid does the work,
  because a 50px cell has nothing to grab and dragging one would fight the page scroll.
- **Board** groups open work by status or by project, and moves a card by dragging it or
  through the move button every card carries. The button is what a keyboard, a screen reader
  and a phone use.
- **Focus** runs one session at a time and logs what it measured. Elapsed time is arithmetic
  on two instants, never a tick count, so a backgrounded tab reports the real length.
- **Review** is the week: what got finished, how much of it was focused work, the current
  streak, and every open task whose date has passed.

Focus sessions sync like everything else, so the weekly total counts the laptop and the
phone. That needs `0016_focus_sessions.sql` applied: without it the server rejects the table
by name and every session lands in the deadletter.

## Signing in

**Sign-in is an emailed code, not a link.** The link cannot work in the installed
app, and the reason is not a bug to be fixed:

* iOS gives a home screen web app its own storage container. A link tapped in Mail
  opens the browser, which is a different container, so the PKCE verifier the app
  wrote a minute ago is not there to exchange. That is `pkce_code_verifier_not_found`.
* Even when the exchange works, the session lands in the browser. The app on the
  home screen never saw the cookie and is still signed out.
* There is no manifest escape hatch. `handle_links` is a Chromium feature, and iOS
  has no equivalent and no API to ask for one.

A code goes through the person instead of through storage, so the session is
written by the client that asked for it. `autoComplete="one-time-code"` puts it in
the iOS QuickType bar, which makes it one tap rather than a row of digits.

**The client never assumes how many digits.** The length is a project setting
(Authentication > Sign In / Providers > Email > **Email OTP Length**) and Supabase
allows six to ten. Nothing in the browser can read it, so `normalizeCode` accepts
the whole range. Hardcoding six is exactly the bug that shipped in 0.44.0: a
project set to eight mailed eight digits, the field kept six, and the only symptom
was Supabase reporting an invalid token, which points at everything except the
cause. The email states the count, because that template is holding the code and
`code.length` is the one place the number is known for certain.

### Turning the code email on

The email is `emails/SignInEmail.tsx`, rendered by the same React Email path as
every other email here and sent through Resend. Supabase never sends it, which
takes two things off the table: editing HTML in a dashboard, and Supabase's
built-in SMTP cap of two emails an hour.

**1. Enable the hook.** Authentication > Hooks > **Send Email**, pointed at
`https://your-app.vercel.app/api/webhooks/supabase-auth`.

**2. Copy the signing secret** it generates into `AUTH_EMAIL_HOOK_SECRET` on
Vercel, exactly as shown, `v1,whsec_` prefix and all.

Nothing else. The auth email templates in the dashboard stop being used, so there
is no `{{ .Token }}` to paste anywhere.

**The rollback is one toggle.** Turn the hook off and Supabase goes back to its own
templates immediately. Worth knowing, because with the hook on, a route that fails
means no sign-in email: the route answers non-2xx on purpose rather than reporting
a send that did not happen, so a failure is visible in the client instead of
silent. `EMAIL_MODE=off`, which is the default outside production, is one of those
failures.

## Turning notifications on

Two variables and one migration. The scheduling is the same pipeline the emails
use, so there is nothing else to set up.

```bash
npx web-push generate-vapid-keys
```

Put the public key in `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and the private one in
`VAPID_PRIVATE_KEY`, apply `0014_web_push.sql`, and the toggle appears under
Settings > This device. With the keys unset the toggle says the deployment has no
push keys and the cron sends email exactly as it did before.

**On iPhone the app has to be on the home screen first.** Safari gives a tab no
`PushManager` at all, so there is nothing to enable until it is installed, and
the settings row says so rather than showing a switch that cannot work.

Turning notifications on is per device, and deliberately not a synced setting: a
subscription row is the state, so switching it off on a laptop leaves a phone
alone. Once any device is subscribed, turning email off keeps the reminders
coming, and a hard bounce stops the mail without stopping the notification.

## Turning mail to task on

Forward anything to a capture address and it lands in your Inbox. The subject is
read the way the quick-add field reads it, so `Read chapter 4 tomorrow !p2
+cs6035` arrives dated, prioritised and filed under the course.

1. In Resend, open **Receiving** and create a managed address. It looks like
   `<alias>@<id>.resend.app` and needs **no DNS record**, which is the reason
   this is the integration rather than a domain of its own.
2. Add a webhook for the `email.received` event pointing at
   `/api/webhooks/resend-inbound`, and put its signing secret in
   `RESEND_INBOUND_SECRET`.
3. Put the address itself in `NEXT_PUBLIC_CAPTURE_ADDRESS` so Settings can show
   it to you. It is public because it is printed on screen, and safe to be,
   because it only accepts mail from you.

Without the secret the route refuses every request, which fails safe: no
signature, no capture.

**What guards it.** An inbound address is guessable and unauthenticated by
construction, so two things stand in front of it. The Svix signature proves the
request came from Resend, and the `From` address has to match the one on your
account. A `From` header is forgeable, so the second check stops casual noise
and somebody who knows your address, not a determined forger. The blast radius
is a task in your own Inbox, and `capture_email` caps it at 50 a day.

**Checking it.** A captured task carries `feed_uid` beginning `mail:`, so:

```sql
select title, created_at from public.tasks
 where feed_uid like 'mail:%' order by created_at desc limit 10;
```

The message id is the identity, so a webhook Resend retries leaves one row
rather than two, and a capture you delete stays deleted.

## Turning reminders on

The scheduling lives in Postgres and the sending lives in Vercel, so both sides need
one-time setup. Nothing below is in the repo, because all of it is a secret.

**1. Apply the migrations.** Everything in `supabase/migrations/`, in order.

**2. Enable the extensions**, from the Supabase dashboard or SQL:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
```

The dashboard's dialog pins `pg_cron` to `pg_catalog` and lets `pg_net` go anywhere,
defaulting to `extensions`. Either placement works: the tick reads the schema out of
`pg_proc` rather than assuming `net`. Check where it landed with

```sql
select n.nspname, p.proname from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace where p.proname = 'http_post';
```

`0008` schedules `notifications_tick()` every minute and `0009` schedules the nightly repair,
both the moment `pg_cron` exists and both skipped where it does not, which is what lets the
whole schema run in the test harness. **Enable the extensions before applying those two, or
run the two `cron.schedule` calls by hand afterwards:**

```sql
select cron.schedule('tend-notifications-tick', '* * * * *',
  $$select public.notifications_tick()$$);
select cron.schedule('tend-reconcile-notifications', '17 3 * * *',
  $$select public.reconcile_notifications()$$);
```

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

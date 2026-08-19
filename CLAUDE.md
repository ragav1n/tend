@AGENTS.md

# Tend, project context

Offline-first daily task PWA. Next.js 16 App Router + React 19 + TypeScript, Tailwind v4,
Supabase (Postgres + Auth + RLS), deployed on Vercel. Installed as a PWA on iOS, Android,
macOS and Windows.

The full architecture plan lives at `~/.claude/plans/i-want-to-create-noble-flame.md`.

## Stack

- **Local store**: Dexie 4 on IndexedDB. Postgres is the source of truth, IndexedDB is the
  working copy, the UI never waits on the network.
- **Reads**: `dexie-react-hooks` `useLiveQuery` only. No TanStack Query for persisted data.
- **Ephemeral UI state**: Zustand (open sheets, selection, drag in progress). Never task data.
- **Motion**: `motion` v13 with `<MotionConfig>` at the root. No GSAP.
- **Icons**: `@phosphor-icons/react`, one family, regular and bold weights only.
- **Email**: Resend + React Email, scheduled by Supabase Cron (`pg_cron` + `pg_net`).

## Hard rules

- **`lib/db/mutations.ts` is the only write API.** Never call `db.<table>.put/add/delete`
  anywhere else. Every mutation applies the optimistic local row AND appends the outbox
  record in one Dexie transaction, so "local changed but nothing queued" is impossible.
- **`lib/db/derive.ts` is the only place derived index fields are computed** (`_del`, `_done`,
  `_dueDay`, `_tagIds`, `_words`). It runs on both the optimistic path and the server-apply
  path so the two cannot diverge.
- **`lib/brand.ts` holds the only copy of the mark.** `components/brand/Mark.tsx` draws it,
  and `node brand/gen-icons.mjs` rasterises the favicon, the Next icon conventions, the PWA
  set and the email PNG from it, resolving its colours out of `app/globals.css`. Change the
  paths there and re-run the script. Never hand-edit an icon, and never hardcode the hex.
- **The sync cursor is `row_version`, never `updated_at`.** `updated_at` is assigned before
  commit, so concurrent transactions can commit out of timestamp order and a timestamp cursor
  skips rows permanently.
- **Clients never send** `updated_at`, `row_version`, `field_versions`, `completed_at`,
  `depth` or `search_vector`. Triggers own them.
- **Tasks store wall-clock time** (`due_date date` + `due_time time`), never `timestamptz`.
  Absolute instants exist only in `reminder_deliveries.scheduled_at` and
  `focus_sessions.started_at`.
- **`sort_key` columns are `collate "C"`** so Postgres ordering matches JavaScript sort.
- **RLS policies always wrap as `(select auth.uid())`**, never bare `auth.uid()`.
- **`tasks` has no DELETE policy.** Soft delete only; purging is a `service_role` cron.
- **The reminder pipeline is SQL.** Postgres decides who gets an email and when
  (`notifications_tick`, the enqueues, the claim); the route only renders and sends. A new
  rule about scheduling belongs in a migration with a PGlite test, never in the route.
- **`lib/supabase/admin.ts` is the only service-role code path**, and only the cron routes
  may import it. Everything a signed-in person does runs under their own cookie, so a bug in
  an ordinary route cannot read another account's rows.
- **Every new pipeline function is revoked from `anon` and `authenticated`.** Supabase grants
  execute on creation by default, so a function without an explicit revoke is callable by any
  session. The test harness applies those default privileges before the migrations, which is
  what makes the revokes testable.
- **Email sends nothing outside production unless told twice.** `EMAIL_MODE` defaults to
  `off`, `live` outside a production deployment is refused, and the recipient's domain has to
  be on `EMAIL_ALLOWED_DOMAINS`.
- Animate `transform` and `opacity` only. Never animate `height` inside `AnimatePresence`.
- **Commits are allowed on this repo** (`github.com/ragav1n/tend`, granted 2026-08-18).
  Author them as `ragav1n` and **never add a Claude trailer or co-author line**. Short
  imperative subject, then a body explaining why rather than what.
- **Never commit a real secret.** `.env` and `.env.local` are ignored; `.env.example` is
  committed and holds names and comments only. The repo is public, so check
  `git ls-files -o --exclude-standard` before the first commit of any session that touched
  config.
- Always run `npm run typecheck` and `npm test` before calling a task done.
- Bump `version` in `package.json` on every change. Patch for fixes, minor for features.
- Do not over-engineer. Minimum complexity for the task at hand.
- Do not add comments to code that was not changed.

## Writing style, in code comments and UI copy

No em dashes. No adverbs where a verb will do. Active voice. Specifics over vague
declaratives. Never "not X but Y". Comments explain why, not what.

## Next 16 gotchas (verified against the bundled docs in node_modules/next/dist/docs)

These differ from Next 14/15 and will silently break things:

- **Turbopack is the default for `next dev` AND `next build`.** A custom `webpack` config in
  `next.config.ts` makes `next build` **fail outright**, and that includes a webpack config
  added by a plugin. `@serwist/next`'s `withSerwist()` adds one. When wiring the service
  worker in phase 3, either use Serwist's `next-turbo-basic` example or switch the build
  script to `next build --webpack`. Turbopack supports webpack *loaders* but not *plugins*.
- **Middleware is `proxy.ts` at the root**, not `middleware.ts`. Named export `proxy`, Node
  runtime only (setting `runtime` throws), and `skipMiddlewareUrlNormalize` is now
  `skipProxyUrlNormalize`. Without a matcher it runs on every request including `public/`
  assets and the service worker.
- **`headers()`, `cookies()`, `draftMode()`, `params` and `searchParams` are async.** The
  synchronous fallback is removed in 16, not deprecated.
- **`runtime = 'edge'` is deprecated.** Omit the `runtime` export; nodejs is the default.
- **`Instrument_Serif` is not a variable font**, so `weight: '400'` is required in `app/fonts.ts`.
- **`revalidateTag` takes a second `cacheLife` argument.** The one-arg form is a type error.
- **Route handlers are already uncached by default.** `export const dynamic = 'force-dynamic'`
  still works as belt and braces, but only while `cacheComponents` stays off; that flag
  removes the segment-config exports entirely.
- **`next lint` is gone** and `next build` no longer lints. `npm run lint` calls `eslint .`.
- **`next dev` writes to `.next/dev`**, separate from the build output, with a lockfile that
  blocks a concurrent `next dev` and `next build`.
- **Node 20.9+, Safari 16.4+, Chrome 111+** are the floors. Safari 16.4 is also the floor for
  iOS web push, so the targets line up.
- `experimental.useOffline` plus `useOffline()` from `next/offline` gives connectivity
  detection and automatic retry of blocked navigations and prefetches. Worth turning on, but
  it does not replace the service worker: a full reload while offline still needs one.
- `RouteContext<'/api/path'>` is a generated global type. Prefer it over hand-writing
  `{ params: Promise<...> }`.
- The `<!-- BEGIN:nextjs-agent-rules -->` block in `AGENTS.md` is rewritten by `next dev` on
  every run. Commit it with your work rather than deleting it.

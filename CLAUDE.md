@AGENTS.md

# Tend, project context

Offline-first daily task PWA. Next.js 16 App Router + React 19 + TypeScript, Tailwind v4,
Supabase (Postgres + Auth + RLS), deployed on Vercel. Installed as a PWA on iOS, Android,
macOS and Windows.

The original architecture plan is committed at [`docs/architecture.md`](docs/architecture.md).
It covers phases 0 through 5 and predates the code, so where the two disagree the code is
right and this file is the constitution. Phases 6 through 13 came from a later plan.

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
- **Every task mutation writes an activity entry in the same transaction**, so
  undo can put it back. Structural writes that could only be half undone
  (reorder, recurrence, tags) go through the unlogged helpers in `mutations.ts`
  instead. Undo reverses through those same helpers and stamps `undone_at`; it
  never writes new history, or the next undo would redo it.
- **Text on a clay or olive fill is `text-on-accent`, never `text-hi`.** Both
  ramps keep the source terracotta as the resting fill, and in the light ramp
  `text-hi` is near black. `--color-on-accent` is the one text token that does
  not flip with the theme.
- **There are two colour ramps and `lib/color.test.ts` asserts both.** The step
  numbers are jobs, not a lightness ordering: on a light page the text steps
  (300, 200) sit below the border step (400), and `raised` is darker than
  `surface` rather than lighter. Read tokens with `themeTokens()`, never
  `extractColorTokens()` over the whole file, which lets the last ramp win.
- **Safe-area insets are folded into an element's own padding**, never added by a
  helper class. A class in `@layer base` loses to every Tailwind padding utility,
  so `safe-top pt-6` on one element applied no inset at all and the Inbox eyebrow
  rendered under the iPhone status bar. The `.safe-*` classes are gone; use
  `pt-[calc(1.5rem+env(safe-area-inset-top))]`. Anything with a hardcoded offset
  above the bottom nav (the sync badge, the toaster) needs the inset in that sum
  too.
- **Subtasks render under their parent in the list.** `TaskList` fetches them for
  the whole page with `useSubtasksFor`, never per row, because a hook per row is
  a live query per row. Past three they collapse behind a count.
- **A subtask with a deadline of its own is a row of its own**, and
  `withoutNestedChildren` in `queries.ts` is the only statement of that rule.
  Every dated query runs it: `dueBetween`, `todayCandidates`, `upcomingList`,
  `overdueList`. It drops a child in one case, when its parent is in the same
  window *on the same day*, which is where the child adds nothing. Both halves
  were got wrong once. Dropping every child, which is what the list filters used
  to do, hid a date somebody set on purpose. Dropping a child whose parent is
  anywhere in the window looks right and fails on a list spanning a month: a
  thesis due in 25 days is not standing next to its chapter due in 5, it is
  twenty rows below the day the chapter falls on.
- **A list renders a task once, and `TaskList` is what guarantees it**, through
  `nestedUnder`: a parent leaves out of its nested group any child that is
  already a row of its own. Two rows for one task also puts `data-row-id` in the
  DOM twice, which the keyboard cursor collects and walks onto twice. The count
  on the parent still covers every child, because it describes the task rather
  than the list.
- **Every number on the rail is counted off the list it names.** Two of them were
  an index `count()` over a range, which is cheaper and was wrong: the unfiled
  range holds every subtask in the store, because a child is forced to no
  project, so Inbox read 17 beside a list of 10. Inbox and Someday keep filtering
  children out of their lists and must, for the same reason.
- **`TaskRow` names the parent of a surfaced subtask** from `useParentTitles`,
  which `TaskList` asks for itself rather than taking from a page, and
  `SubtaskRows` shows a child's date only when its parent does not share it.
- **A subtask is filed by its parent, and three places say so.** `createTask`
  forces a child's project, course and component to nothing, `TaskDetail` hides
  all three for `depth !== 0`, and `writeTaskPatch` clears them on the patch
  path. Postgres holds the project half with `tasks_subtask_has_no_project`, and
  a violation is a 23514 the client classifies **fatal**: the mutation
  deadletters and the local row keeps a project the server never took. The patch
  path had no copy of the rule until bulk "Move" could reach a subtask.
- **A hydration key is named after the element it sits on**
  (`key={`month-${hydrated}`}`), never the bare `hydrated ? 'client' : 'server'`.
  Review had two bare ones as siblings in a header `<div>` and logged
  "Encountered two children with the same key" on every load, in a build where
  React warns such children "may be duplicated and/or omitted" and so might skip
  the remount the key exists for. `hooks/use-hydrated.test.tsx` scans the source
  for both halves: no bare keys, and no key written twice in one file.
- **`digest_items` orders before it cuts.** The `limit` sat inside a subquery
  with no `order by` while the ordering sat outside in the `jsonb_agg`, so from
  0008 to 0027 a digest past 25 qualifying tasks kept an arbitrary 25 and then
  sorted them, which looks right in the email and holds the wrong tasks. Any
  future `limit` in that pipeline needs its `order by` in the same subquery.
- **A key binding is scoped.** `lib/keys/map.ts` is the one list; the dispatcher
  binds `scope: 'global'` and the selection bar binds its own. Backspace must
  not be an app-wide delete key.
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
- **No authenticated response ever enters a cache.** `app/sw.ts` is `NetworkOnly` for
  `/api`, `/auth` and every Supabase request, and which rule a request falls under is decided
  in `lib/pwa/cache-policy.ts` because that file can be tested and the worker cannot. Caching
  navigations is safe only while the whole `(app)` group is client rendered: if a view ever
  renders a task on the server, those entries have to go.
- **`skipWaiting` stays off.** A worker that takes over on its own can swap the JS under a tab
  midway through an IndexedDB upgrade, and that costs the local database rather than a render.
- **Nothing reloads for an update until the new worker controls the page.** That is the whole
  job of `lib/pwa/updates.ts`. Because `skipWaiting` is off, a reload issued while the old
  worker is still in charge is answered from the old precache and comes back on the same
  version, which reads as an update button that flickers and does nothing. It waits for
  `controllerchange`, or for the waiting worker to reach `activated`, with a 15 second
  backstop, and it writes the attempt into sessionStorage so a try that came back on the same
  version is reported rather than repeated. Whether an update exists is two signals, not one:
  a waiting worker, and `/api/version` disagreeing with the version this bundle was built as.
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

## Design

[`DESIGN.md`](DESIGN.md) is the design constitution: the direction, why clay means interaction and
olive means state, why the supplied terracotta had to be re-ramped, the grain, and the anti-slop
guardrails. It holds the reasoning and deliberately restates none of the hard rules above, because
two copies of a constitution is how one starts lying.

## Writing style, in code comments and UI copy

No em dashes. No adverbs where a verb will do. Active voice. Specifics over vague
declaratives. Never "not X but Y". Comments explain why, not what.

## Next 16 gotchas (verified against the bundled docs in node_modules/next/dist/docs)

These differ from Next 14/15 and will silently break things:

- **Turbopack is the default for `next dev` AND `next build`.** A custom `webpack` config in
  `next.config.ts` makes `next build` **exit** rather than warn, and that includes a webpack
  config added by a plugin. `@serwist/next`'s `withSerwist()` adds one. Turbopack supports
  webpack *loaders* but not *plugins*, so that plugin has no migration path. Settled in phase
  3: the service worker is built by Serwist's own CLI as a second step, `next build && serwist
  build serwist.config.mjs`, and `next.config.ts` holds nothing but `env`, which inlines the
  package.json version both halves of the update check compare. Do not reintroduce
  `withSerwist()`.
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
  detection and automatic retry of blocked navigations and prefetches. Deliberately left off:
  the service worker precaches every view, so an offline navigation is served from cache
  rather than blocked, and there is little left for it to retry.
- **`useSearchParams()` opts the whole route out of prerendering** unless it sits
  behind its own `<Suspense>`. Read from a component in the layout, that is every
  page in the app, and `next build` fails on each one. It matters beyond the
  build: the service worker precaches prerendered views, so a route that turns
  dynamic is a route that needs the network. Saved views open at `/views?v=` for
  the same reason rather than at `/views/[id]`.
- `RouteContext<'/api/path'>` is a generated global type. Prefer it over hand-writing
  `{ params: Promise<...> }`.
- The `<!-- BEGIN:nextjs-agent-rules -->` block in `AGENTS.md` is rewritten by `next dev` on
  every run. Commit it with your work rather than deleting it.

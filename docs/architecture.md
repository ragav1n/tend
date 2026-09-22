<!--
Recovered on 2026-09-21 from the authoring session log. This file was written in
plan mode, lived only at `~/.claude/plans/i-want-to-create-noble-flame.md`, was
never git tracked, and had gone from disk while `CLAUDE.md` still pointed at it.
It is committed here so the pointer resolves for anyone who clones, and so one
log rotation cannot lose it.

It is the plan as written before any code existed. Read it as the reasoning
behind the shape of the app, not as a description of what shipped: the directory
was still called `kiln`, phases 0 through 5 are the ones it covers, and phases 6
through 13 came later from a different plan. Where it disagrees with the code,
the code is right and `CLAUDE.md` is the current constitution.
-->

# Tend, an offline-first task PWA

You asked for a name that resembles the purpose, and Tally turned out to be taken. **Tend**: to tend to something is to look after what needs doing, which covers both the one-off tasks and the recurring habits this app tracks. Four letters, warm, physical in the same register as the design direction, and it sits naturally with an olive and clay palette. I checked for collisions: no task app owns it (Upkeep is a maintenance-software company, so that candidate is out). Runner-up if you want to swap: **Docket**, which is the dictionary definition of a list of things to be done and has no todo-app collision either. The name lives as one constant in `lib/config.ts` plus the manifest, so changing it costs one commit.

**Typefaces:** Instrument Sans for UI, Instrument Serif for large headings, dates and the review screen, JetBrains Mono for numbers, counts and uppercase labels. All three self-hosted via `next/font` so they work offline. The serif is what stops an earthy palette from reading as muddy, and it is the strongest single move against looking like a template. Instrument Serif gets subset to display sizes only to keep the bundle honest.

## Context

You want one daily task app that covers the full surface of task management, emails you so you never forget, installs as a PWA on iPhone, Android, laptop and desktop, keeps working with no network, and looks and moves like a premium product rather than a template.

Nothing exists yet. This is a greenfield build in a new `/Users/ragav/Projects/kiln` directory.

Three things make this harder than a normal CRUD app, and they drive most of the decisions below:

1. **Offline is a correctness problem, not a cache.** Completing a task on the subway and editing the same task on a laptop has to converge to one answer. That needs client-generated IDs, server-stamped clocks, tombstones and a real outbox, not a `localStorage` write-behind.
2. **Vercel Hobby cannot run a minute-accurate cron.** Confirmed: Hobby caps cron at once per day and jitters the fire time across the hour. Your existing `novira` project works around this with 24 separate hourly `slot-tick` entries in `vercel.json`, which still leaves an hour of slop. Reminders need better than that.
3. **Motion quality is a load-bearing requirement.** Every read has to come from IndexedDB without blocking the main thread, or the animations you care about will stutter on the exact frames a user is watching.

### Decisions you already made

| Decision | Choice |
|---|---|
| Reminder scheduler | Supabase Cron (`pg_cron` + `pg_net`), every minute, free |
| Email sender | `onboarding@resend.dev` for now, domain swap is one env var |
| Sign-in | Supabase Auth: Google OAuth primary, email magic link fallback |
| v1 extras | Calendar + Kanban views, focus timer + stats, web push |
| Deferred to v2 | Shared lists and assignment (RLS and conflict cost is not worth it yet) |

## Design direction: tactile material

You asked me to pick between skeuomorphism, neumorphism, claymorphism and brutalism. My answer is a restrained modern **skeuomorphism**, which I will call **tactile material** in the docs so nobody reaches for 2010 Apple leather stitching.

Why the other three lose:

- **Neumorphism** extrudes shapes in the same color as their background, so it only reads at low contrast. It fails WCAG AA by construction, and against a single dark neutral (`#2B2D31`) every button would dissolve into the surface. It also all looks identical across every site that uses it, which fails your anti-slop test.
- **Claymorphism** is inflated pastel blobs with soft double shadows. It reads as a toy, fights an earthy adult palette, and its 24px+ padding makes a dense task list impossible.
- **Brutalism** means hard 2px borders, raw system type, no easing, deliberate friction. It contradicts "best animation and fluid motions" outright, and it is tiring in an app you open thirty times a day.

Why tactile material wins: your palette is already a **materials** palette. Clay (`#8D321F`), canvas (`#C29B72`), olive leather (`#3A4027`), slate (`#2B2D31`). Lean into physical depth and the palette does the design work for free. A checkbox that visibly depresses is the right affordance for the single most-touched control in a todo app.

The guardrails that keep it from turning into slop:

- One light source, from top, always. Every highlight sits on a top edge, every shadow falls down.
- Exactly three elevation levels. Sunken (inputs, wells), flush (surfaces), raised (cards, sheets). No fourth.
- Grain, not texture. A 2 to 3% SVG noise overlay on large surfaces. No faux paper, wood or leather imagery.
- No bevels, no gloss, no inner glow. Depth comes from a 1px top highlight plus a real drop shadow, nothing else.
- Type stays flat and crisp. No letterpress, no text shadow.
- **Motion carries the depth.** Press moves an element in Z, not just in scale. This is where the budget goes.
- Contrast stays AA regardless of what the depth wants.

Two-accent system, following the rule from `saara-hud/DESIGN.md` that nothing colored is decorative:

- **Terracotta = interaction.** Focus rings, primary buttons, selection, the check-off. "You can act here."
- **Olive = state.** Completion, streaks, progress rings, "done and good."
- **Beige = surface and text.** The warm neutral ramp, not an accent.
- Overdue and destructive get one derived hot variant of terracotta, pushed lighter and more chromatic so it never reads as merely "interactive."

## Conventions inherited from your existing projects

Confirmed by surveying `/Users/ragav/Projects`. This project follows them rather than inventing new ones.

- **npm.** Every project in the tree has `package-lock.json` and no other lockfile.
- **TypeScript strict**, plus `noUnusedLocals` / `noUnusedParameters` / `noFallthroughCasesInSwitch`. Path alias `@/*`.
- **ESLint 9 flat config, no Prettier, no Biome.** Rule exceptions carry a comment explaining themselves, matching `look/eslint.config.js`.
- **`npx tsc --noEmit` is the gate**, and it runs before any task is called done (rule from `novira/CLAUDE.md`).
- **Vitest**, tests colocated as `*.test.ts` next to the source, node environment for pure logic.
- **Tailwind v4 CSS-first.** No `tailwind.config.js`. Tokens live in one `app/globals.css` `@theme` block as OKLCH custom properties.
- **`cn()` helper** (`clsx` + `tailwind-merge`), copied from `look/src/lib/utils.ts`.
- **Domain-sliced folders, not type-sliced**, following `saara-hud/src/`.
- **Supabase migrations** as `supabase/migrations/YYYYMMDDHHMM_name.sql`.
- **`.env.example` is committed and heavily commented.** `NEXT_PUBLIC_*` for client, bare names for server only.
- **A `DESIGN.md` at the root is the design constitution.** Includes the anti-slop guardrails.
- **No commits from me.** You review and commit manually. When you do commit, it is as `ragav1n` with no Claude trailer.
- **Bump `version` in `package.json`** on every change, and surface it in the settings footer.

## Direct code reuse from `novira`

`novira` is your Next 16 + Supabase + Vercel PWA and it already solved several of these problems in production. Porting beats rewriting.

| Source | Reuse |
|---|---|
| `novira/lib/motion.ts` | Copy nearly whole. Already has `SOFT` / `SNAPPY` / `BOUNCE` / `GLIDE` springs, `EASE_GLIDE`, role tokens (`SHEET`, `MODAL`, `ROW`, `ICON_POP`) and module-scope variants. Extend with task-specific roles. |
| `novira/lib/offline-sync-queue.ts` | Port the pure state machine: exponential backoff with jitter, `createSerializedMutator`, `resetStaleSyncing`, `evictForCapacity`, `expireStaleItems`, permanent vs transient vs expired error classification. Retarget from `SyncPayload` to our outbox record. |
| `novira/lib/sync-manager.ts` | Port the runtime patterns: Web Locks (`SYNC_LOCK_NAME`) so tabs cannot double-sync, `BroadcastChannel` for cross-tab updates, `withTimeout` on mutations, `classifyPgError` with `PERMANENT_PG_CODES`, `registerBackgroundSync`. |
| `novira/hooks/usePushNotifications.ts`, `app/api/push/{subscribe,send}/route.ts` | The whole VAPID web push pipeline exists. Port it. |
| `novira/proxy.ts` | The middleware pattern for Supabase session refresh plus CSP and HSTS headers, including the note that nonce-based CSP does not work with Next static pages. |
| `novira/app/globals.css` | The `@property` trick that types custom properties as `<color>` so a theme swap can actually tween instead of snapping. |
| `look/vercel.json` | The CSP and HSTS header block shape. |

## The palette needs fixing before it can be used

I converted your four hexes to OKLCH and ran WCAG contrast on every pair. There is a problem worth knowing about up front:

| Color | OKLCH | Contrast on charcoal `#2B2D31` |
|---|---|---|
| Beige `#C29B72` | `oklch(0.716 0.073 67.6)` | **5.40** (passes AA text) |
| Terracotta `#8D321F` | `oklch(0.446 0.128 33.5)` | **1.71** (invisible) |
| Olive `#3A4027` | `oklch(0.359 0.041 119.5)` | **1.28** (invisible) |
| Charcoal `#2B2D31` | `oklch(0.297 0.008 264.4)` | - |

Three of the four colors sit between lightness 0.30 and 0.45. There is almost no lightness range in the palette, so terracotta text on a charcoal card would be unreadable and olive would be literally the same value as its background. Used raw, this palette produces an inaccessible app.

The fix keeps every one of your colors and adds nothing new. Two moves:

1. **Charcoal is the surface, not the page.** Darken charcoal along its own hue to get a page floor, so cards have something to sit on. Charcoal itself becomes the card.
2. **Each accent gets a lightness ramp at fixed hue and chroma.** Your source hex stays as the `600` step for fills. Lifted steps handle text, icons and rings. The hue never changes, so it still reads as your palette.

Names: `sand` (beige), `clay` (terracotta), `olive`, `slate` (charcoal). All numbers below are measured, not estimated.

```css
@theme {
  /* Neutral floor, derived from charcoal's hue 264 */
  --color-void:      oklch(0.185 0.008 264);   /* #111316  page background */
  --color-surface:   oklch(0.297 0.008 264);   /* #2B2D31  your charcoal, cards */
  --color-raised:    oklch(0.345 0.010 264);   /* #37393F  controls inside cards */
  --color-sunken:    oklch(0.230 0.008 264);   /*          inputs, wells */

  /* CLAY = interaction. 600 is your source terracotta. */
  --color-clay-600:  oklch(0.446 0.128 33.5);  /* #8D321F  source, fills */
  --color-clay-500:  oklch(0.520 0.128 33.5);  /* #A54834  hover fill */
  --color-clay-400:  oklch(0.600 0.128 33.5);  /* #C0604B  borders, focus ring (3.30 on surface) */
  --color-clay-300:  oklch(0.680 0.128 33.5);  /* #DB7963  text + icons (4.54 on surface) */
  --color-clay-200:  oklch(0.760 0.128 33.5);  /* #F7917B  overdue, destructive */

  /* OLIVE = state. 600 is your source olive. */
  --color-olive-600: oklch(0.446 0.055 119.5); /* #505935  fills */
  --color-olive-400: oklch(0.600 0.055 119.5); /* #7C8560  progress rings (3.55 on surface) */
  --color-olive-300: oklch(0.680 0.055 119.5); /* #949E77  done text + checks (4.86 on surface) */

  /* SAND = warm neutral, from beige's hue 67.6 */
  --color-sand-300:  oklch(0.680 0.073 67.6);  /* #B79067  4.73 on surface */
  --color-sand-500:  oklch(0.716 0.073 67.6);  /* #C29B72  your source beige */

  /* Text, warm-tinted so it belongs to the palette. Never pure white. */
  --color-text-hi:    oklch(0.960 0.012 67.6); /* #F7F0E9  12.26 on surface */
  --color-text-mid:   oklch(0.790 0.020 67.6); /* #C4B8AD   7.12 */
  --color-text-lo:    oklch(0.670 0.024 67.6); /*           4.52, the AA floor for body text */
  --color-text-faint: oklch(0.550 0.022 67.6); /*           2.7, non-text decoration only */
}
```

Rules that fall out of this, and they are not negotiable:

- **Source terracotta `#8D321F` is a fill color only.** It never carries text or an icon. Text on top of it is `--color-text-hi`.
- **Source olive `#3A4027` is a fill color only**, and only on `--color-void`, never on a card.
- `--color-text-faint` is banned from anything a user has to read. Dividers and decoration only.
- Light theme ("parchment") inverts to a beige page with charcoal text, which measures 5.40 and works. Terracotta on beige is 3.15, so on light it is also fill-only. Ship dark first, light second.

The 3% grain overlay and the depth shadows are defined against `--color-void`, so they read consistently at every elevation.

## Sync architecture

Local-first. Postgres is the source of truth, IndexedDB is the working copy, and the UI never waits on the network.

**Store: Dexie 4.4 on IndexedDB with a hand-written sync engine.** I checked the alternatives and rejected them: PowerSync ships a 1MB+ SQLite WASM bundle and needs a third paid vendor, ElectricSQL only solves the read path and needs its own server, RxDB paywalls the useful plugins, Legend-State does whole-row last-write-wins which loses concurrent edits. Since this is one user's data per account, conflicts are rare enough that a framework's main value does not apply. Total data-layer cost on the critical path is about 32kb gzip.

Packages: `dexie`, `dexie-react-hooks`, `uuidv7`, `fractional-indexing`, `@supabase/ssr` (auth only, dynamically imported), `@serwist/next`, `fake-indexeddb` for tests.

### The three decisions that make it correct

**1. The sync cursor is a server-assigned counter, never a timestamp.** This is the highest-severity bug class in offline sync, so it gets designed out rather than patched. A `WHERE updated_at > watermark` pull has a commit-visibility race: a transaction can take an earlier timestamp yet commit after a later one, so rows get skipped permanently and silently. Instead every user has a `sync_state(user_id, version bigint)` row, and a trigger on every synced table stamps `row_version = next_user_version(user_id)`. That function does `UPDATE ... RETURNING version`, which holds a row lock until commit, so versions for a user commit in strictly ascending order. `WHERE row_version > cursor ORDER BY row_version` is then gap-free. The wire cursor is an opaque string so shared lists can later make it a per-space map with no protocol break.

**2. One write API, one transaction.** The UI never calls `db.tasks.put`. Every mutation goes through `lib/db/mutations.ts`, which in a single Dexie readwrite transaction applies the optimistic local row *and* appends the outbox record. This makes "local state changed but nothing queued" structurally impossible. An ESLint rule bans direct table writes outside that file.

**3. Per-field merge, not whole-row.** The trigger also maintains `field_versions jsonb` by diffing `to_jsonb(OLD)` against `to_jsonb(NEW)`. A pushed field applies if `field_versions[field] <= mutation.baseVersion`, otherwise it is dropped and logged. Clock-free and server-authoritative. This is what makes the classic case work: complete a task on your phone while retitling it on your laptop, and you get a completed *and* retitled task instead of one edit erasing the other. Related fields are grouped (`status` + `completedAt`, `dueAt` + `dueTimezone`) so they can never tear apart.

### Consequences worth calling out

- **Client-generated UUIDv7 ids** mean there is never a server round trip for an id, so a subtask created offline inside a project created offline commits atomically as one batch.
- **Ordering: `rank` is a fractional index string**, not an integer. Two devices reordering different parts of a list never touch each other's rows. Tie-break on `(rank, id)`, rebalance when a key passes 40 chars.
- **Deletes are tombstones** (`deleted_at` as an ordinary field), so undelete is just another field write and delete-versus-edit needs no special case.
- **Lost responses cost nothing.** `mutation_log(mutation_id primary key)` returns the original result on retry, so a dropped ack can never double-apply.
- **IndexedDB cannot index null, undefined or booleans**, so the local rows carry derived numeric fields (`_del`, `_done: 0|1`), a `_dueDay` string with a `'9999-12-31'` sentinel for no due date, and multiEntry `_tagIds` / `_words` arrays for tag filtering and prefix search with no extra dependency. Derivation lives in exactly one file so the optimistic path and the server-apply path cannot diverge.
- **One IndexedDB database per user** (`todo_${userId}`), which is the clean answer to signing in as a different account.
- **Sign out keeps the outbox.** Erasing local data is a separate destructive action that refuses silently-unsynced work without an explicit confirm showing the count.

### Reads and reactivity

`dexie-react-hooks` `useLiveQuery` directly, with no TanStack Query and no Zustand mirror for persisted data. Optimistic UI becomes structural instead of bolted on: write to Dexie, the live query re-fires, the component re-renders. There is no rollback logic to get wrong. Zustand holds ephemeral UI state only (open sheets, selection, drag in progress).

Three mechanisms kill loading flicker: a placeholder third argument so the first render is `[]` and never `undefined`; a `useStableLiveQuery` wrapper that retains the previous result while deps change so switching projects does not blank the list; and a synchronous `localStorage` flag that decides skeleton (returning user) versus empty state (new user).

### Service worker

Serwist via `app/sw.ts`. Two rules: **no authenticated response ever enters the cache**, and IndexedDB rather than the SW is the offline read source. `NetworkOnly` for `/api/*`, `/auth/*` and `*.supabase.co` as the *first* matching entries, `CacheFirst` for `/_next/static/**` including self-hosted fonts, `NetworkFirst` with a 3s timeout for navigations. This is safe only because the whole authenticated app is a client-rendered route group whose HTML contains zero user data.

`skipWaiting: false` plus an explicit "update available, reload" prompt, because auto-skipWaiting can swap assets under a tab that is mid-IndexedDB-upgrade.

**Background Sync is a bonus, not the mechanism.** iOS Safari has neither Background Sync nor Periodic Background Sync, so foreground triggers are the primary path on every platform: `online`, `visibilitychange`, `focus`, `pageshow`, a 500ms debounce after a mutation, and a 60s tick while visible. The contract is that a flush begins within 200ms of the app becoming visible and online. Where Background Sync does exist, the `sync` handler is only a wake-up that posts a message to a client, because replaying raw queued requests would send a stale JWT and bypass coalescing.

### Data layer file tree

```
lib/db/
  client.ts      Dexie subclass, per-user db name, open() wrapped in the recovery ladder
  schema.ts      every version().stores() block, kept forever, additive only
  derive.ts      the ONLY place _del/_done/_dueDay/_tagIds/_words are computed
  queries.ts     typed hot-path queries: today, upcoming, byProject, byTag, search, counts
  mutations.ts   the ONLY write API
  recovery.ts    corrupt-db ladder: reopen, rescue outbox to localStorage, delete + rehydrate
  persist.ts     navigator.storage.persist()/estimate(), quota-pressure pruning
  reminders.ts   local reminder scheduler + firedForAt dedupe (local-only table)
lib/sync/
  machine.ts     pure reducer (state, event) => [state, effects]. Zero I/O, fully unit-testable.
  engine.ts      wires the machine to real effects, owns the cycle (always push then pull)
  outbox.ts      enqueue, coalesce, claim/ack, backoff, deadletter promotion
  push.ts        batch builder (<=200 mutations, <=512KB) + POST + ack application
  pull.ts        cursor pagination, fullResync, purge application
  apply.ts       idempotent chunked bulkPut, yields between 500-row chunks
  triggers.ts    online/visibility/focus/pageshow/timer/SW-message wiring
  leader.ts      navigator.locks election so exactly one tab syncs
  protocol.ts    shared Pull/Push types (type-only import on the client)
  rank.ts        fractional-indexing wrappers
  errors.ts      retryable | fatal | reauth | quota classification
app/api/sync/pull/route.ts, app/api/sync/push/route.ts
```

Route handlers rather than client-side `supabase-js` for sync, for three reasons: the server has to stamp time and version (a client sending its own `updated_at` is exactly what we forbade), an atomic multi-table push with FK ordering has to be one plpgsql function, and field-level merge needs `field_versions` which only the server holds. Both call a `SECURITY INVOKER` RPC with the user's cookie session, so RLS still applies and the service-role key never leaves the server.

### Sync states

`BOOT → OPENING_DB → {HYDRATING | IDLE | FOLLOWER | NO_SESSION | RECOVERING}`, then steady-state `IDLE ⇄ PUSHING → PULLING`, with `BACKOFF`, `OFFLINE`, `REAUTH_REQUIRED`, `PAUSED_QUOTA` and `FATAL` as the exits. `REAUTH_REQUIRED` is the important one: an expired refresh token halts sync, leaves the outbox untouched, and shows a re-login sheet over a **fully working app** that keeps reading and queuing writes locally. Nothing in the UI ever gates rendering on `getSession()`, because that call fails offline.

## Postgres schema

Full DDL goes in the migrations. These are the decisions behind it.

**Universal columns on every synced table:** `id uuid` (client-generated UUIDv7), `user_id`, `created_at`, `updated_at`, `deleted_at`, plus `row_version bigint` and `field_versions jsonb` for the sync layer. One trigger stamps all of the server-owned ones. Clients may never send `updated_at`, `row_version`, `field_versions`, `completed_at`, `depth` or `search_vector`.

**Client-generated ids, not server defaults.** An offline create needs its final identity the instant it exists, because a subtask, three tag rows and two reminders all reference the task before any network call. Server-assigned ids force a temp-id to real-id remap across the whole local object graph on every sync, and that remap is the most bug-dense part of any offline client. UUIDv7 rather than v4 for B-tree insert locality.

**Composite tenancy foreign keys.** Every parent gets a redundant-looking `unique (user_id, id)`, and every child references `(user_id, parent_id)` instead of just `parent_id`. This makes it structurally impossible to attach your project to another user's area with no RLS, no trigger and no application check involved. The redundant unique index doubles as the RLS covering index, so it costs nothing.

**`text` + `CHECK` instead of Postgres enums** on every status column. `ALTER TYPE ADD VALUE` cannot be reverted or reordered and breaks rolling deploys where an old client still writes old values. A check constraint is one drop and add in a migration.

**Tables:** `profiles`, `user_settings`, `areas`, `projects`, `tasks`, `tags`, `task_tags`, `task_series`, `task_reminders`, `saved_views`, `devices`, `focus_sessions`, `activity_log`, and the pipeline set (`reminder_deliveries`, `email_events`, `email_suppressions`, `email_quota_days`, `cron_heartbeats`, `notification_recompute_queue`).

### Four schema decisions worth defending

**1. Subtasks are `tasks.parent_task_id`, self-referencing, capped at depth 1. No separate checklist table.** One table means one sync channel, one RLS policy set, one conflict rule, and subtasks inherit every task feature for free. The moment you want a due date on a checklist item (you will, within a week), a separate table becomes a schema migration plus a data migration plus a client migration. Depth is capped because unbounded trees force recursive CTEs into every rollup and reorder, and nobody wants sub-sub-subtasks. "Checklist item" is a rendering choice, not a storage choice.

**2. Projects are their own table, not tasks with a `type` flag.** Merging them means every list query needs `and type = 'task'`, and that filter will be forgotten exactly once, in one query, and silently leak projects into your Today list.

**3. Three date columns on `tasks`, not one.** `due_date` is a commitment, `start_date` hides the row until then, `planned_for` is "I intend to do this today." Collapsing `planned_for` into `due_date`, which is what most homegrown todo apps do, makes every task you touch look overdue tomorrow. This one column is the difference between a Today list that feels like a plan and one that feels like a pile of missed deadlines.

**4. Tasks store wall-clock time, never `timestamptz`.** A task due "tomorrow 9am" is due at 9am wherever you are standing. Storing an instant means flying to a different timezone silently reschedules everything you own, and DST silently shifts every recurring 9am task by an hour. `due_date date` + `due_time time`, no zone. Absolute instants exist in exactly two places in this schema: `reminder_deliveries.scheduled_at` and `focus_sessions.started_at`. Changing your timezone therefore rewrites pending delivery rows and touches zero task rows.

### Recurrence: structured columns, not RRULE strings

RRULE loses on three counts. It **cannot express** the most-used todo recurrence, "every 3 days after I finish it", because RFC 5545 describes a fixed calendar series and not a completion-relative one. Postgres **cannot read** it (no RRULE evaluator in Supabase's extension set), so the reminder pipeline and digest could not answer "what is the next instance." And `rrule.js` is roughly 40kb gzipped in a PWA whose whole point is a fast cold start.

So `task_series` holds structured columns: `freq`, `interval`, `byday smallint[]`, `bymonthday`, `bymonth`, `month_week`. A `kind` discriminator (`'structured' | 'rrule'`) reserves the escape hatch, and `.ics` export serializes the structured subset at export time.

Two columns carry the semantics that matter:

- **`anchor_mode`.** `'due_date'` computes the next due from the previous *scheduled* date, so completing Monday's task on Wednesday still yields next Monday and the schedule never drifts. `'completion_date'` computes from your local completion date, so watering the plants 3 days after you actually watered them works.
- **`catchup_policy`.** Complete a "every Monday" task three weeks late and advancing one interval leaves the next due date still in the past. `'skip_to_future'` advances until the next due is after today and counts the skips. `'keep_backlog'` emits the immediate next occurrence anyway, which is what habit logging wants.

**Materialize on complete, exactly one open instance per series.** Virtual instances computed at read time have nowhere to put per-occurrence state (notes, subtask progress, "I moved this one to Thursday"). Pre-generating N instances bloats the sync payload, turns "edit all future occurrences" into an N-row rewrite, and silently stops when N runs out. Materializing on complete means the client computes the next date locally with a shared pure function and inserts the row itself, so it works fully offline.

The next instance is **cloned from the completed one**, so the series row holds only the rule and counters. No duplicate set of template columns, no `task_series_tags`, no `task_series_reminders`. "Edit all future occurrences" becomes "edit the current open occurrence," which is how users already expect it to behave.

`lib/recurrence.ts` is a pure TypeScript function and the single source of truth. The offline client and any server-side generation both import it. It gets heavy unit tests, including DST boundaries and month-end rollovers.

**The two-device recurring race** is handled by `unique (series_id, occurrence_seq) where series_id is not null and deleted_at is null`. Two devices offline both complete the same instance and both generate occurrence 5. First writer wins; the loser gets a 23505 on that row and resolves deterministically by discarding its local instance and accepting the server's. A retried sync batch re-inserting the identical row hits the same constraint and is treated as success. No duplicate occurrence, ever, and no merge heuristics.

### RLS

Enabled on every table, per-command policies, `TO authenticated`, and every policy is a bare comparison on an indexed `user_id`. Three rules:

1. **Always wrap as `(select auth.uid())`.** Bare `auth.uid()` is a `STABLE` function reference inside the row filter and gets re-evaluated per row; wrapped in a scalar subquery the planner hoists it to a one-time InitPlan. This is the single highest-leverage line in the schema. Add a CI check that greps migrations for `auth.uid()` not preceded by `select`.
2. **No `EXISTS` and no joins inside a policy.** This is why `task_tags` carries a denormalized `user_id` (the composite FKs guarantee it cannot lie) rather than joining back to `tasks` per row.
3. **`tasks` deliberately has no DELETE policy.** Clients cannot hard-delete. Soft delete sets `deleted_at`; physical purge is a `service_role` cron. A buggy client can never destroy history.

Shared lists later need no rewrite, because Postgres ORs permissive policies together: add a `project_members` table and *append* a second SELECT policy per table without touching the existing ones.

## Reminder pipeline

`pg_cron` fires `notifications_tick()` every minute. The tick reaps stale locks, drains a recompute queue, runs the periodic enqueues, and then **only POSTs to Vercel if there is actually work**, which keeps function invocations near zero on idle days instead of burning 1,440.

```
pg_cron (every minute)
  └─ notifications_tick()
       ├─ reap locks stuck in 'claimed' > 5 min
       ├─ drain notification_recompute_queue (bounded to 500)
       ├─ enqueue_daily_digests() / _overdue_nudges() / _weekly_reviews()
       └─ if work exists: net.http_post -> POST /api/cron/reminders  (x-cron-secret)
                                            └─ claim 25, coalesce, render, Resend, mark
```

The shared secret and the URL live in **Supabase Vault**, fetched inside the function. Never inlined into `cron.schedule`, because `cron.job.command` is readable by anyone who can read the `cron` schema.

### `pg_net` is fire-and-forget, so the endpoint is self-healing

The cron run cannot learn whether its HTTP call succeeded. Two mitigations. The endpoint claims **everything overdue** rather than only what is due this exact minute, so a dropped minute is absorbed by the next one. And the route handler writes a `cron_heartbeats` row, because `cron.job_run_details` only proves the SQL ran, not that the HTTP landed. Alert on no heartbeat in 10 minutes.

### Idempotency has three layers

The dangerous window is "Resend accepted the email, then the process died before writing `sent`."

1. **`dedupe_key` with a unique index.** Deterministic and derived only from inputs: `'tr:' || reminder_id || ':' || to_char(scheduled_at,'YYYYMMDDHH24MI')` for a task reminder, `'dd:' || user_id || ':' || local_date` for a digest. Recompute can run five times for one offline batch and `on conflict do nothing` yields exactly one row. The digest key uses the **local calendar date**, so you cannot get two digests in one day even across a DST fall-back where 01:30 local happens twice.
2. **Atomic claim** with `for update skip locked`, incrementing `attempts` at claim time and not send time, so a process that crashes mid-send is bounded by `max_attempts` instead of looping forever. A five-minute reaper returns stuck rows to `pending`.
3. **Resend's `Idempotency-Key` header** set to the `dedupe_key`, so a retry after a crash returns the original result instead of sending a second email. Paired with freezing the render payload into `payload jsonb` at claim time, so attempt 2 renders byte-identical content even if the task changed in between.

### Timezone conversion happens in exactly one place

Stored: wall clock on tasks, an IANA name on `user_settings`. Converted: in Postgres, at delivery-row generation.

```sql
(t.due_date + coalesce(t.due_time, u.all_day_reminder_time)) at time zone u.timezone
  + make_interval(mins => r.offset_minutes)
```

`timestamp AT TIME ZONE 'Asia/Kolkata'` interprets a naive value as local in that zone and returns a `timestamptz`. That is the direction people get backwards and the direction we need. It resolves against Postgres's bundled tzdata, so DST is correct by construction including rules that apply months ahead.

**At send time there is zero timezone logic.** The claim predicate is `scheduled_at <= now()`, a UTC comparison against a tiny partial index. That is the whole point of the design.

Changing your timezone fires a trigger that cancels pending deliveries and queues affected tasks for recompute. Zero task rows change.

**Digests use a catch-up predicate, never equality.** `where local_time = digest_time` breaks on spring-forward: a 02:30 digest time does not exist that day and the user silently gets nothing. Instead, "if local time is at or past `digest_time` and no digest row exists for today's local date, enqueue one," with `digest_time` constrained to 04:00 through 20:00 so the window never wraps midnight. DST-proof in both directions and self-healing across missed cron minutes.

### Reminder rows are recomputed by enqueue-then-reconcile

Triggers on `tasks`, `task_reminders` and `user_settings` fire only on the columns that actually affect scheduling (`after update of due_date, due_time, start_date, status, ...`), and they only *mark work* into an `unlogged` recompute queue. The per-minute tick drains it and does the set-based recompute. Retitling a task in a 200-row offline batch does not stampede the queue, and heavy work stays out of the sync transaction's lock window.

Doing this in application code on the sync path was rejected: an offline batch touching 200 tasks becomes 200 round trips with a partial-failure window, and it silently misses every write that does not go through that one code path. A nightly full reconciler repairs anything the queue missed.

For the edge case of saving a task due in under five minutes, the app calls `recompute_task_notifications(id)` inline after the sync write, so interactive precision does not wait for the tick.

### Living inside Resend's 100/day

| Email | Cadence | Per user per day |
|---|---|---|
| Morning digest, "here is your day" | 1 at `digest_time` | 1 |
| Task reminder | per reminder, coalesced in 10-minute windows | 0 to 20 |
| Overdue nudge | 1 at `nudge_time`, only if overdue items exist | 0 to 1 |
| Weekly review | 1 per week | 0.14 |

The digest is the volume weapon: one email carrying today's plan, overdue items, due-soon items and streaks replaces a dozen individual reminders. Four layers of defense: coalescing reminders for the same user inside a 10-minute window into one multi-item email, a per-user `max_reminder_emails_per_day` cap (default 20) whose excess becomes visible `skipped` rows rather than silence, a global `email_quota_days` reservation with a ceiling of 90 that defers by priority when hit (task reminders win, weekly review loses), and folding overdue into the digest. Realistic steady state for one person is well under 20 a day. The caps exist so a runaway recurring series cannot burn the month's 3,000 in an afternoon.

### Email templates

React Email components under `emails/`, rendered at send time, always producing both HTML and a hand-written plaintext alternative.

Email is not the web. `<Section>`/`<Row>`/`<Column>` compiling to real `<table>` elements for all layout, because Outlook's Word rendering engine ignores flexbox, grid and `position`. All CSS inline. 600px max width. Full font stacks, since webfonts silently fail in Outlook. A hidden preheader div as the first body element or the inbox preview shows "View in browser". 4px button radius, accepting square corners in Outlook rather than putting VML in the codebase.

Palette mapping differs from the app, because email has no dark surface to work against:

| Role | Color |
|---|---|
| Page background | warm off-white `#FAF7F2` |
| Body text | charcoal `#2B2D31`, never pure black (it triggers the most aggressive client inversion) |
| Headings, dividers | olive `#3A4027` |
| Primary CTA background | terracotta `#8D321F` with `#FFF8F0` text, about 7.5:1 |
| Surfaces, rules, tag chips | beige `#C29B72`, **backgrounds only** (beige on white is 2.1:1, unusable for text) |

Dark mode in email is a bonus, never load-bearing. Outlook.com and the Gmail app force-invert regardless of your CSS, so the defense is an explicit `background-color` on **every table cell** rather than just `<body>`, since an unstyled cell is what inverts into mush. Apple Mail honors `prefers-color-scheme` if you declare `color-scheme` and `supported-color-schemes` meta tags, and Gmail strips media queries. Ship a light design that survives inversion. The logo goes out as a PNG with its background baked in, because transparent PNGs vanish on inverted backgrounds.

### Safety, because this is the part that goes wrong

You chose `onboarding@resend.dev`, which only delivers to your own Resend account address. That is a natural sandbox for now. The config is one env var (`EMAIL_FROM`), and the plan includes the SPF, DKIM and DMARC record set for when you add a domain: send from a `mail.` subdomain so a reputation problem never contaminates your root domain, and walk DMARC from `p=none` through `quarantine` to `reject`.

The unsubscribe link is a signed `jose` JWT with `purpose` and `aud` claims and an `email_token_version` counter in `user_settings`, so bumping that integer revokes every outstanding link. Never a raw `user_id` in a URL. The one-click POST arrives from the mail provider with no cookies, so that route is exempt from auth and CSRF, validates the token alone, and is idempotent.

A Resend webhook at `/api/webhooks/resend` verifies the Svix signature **before parsing the body** and rejects timestamps older than 5 minutes. Hard bounces and complaints write `email_suppressions` and flip `email_enabled` off. The claim loop re-checks suppression at send time, so a suppression landing mid-batch still takes effect.

**Six layers of dev guard**, because one is never enough. `EMAIL_MODE` of `off | console | catchall | live`, defaulting to `off` when `VERCEL_ENV !== 'production'`. `console` mode exercises the whole pipeline and writes rendered HTML to the log with zero network. `catchall` rewrites recipients to a dev inbox and prefixes the subject with the original address. A hard assertion throws before the send call if the recipient domain is not allowlisted outside production. Separate Resend keys per environment. And the load-bearing one: **refuse to send if `NODE_ENV === 'development'` while `SUPABASE_URL` points at production**, because that is the mistake that actually happens.

## Reconciling the two designs

The sync design and the schema design disagreed on one point, and it matters:

**The sync cursor is `row_version`, not `updated_at`.** `updated_at` is assigned before commit, so two concurrent transactions can commit out of timestamp order and a `updated_at > cursor` pull can skip a row permanently. One proposal was to paper over this with a 5-second overlap window and dedupe by `(id, updated_at)`. The other was to add a per-user monotonic counter stamped under a row lock held until commit. **Take the counter.** An overlap window is a probabilistic patch on a correctness bug: it shrinks the race, and a slow transaction still loses data silently. The counter eliminates it structurally for the cost of one extra table and one trigger. `updated_at` stays on every table for display and debugging.

Consequences to carry through: every synced table gets `row_version bigint` and `field_versions jsonb`, both stamped by the same trigger that sets `updated_at`, and the ordering column is named `sort_key` with **`collate "C"`**. That collation is mandatory and easy to miss: the default ICU collation does not order ASCII the way JavaScript `<` does, so without it a server `ORDER BY sort_key` silently disagrees with the client's local sort of the same rows. A test asserts the two agree on a shared fixture.

## Frontend architecture

Every data read comes from IndexedDB on the client, so the authenticated app is one client-rendered route group. This is also what makes the service worker safe, since the cached HTML contains zero user data.

```
app/
  layout.tsx                 fonts, MotionConfig with the house spring, theme, viewport meta
  manifest.ts                web app manifest
  sw.ts                      Serwist service worker
  ~offline/page.tsx          static precached fallback
  (auth)/signin/page.tsx     Google OAuth + magic link
  (app)/layout.tsx           'use client' shell: sidebar, command palette, sync badge, sheet host
    today/ upcoming/ inbox/ anytime/ someday/ logbook/
    project/[id]/  tag/[id]/  view/[id]/
    calendar/  board/  focus/  review/  settings/
  api/sync/{pull,push}/route.ts
  api/cron/{reminders,keepalive}/route.ts
  api/push/{subscribe,send}/route.ts
  api/email/{prefs,unsubscribe}/route.ts
  api/webhooks/resend/route.ts
components/
  ui/         primitives: Button, Field, Sheet, Popover, Menu, Toggle, Segmented, Ring, Skeleton
  task/       TaskRow, TaskCheck, TaskDetail, QuickAdd, PriorityFlag, DueChip, SubtaskList
  views/      TodayView, UpcomingView, ProjectView, CalendarView, BoardView, ReviewView
  shell/      Sidebar, MobileNav, CommandPalette, SyncBadge, UpdatePrompt, InstallPrompt
  motion/     Reveal, Stagger, LayoutRow, Celebrate
lib/
  motion.ts       motion tokens, ported from novira and extended
  parse.ts        natural language quick add
  recurrence.ts   pure next-occurrence function, shared with the server
  keys.ts         keyboard shortcut map
emails/           React Email templates
```

Routes are real routes, not client state, so back button, deep links and the command palette all work. The whole `(app)` group is client-rendered, and the server shell still earns its place by shipping fonts, theme tokens and the sidebar chrome in the first HTML paint, so there is no layout shift when Dexie opens roughly 10ms later.

Views to build: Today (planned + overdue), Upcoming, Inbox, Anytime, Someday, Logbook, project, tag, saved view, calendar with drag to reschedule, board grouped by status or project, focus timer, review with stats, settings, search.

## Animation

Library: **`motion` v13** (the current name for framer-motion), installed with `<MotionConfig>` at the root so any `motion` element with no `transition` inherits the house spring. No GSAP. Novira needed it for one orchestrated summon sequence; nothing here does, and skipping it saves the bundle.

`lib/motion.ts` is ported from `novira/lib/motion.ts`, which already encodes the smoothness you want: `SOFT` (spring, stiffness 200, damping 26, mass 0.85) as the app default, `EASE_GLIDE` at `cubic-bezier(0.16, 1, 0.3, 1)` for anything that translates, and the rule that list rows use a tween rather than a spring so they cannot overshoot into each other. Two things get added:

```ts
/** Task check-off. The one interaction that must feel perfect. */
export const CHECK_PRESS   = { duration: 0.09, ease: EASE_OUT_SOFT };
export const CHECK_RELEASE = { type: 'spring', stiffness: 320, damping: 22, mass: 0.6 };
export const CHECK_DRAW    = { duration: 0.22, ease: EASE_GLIDE };
export const STRIKE        = { duration: 0.26, ease: EASE_GLIDE, delay: 0.06 };

/** Depth. Tactile material means press moves in Z, not just scale. */
export const PRESS_DEPTH = { duration: 0.10, ease: EASE_OUT_SOFT };  // y +1px, shadow tightens
export const LIFT        = { type: 'spring', stiffness: 260, damping: 24 }; // drag pickup
```

### The interaction table

| Interaction | Technique | Timing |
|---|---|---|
| Task check-off | SVG `pathLength` 0 to 1, box fill crossfade to `olive-600`, strikethrough via `scaleX` from left | press 90ms, draw 220ms, strike 260ms at +60ms delay |
| Press any control | `y: 1px` plus shadow tightening, never scale alone | 100ms `EASE_OUT_SOFT` |
| Row enters list | `rowVariants` opacity plus `y: 10`, staggered 50ms | 320ms tween |
| Row exits | opacity to 0, `scale: 0.97`. Never animate `height` | 320ms tween |
| Row reorder | `LayoutGroup` plus `layout` prop on rows | `SOFT` spring |
| Drag pickup | `LIFT` spring, shadow grows, row lifts 4px | spring 260/24 |
| Row to detail | `layoutId` shared element on the title and check | `SOFT` spring |
| View change | `AnimatePresence mode="popLayout"`, stagger children | 320ms |
| Bottom sheet | Motion `drag="y"` with `dragElastic: 0.08`, velocity dismiss over 500px/s | `SHEET` spring 320/30 |
| Swipe to complete | `drag="x"` with a 72px threshold, same pattern as `novira/components/transaction-row.tsx` | `GLIDE` |
| Command palette | `cmdk` plus `modalVariants`, backdrop blur fade | `MODAL` |
| Progress ring | `strokeDashoffset` on a spring, `CountUp` on the label | `SOFT` |
| Streak counter | reactbits `CountUp` | 900ms |
| Day cleared | one-time particle bloom in olive and clay, no generic confetti | 1.1s, then unmount |
| Toast | `sonner` with our tokens | `SHEET` |
| Skeleton to content | crossfade, no layout change | 260ms |

### Performance rules, with a budget

Animate `transform` and `opacity` only. The one exception is `strokeDashoffset` on the rings, which is cheap because the elements are tiny. Never animate `height` inside `AnimatePresence`, because that forces a layout pass per frame per row.

- Interaction to first painted frame under **100ms**. No frame over **16.6ms** during any list animation.
- Lists virtualize above 60 rows with `@tanstack/react-virtual`. Virtualized rows drop the `layout` prop, since layout animation on windowed content fights the scroller.
- `will-change` is set on drag start and removed on drag end, never left in CSS.
- Dexie reads are index-bound and limited, and the sync engine moves to a worker in phase 3 so a large hydration cannot land on the frame the user is watching.
- `prefers-reduced-motion` is a real path, not a switch that sets duration to zero: `useReducedMotion()` swaps springs for 120ms opacity fades, disables the particle bloom and the stagger, and keeps the check draw because it carries meaning. `MotionConfig reducedMotion="user"` handles the rest.

### iOS PWA specifics

`viewport-fit=cover` plus `env(safe-area-inset-*)` padding on the shell. `100dvh` rather than `100vh`. `overscroll-behavior: none` on the scroll container to kill rubber-band on the page while keeping it inside the sheet. `-webkit-tap-highlight-color: transparent`. `display: standalone` in the manifest. `navigator.vibrate(12)` on check-off where it exists, which is Android only, wrapped in a capability check.

Web push needs the app added to the Home Screen on iOS 16.4+, since `PushManager` does not exist in a Safari tab. So the push permission prompt only appears when `display-mode: standalone` matches, and the settings screen explains the Home Screen step instead of showing a dead button.

## What I need you to source

Send me the ones whose **motion** you like. I will re-skin every one of them to the token system above, so ignore their colors entirely. A component that hardcodes a purple gradient is fine if the timing feels right.

Formats: uiverse gives raw HTML plus CSS, paste it as-is. reactbits is already React plus TypeScript, paste the file. fffuel gives SVG, paste the markup.

**First, because they block the core feel:**

1. **Animated checkboxes, 3 or 4 candidates.** uiverse.io, search "checkbox". This is the most-touched control in the app and I want to pick the feel from real options rather than guess. Looking for a satisfying draw or fill, not a bounce.
2. **Grain and noise SVG.** fffuel.co, the `nnnoise` tool. One subtle grain at 2 to 3% opacity. This is what makes the tactile material direction read as material instead of flat.
3. **Radial progress rings, 2 candidates.** uiverse.io, search "progress" or "loader", or reactbits if it has one. For the daily completion ring.
4. **Toggle switches.** toggle.supply. Settings screen, roughly a dozen of them.

**Second, for polish:**

5. **reactbits.dev components**, pasted as files: `CountUp` (streaks and stats), `SplitText` or `BlurText` (view headings, used once per view and not everywhere), `SpotlightCard` or `TiltedCard` (review screen stat cards only).
6. **A subtle celebration.** Something for clearing the day. Please avoid stock confetti. A particle bloom or a soft radial pulse suits the palette better.
7. **Empty state illustration or pattern.** fffuel.co has pattern and blob generators. Four empty states need one: Inbox, Today done, no search results, new project.

**Do not source these, I will build them:** command palette (`cmdk`), bottom sheet (Motion drag, since sourced ones rarely get rubber-band plus scroll lock right), toasts (`sonner`), skeletons, segmented control (trivial with `layoutId`), date picker (`react-day-picker` restyled).

**Icons: `@phosphor-icons/react`, regular and bold weights.** Installed as a package rather than copied from iconbuddy, so it tree-shakes and stays consistent. Phosphor over Lucide here because its slightly softer terminals suit the warm palette, and it has the density needed for a task app. One family only.

## Build phases

Each phase ends with something that works.

**Phase 0, local only.** Next 16 scaffold, tokens, fonts, `DESIGN.md`, Dexie schema, `mutations.ts`, `useLiveQuery` hooks, TaskRow with the check-off, QuickAdd with natural language parsing, Today and Inbox views. No server at all. **This is already a usable offline task app**, and it is where the design gets locked in.

**Phase 1, sync.** Supabase project, migrations 0001 through 0003, RLS, both RPCs, both route handlers, the outbox, the state machine, foreground triggers. Two devices converge.

**Phase 2, reminders.** `reminder_deliveries`, recompute triggers, `notifications_tick`, `pg_cron` schedule, the cron route, React Email templates, settings for digest and quiet hours. Plus one daily Vercel cron at `/api/cron/keepalive`, which is exactly what the Hobby once-per-day allowance is good for: **Supabase pauses free projects after 7 days with no requests, and `pg_cron` does not count as activity because it runs inside the database.** Without that ping, a week away from the app silently kills your reminders.

**Phase 3, PWA hardening.** Serwist, manifest, icons, offline fallback, install prompt, update prompt, leader election, `storage.persist()`, the recovery ladder, web push.

**Phase 4, the extras you picked.** Calendar with drag to reschedule, board view, focus timer, review and stats. Recurring tasks land here or in phase 1 depending on how early you want them.

**Phase 5, depth.** Command palette, keyboard map, bulk select, undo via the activity log, saved views, light theme, `.ics` export.

## Verification

- `npx tsc --noEmit` and `npm run lint` gate every phase. This is the house rule from `novira/CLAUDE.md`.
- **Vitest unit tests** on the pure logic, colocated: `machine.ts` as a pure reducer with no I/O, `recurrence.ts` across DST boundaries and month-end rollovers, the outbox coalescing rules, `parse.ts` on natural language input, and the fractional index helpers.
- **A convergence test** is a phase 1 deliverable, not optional. Two `fake-indexeddb` clients against local Supabase in Docker, asserting they converge under interleaved writes, a simulated partition, and duplicate delivery. This is the test that justifies a hand-written sync engine.
- **A contrast test** asserts every token pair used for text clears 4.5:1, so the palette problem found above cannot creep back in.
- **A collation test** asserts a Postgres `ORDER BY sort_key` matches the client's JavaScript sort of the same fixture.
- **Offline behaviour through Playwright MCP**: load the app, go offline, create and complete tasks, reload while still offline and confirm the data is there, come back online and confirm the outbox drains. This is the requirement that is easiest to believe is working when it is not.
- **Emails** are iterated in the React Email preview server, which sends nothing. Real sends go to Resend's `delivered@resend.dev` and `bounced@resend.dev` sinks. `EMAIL_MODE=console` exercises the whole pipeline with no network.
- **The cron** is verified with `select * from cron.job_run_details order by start_time desc limit 20`, plus the `cron_heartbeats` table, since the first only proves the SQL ran and the second proves the HTTP landed.
- **Lighthouse** installability and PWA audit, then a real install on your iPhone and laptop, because Home Screen install is what unlocks web push on iOS.

## Scope note

This is a large build, and I would rather say so than imply it lands in one sitting. Phase 0 is a genuinely useful offline task app and is the fastest path to something you use daily. Phases 1 and 2 are where the real engineering sits, mostly in SQL. If you want to compress, the honest cut is phase 4: calendar and board views are the most visual and the least load-bearing, and deferring them does not change any schema.

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

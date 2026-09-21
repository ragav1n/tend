import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The lint guard has to know about every synced table.
 *
 * `eslint.config.mjs` bans direct Dexie writes outside `mutations.ts`, which is
 * what keeps "local row changed but nothing queued" impossible. The rule names
 * its tables in a regex, and that list went stale: six of sixteen were covered,
 * so every table added after phase 3 could be written straight from a component
 * and lint said nothing. A stale guard is worse than no guard, because the
 * absence of an error reads as permission.
 *
 * Read off disk rather than imported. The point is to check the text the rule
 * actually runs on.
 */

const ROOT = join(__dirname, '..', '..');

/** The local-only tables. They carry no outbox record by definition. */
const LOCAL_ONLY = new Set(['outbox', 'deadletter', 'conflicts', 'syncMeta', 'reminderState']);

function syncedTablesInSchema(): string[] {
  const src = readFileSync(join(ROOT, 'lib', 'db', 'client.ts'), 'utf8');
  const names = [...src.matchAll(/^\s{2}(\w+)!: (?:EntityTable|Table)</gm)].map((m) => m[1]!);
  expect(names.length, 'found no Dexie tables, the regex has rotted').toBeGreaterThan(10);
  return names.filter((name) => !LOCAL_ONLY.has(name));
}

function guardedTables(): string[] {
  const src = readFileSync(join(ROOT, 'eslint.config.mjs'), 'utf8');
  const block = /const SYNCED_TABLES = \[([\s\S]*?)\]\.join\("\|"\);/.exec(src);
  expect(block, 'SYNCED_TABLES is no longer an array in eslint.config.mjs').not.toBeNull();
  return [...block![1]!.matchAll(/"(\w+)"/g)].map((m) => m[1]!);
}

describe('the Dexie write guard', () => {
  it('covers every synced table and nothing else', () => {
    expect([...guardedTables()].sort()).toEqual([...syncedTablesInSchema()].sort());
  });
});

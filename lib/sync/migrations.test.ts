import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from './testing/postgres';

/**
 * Guards on the SQL that cannot be checked by running it.
 *
 * These are the rules a migration can break silently: the code still works, the
 * tests still pass, and the damage shows up months later as a slow query or a
 * row somebody could delete. A grep is a crude tool, and it is the right one
 * here, because the failure mode is a human writing the wrong idiom rather than
 * a logic error.
 */

const DIR = join(process.cwd(), 'supabase', 'migrations');
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const SQL = Object.fromEntries(FILES.map((f) => [f, readFileSync(join(DIR, f), 'utf8')]));
const ALL = Object.values(SQL).join('\n');

/** Strips comments so a rule cannot be tripped by prose describing it. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

const CODE = code(ALL);

describe('the migration directory', () => {
  it('has every phase 1 migration, numbered in order', () => {
    expect(FILES).toEqual([
      '0001_core_schema.sql',
      '0002_rls.sql',
      '0003_sync_rpc.sql',
      '0004_fix_push_insert.sql',
      '0005_superseded_insert.sql',
      '0006_base_version_zero.sql',
      '0007_settings_sync.sql',
    ]);
  });

  it('applies all of them in the test harness', () => {
    // One missing from that list means every PGlite test runs against a schema
    // the real project does not have, which is the one way this suite can lie.
    expect(MIGRATIONS.map((name) => `${name}.sql`)).toEqual(FILES);
  });
});

describe('row level security', () => {
  it('never calls auth.uid() bare', () => {
    // Bare, it is a STABLE function reference inside the row filter and gets
    // re-evaluated per row. Wrapped in a scalar subquery the planner hoists it
    // into a one-time InitPlan.
    const bare = [...CODE.matchAll(/(.{0,10})auth\.uid\(\)/g)].filter(
      (m) => !/\(\s*select\s+$/i.test(m[1]!),
    );
    expect(bare.map((m) => m[0])).toEqual([]);
  });

  it('enables RLS on every table it creates', () => {
    const created = [...CODE.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]!);
    const enabled = new Set(
      [...CODE.matchAll(/alter table public\.(\w+)\s+enable row level security/g)].map(
        (m) => m[1]!,
      ),
    );
    expect(created.length).toBeGreaterThan(5);
    expect(created.filter((t) => !enabled.has(t))).toEqual([]);
  });

  it('gives tasks no delete policy', () => {
    // Clients soft delete. Physical purge is a service_role cron, so a buggy
    // client can never destroy history.
    const policies = [...CODE.matchAll(/create policy \w+ on public\.(\w+)\s+for (\w+)/g)];
    const taskDeletes = policies.filter((m) => m[1] === 'tasks' && m[2] === 'delete');
    expect(taskDeletes).toHaveLength(0);
  });

  it('scopes every policy to authenticated rather than public', () => {
    const policies = [...CODE.matchAll(/create policy (\w+) on [\s\S]{0,80}?to (\w+)/g)];
    expect(policies.length).toBeGreaterThan(10);
    expect(policies.filter((m) => m[2] !== 'authenticated').map((m) => m[1])).toEqual([]);
  });

  it('runs no EXISTS or join inside a policy', () => {
    // A per-row subquery in a policy runs once per candidate row. task_tags
    // carries a denormalized user_id precisely so it does not need one.
    const bodies = [...CODE.matchAll(/create policy[\s\S]*?;/g)].map((m) => m[0]);
    expect(bodies.filter((b) => /\bexists\b|\bjoin\b/i.test(b))).toEqual([]);
  });
});

describe('schema rules', () => {
  it('collates every sort key as C', () => {
    // The default ICU collation does not order ASCII the way JavaScript < does,
    // so without this a server ORDER BY silently disagrees with the client's
    // sort of the same rows.
    const keys = [...CODE.matchAll(/^\s*(\w*sort_key)\s+(\w+)([^,\n]*)/gm)];
    expect(keys.length).toBeGreaterThan(3);
    expect(keys.filter((m) => !m[3]!.includes('collate "C"')).map((m) => m[1])).toEqual([]);
  });

  it('uses text plus check rather than an enum type', () => {
    // ALTER TYPE ADD VALUE cannot be reverted or reordered, and it breaks a
    // rolling deploy where an old client still writes an old value.
    expect(CODE).not.toMatch(/create type \w+ as enum/i);
  });

  it('gives every synced parent the composite tenancy unique', () => {
    // Children reference (user_id, parent_id), which makes attaching a row to
    // another user's parent structurally impossible.
    for (const table of ['areas', 'projects', 'tags', 'task_series', 'tasks']) {
      const body = CODE.slice(
        CODE.indexOf(`create table public.${table} (`),
      ).split(');')[0]!;
      expect(body, table).toContain('unique (user_id, id)');
    }
  });

  it('keeps exactly one open occurrence per series', () => {
    expect(CODE).toMatch(
      /create unique index tasks_series_occurrence_idx[\s\S]*?series_id is not null and deleted_at is null/,
    );
  });
});

describe('the push contract', () => {
  it('refuses every server-owned column', () => {
    const list = CODE.slice(CODE.indexOf('sync_server_owned_columns'));
    for (const column of [
      'updated_at',
      'row_version',
      'field_versions',
      'created_at',
      'completed_at',
      'depth',
      'search_vector',
      'user_id',
    ]) {
      expect(list, column).toContain(`'${column}'`);
    }
  });

  it('builds its dynamic SQL through format with identifier quoting', () => {
    // Every execute in the push takes its table and column names from format
    // with %I, and its values through USING. String concatenation anywhere in
    // here would be an injection point reachable by any signed-in user.
    const pushBody = SQL['0003_sync_rpc.sql']!.slice(
      SQL['0003_sync_rpc.sql']!.indexOf('function public.sync_push'),
    );
    // Anchored to a statement start, or `grant execute on function` matches.
    const executes = [...pushBody.matchAll(/^\s*execute\s+([\s\S]{0,40})/gm)];
    expect(executes.length).toBeGreaterThan(2);
    expect(executes.filter((m) => !m[1]!.trimStart().startsWith('format('))).toEqual([]);
  });

  it('never inserts without naming its columns', () => {
    // `insert into t select r.*` maps positionally onto every column in the
    // table. That fails outright against a generated column, and where it does
    // not, it writes explicit NULLs over the defaults that updated_at,
    // row_version and field_versions depend on. The latest definition of the
    // push has to name what it writes.
    // Stripped, because this file's own header quotes the broken form it
    // replaced, and a guard that trips on its own explanation is useless.
    const latest = code(SQL['0004_fix_push_insert.sql']!);
    const inserts = [...latest.matchAll(/insert into public\.%I([^\n]*)/g)];
    expect(inserts.length).toBeGreaterThan(0);
    expect(inserts.filter((m) => !m[1]!.includes('(%s)'))).toEqual([]);
    expect(latest).not.toContain('select r.*');
  });

  it('logs every mutation id so a retry cannot apply twice', () => {
    expect(CODE).toContain('create table public.mutation_log');
    expect(CODE).toMatch(/select result into v_cached from public\.mutation_log/);
  });
});

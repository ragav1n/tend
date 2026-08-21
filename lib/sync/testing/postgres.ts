import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/**
 * A real Postgres for tests, with the parts Supabase adds bolted on.
 *
 * PGlite is Postgres compiled to wasm, so the migrations, the plpgsql and every
 * constraint run in-process with no Docker and no cloud project. That matters
 * because the worst bugs in this project so far were all in SQL that every other
 * test happily ignored.
 *
 * Lives here rather than inside one test file because two suites need it:
 * `rpc.test.ts` exercises the RPCs directly, and `convergence.test.ts` drives
 * two whole clients against one database.
 */

/** Applied in order. Add every new migration here. */
export const MIGRATIONS = [
  '0001_core_schema',
  '0002_rls',
  '0003_sync_rpc',
  '0004_fix_push_insert',
  '0005_superseded_insert',
  '0006_base_version_zero',
  '0007_settings_sync',
  '0008_reminders',
  '0009_reconcile_notifications',
  '0010_digest_no_repeats',
  '0011_stale_digests',
  '0012_find_pg_net',
  '0013_richer_emails',
  '0014_web_push',
  '0015_notifiable',
  '0016_focus_sessions',
  '0017_missing_parent',
  '0018_activity_log',
  '0019_saved_views',
  '0020_project_completed_at',
];

export function migrationSql(name: string): string {
  return (
    readFileSync(join(process.cwd(), 'supabase', 'migrations', `${name}.sql`), 'utf8')
      // PGlite ships without contrib extensions. Nothing in the schema calls
      // pgcrypto, since every id is generated on the client, so removing the
      // line leaves everything under test intact.
      .replace(/create extension[^;]+;/gi, '')
  );
}

/** The pieces Supabase provides that a bare Postgres does not. */
const SUPABASE_STUBS = `
  create role authenticated;
  create role anon;
  create role service_role;

  create schema auth;
  create table auth.users (id uuid primary key, email text);

  -- Matches Supabase's own implementation: the uid comes from the request's
  -- JWT claims, which is what makes every RLS policy in 0002 work.
  create or replace function auth.uid() returns uuid language sql stable as $$
    select (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')::uuid
  $$;
`;

/**
 * Supabase's default privileges, which a bare Postgres does not have.
 *
 * Applied before the migrations rather than after, because that is when they
 * apply in a real project: Supabase grants on the *creation* of a table or a
 * function, so a migration that revokes execute afterwards ends up with the
 * revoke in force. Granting after the fact instead would quietly undo every
 * revoke in 0008 and let this suite claim a lockdown that is not there.
 */
const DEFAULT_PRIVILEGES = `
  -- Without usage on auth, every policy fails at auth.uid() before it ever
  -- evaluates a row.
  grant usage on schema auth to authenticated;
  grant select on auth.users to authenticated;
  grant usage on schema public to authenticated, anon;

  alter default privileges in schema public grant all on tables to authenticated;
  alter default privileges in schema public grant all on sequences to authenticated;
  alter default privileges in schema public grant execute on functions to authenticated, anon;
`;

/**
 * Boots a database with the schema applied.
 *
 * The migration list is a parameter so a test can stand the schema up as it
 * looked before a fix and prove the fix was needed.
 */
export async function bootPostgres(migrations: readonly string[] = MIGRATIONS): Promise<PGlite> {
  const pg = new PGlite();
  await pg.exec(SUPABASE_STUBS);
  await pg.exec(DEFAULT_PRIVILEGES);
  for (const name of migrations) await pg.exec(migrationSql(name));
  return pg;
}

/** Signs the given ids up, which fires whatever the schema hangs off auth.users. */
export async function createUsers(pg: PGlite, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    await pg.exec(`insert into auth.users (id, email) values ('${id}', '${id}@example.com');`);
  }
}

/** Runs everything after this as that user, through RLS. */
export async function asUser(pg: PGlite, uid: string): Promise<void> {
  await pg.exec(`set request.jwt.claims = '{"sub":"${uid}"}'; set role authenticated;`);
}

/** Drops back to the owner, for asserting on rows RLS would hide. */
export async function asSuperuser(pg: PGlite): Promise<void> {
  await pg.exec(`reset role; set request.jwt.claims = '';`);
}

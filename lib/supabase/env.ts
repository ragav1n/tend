/**
 * The two public Supabase values, read once and checked.
 *
 * Reading `process.env` at each call site means a typo shows up as a runtime
 * "Invalid API key" from Supabase rather than as a missing variable, and those
 * two failures look nothing alike while debugging.
 *
 * The key is Supabase's publishable key, which used to be called the anon key.
 * It is designed to ship in a browser bundle: every table has RLS and every
 * policy is a bare comparison on user_id. Safe to expose is not the same thing
 * as a licence to skip RLS on a new table.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local and fill in the two ` +
        `NEXT_PUBLIC_SUPABASE_* values from Project Settings > API.`,
    );
  }
  return value;
}

// Inlined at build time by Next, so these have to be literal property accesses
// rather than a loop over names.
export const SUPABASE_URL = required(
  'NEXT_PUBLIC_SUPABASE_URL',
  process.env.NEXT_PUBLIC_SUPABASE_URL,
);

export const SUPABASE_PUBLISHABLE_KEY = required(
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

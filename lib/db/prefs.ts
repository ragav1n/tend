import { getDb, type TendDb } from './client';
import type { Prefs } from './types';

/**
 * Settings are one row.
 *
 * The key is a constant because the server keys the row by user_id and the pull
 * strips user_id, so there is nothing else to key it on locally.
 */
export const PREFS_ID = 'me';

/**
 * What the app shows before the first pull lands, and the basis for a settings
 * write on a device that has never synced.
 *
 * Every value matches the column default in 0001, so a fresh device and a fresh
 * account agree about what the settings are. The timezone is the one worth
 * watching: it stays UTC here and the app adopts the device zone once, because
 * guessing it in two places is how the two end up disagreeing.
 */
export const DEFAULT_PREFS: Prefs = {
  id: PREFS_ID,
  timezone: 'UTC',
  weekStart: 1,
  allDayReminderTime: '09:00',
  digestEnabled: true,
  digestTime: '07:00',
  rowVersion: 0,
  // The server stamps this. The epoch says it never has.
  updatedAt: '1970-01-01T00:00:00.000Z',
};

/** Settings as they stand, falling back to the defaults on a fresh device. */
export async function readPrefs(db: TendDb = getDb()): Promise<Prefs> {
  return (await db.prefs.get(PREFS_ID)) ?? DEFAULT_PREFS;
}

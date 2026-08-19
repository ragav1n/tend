import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { setDb, TendDb } from './client';
import { updatePrefs } from './mutations';
import { DEFAULT_PREFS, fromTimeInput, PREFS_ID, readPrefs, toTimeInput } from './prefs';

/**
 * Settings, which are the one synced row with no id and no tombstone.
 *
 * The write path matters more than it looks: the reminder pipeline reads timezone
 * and digest_time out of this row, so a settings change that fails to queue is a
 * reminder that arrives at the wrong hour with nothing to explain why.
 */

let db: TendDb;
let dbName: string;
let counter = 0;

beforeEach(async () => {
  dbName = `tend_prefs_test_${Date.now()}_${counter++}`;
  db = new TendDb(dbName);
  setDb(db);
  await db.open();
});

afterEach(async () => {
  db.close();
  setDb(null);
  await Dexie.delete(dbName);
});

describe('reading', () => {
  it('answers with the defaults before the first pull', async () => {
    // The values match the column defaults in 0001, so a device that has never
    // synced shows what a new account is actually set to.
    expect(await readPrefs(db)).toEqual(DEFAULT_PREFS);
  });
});

describe('writing', () => {
  it('applies the change and queues exactly one mutation', async () => {
    await updatePrefs({ timezone: 'Asia/Kolkata', digestTime: '06:30:00' }, db);

    const prefs = await readPrefs(db);
    expect(prefs.timezone).toBe('Asia/Kolkata');
    expect(prefs.digestTime).toBe('06:30:00');

    const queued = await db.outbox.toArray();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      table: 'prefs',
      entityId: PREFS_ID,
      // Never an insert. The signup trigger owns the row, and the server refuses
      // one for this table.
      op: 'update',
      baseVersion: 0,
      patch: { timezone: 'Asia/Kolkata', digestTime: '06:30:00' },
    });
  });

  it('sends only what changed, so two devices can edit different settings', async () => {
    await db.prefs.put({ ...DEFAULT_PREFS, rowVersion: 7 });
    await updatePrefs({ nudgeEnabled: false }, db);

    const [record] = await db.outbox.toArray();
    expect(Object.keys(record!.patch)).toEqual(['nudgeEnabled']);
    // The version the row was read at is what drives the server's field merge.
    expect(record!.baseVersion).toBe(7);
  });

  it('leaves the rest of the row alone', async () => {
    await updatePrefs({ emailEnabled: false }, db);
    const prefs = await readPrefs(db);

    expect(prefs.emailEnabled).toBe(false);
    expect(prefs.digestEnabled).toBe(DEFAULT_PREFS.digestEnabled);
    expect(prefs.weeklyReviewDay).toBe(DEFAULT_PREFS.weeklyReviewDay);
  });
});

describe('times across the wire', () => {
  it('converts between the input and the column in both directions', () => {
    // Postgres answers with HH:MM:SS and `<input type="time">` wants HH:MM, so a
    // value that has been through one sync stops matching the input it came from.
    expect(toTimeInput('06:30:00')).toBe('06:30');
    expect(toTimeInput('06:30')).toBe('06:30');
    expect(fromTimeInput('06:30')).toBe('06:30:00');
    expect(fromTimeInput('06:30:00')).toBe('06:30:00');
  });
});

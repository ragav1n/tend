import type { TendDb } from '@/lib/db/client';
import { applyPage, readCursor, writeCursor } from './apply';
import { DEFAULT_PULL_LIMIT, type PullResponse } from './protocol';
import { postJson } from './transport';

/**
 * Fetches one page of server changes and applies it.
 *
 * The cursor is read from and written to the local store rather than held in
 * memory, so a tab that reloads mid-hydrate resumes where it stopped instead of
 * starting the whole download again.
 *
 * The write happens after the apply, never before. Advancing first and then
 * failing to apply loses those rows permanently: the next pull asks for changes
 * above a cursor whose rows never landed.
 */

export interface PullOutcome {
  cursor: number;
  hasMore: boolean;
  applied: number;
  skipped: number;
}

export async function pullOnce(
  db: TendDb,
  limit = DEFAULT_PULL_LIMIT,
): Promise<PullOutcome> {
  const cursor = await readCursor(db);

  const response = await postJson<PullResponse>('/api/sync/pull', { cursor, limit });
  const { applied, skipped } = await applyPage(db, response.rows);
  await writeCursor(db, response.cursor);

  return { cursor: response.cursor, hasMore: response.hasMore, applied, skipped };
}

import { getDb, type TendDb } from '@/lib/db/client';
import { projectOptions, tagOptions, viewCandidates } from '@/lib/db/queries';
import { toRule } from '@/lib/db/series';
import { exportable, icsFilename, toIcs, type IcsTask } from './serialize';

/**
 * Everything dated, as one calendar file.
 *
 * Reads through the same bounded query a saved view uses rather than a fresh
 * `toArray()`, because "export" is not a reason to deserialize the whole store
 * on the frame somebody clicked a button.
 */
export async function buildIcs(db: TendDb = getDb()): Promise<{ body: string; filename: string }> {
  const [tasks, projects, tags] = await Promise.all([
    viewCandidates(5000, db),
    projectOptions(db),
    tagOptions(db),
  ]);

  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const tagName = new Map(tags.map((t) => [t.id, t.name]));

  const rows = exportable(tasks);
  const seriesIds = [...new Set(rows.map((t) => t.seriesId).filter(Boolean))];
  const series = new Map(
    (await db.taskSeries.bulkGet(seriesIds))
      .filter((s) => s !== undefined && s._del === 0)
      .map((s) => [s!.id, s!]),
  );

  const entries: IcsTask[] = rows.map((task) => {
    const found = task.seriesId ? series.get(task.seriesId) : undefined;
    return {
      task,
      ...(found ? { rule: toRule(found) } : {}),
      ...(task.projectId ? { project: projectName.get(task.projectId) } : {}),
      tags: task._tagIds.map((id) => tagName.get(id)).filter((n): n is string => Boolean(n)),
    };
  });

  return { body: toIcs(entries), filename: icsFilename() };
}

/**
 * Hands the file to the browser.
 *
 * An object URL and a synthetic click, which is the only route that works
 * offline. A route handler would need the network, and the whole point of this
 * app is that it does not.
 */
export function saveFile(body: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([body], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Revoked on the next frame rather than immediately: Safari has not finished
  // reading the blob when click() returns.
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}

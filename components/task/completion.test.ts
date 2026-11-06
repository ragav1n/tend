import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Completing a task goes through `completeTask`, never a status patch.
 *
 * A patch marks the row done and stops there, so a repeating task completed
 * that way never made its next occurrence and the repeat ended without a word.
 * The detail panel's checkbox did exactly that while every list did it right.
 */

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('completion', () => {
  it('never completes a task by patching its status', () => {
    const offenders = ['components', 'app', 'hooks']
      .flatMap((dir) => sources(join(process.cwd(), dir)))
      .filter((file) => /status:\s*(?:[\w.]+\s*\?\s*)?'done'/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

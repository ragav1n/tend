import { parseQuickAdd } from '@/lib/parse';
import type { PlainDate } from '@/lib/db/types';
import { resolveSyllabusDate, type DateWindow } from './dates';

/**
 * A pasted syllabus, read into rows you can check before anything is written.
 *
 * Copying out of a PDF gives one of two shapes and this handles both, because
 * which one you get is a property of the PDF rather than a choice:
 *
 *   - **A table.** Tabs, or commas, in a consistent count per line. Copying a
 *     schedule table out of a PDF viewer produces this, usually with a week
 *     column nobody wants and the date and title in an order that varies.
 *   - **A list.** One item per line, the date somewhere in the sentence. This is
 *     what a bulleted assignment list gives, and `parseQuickAdd` already reads
 *     it: the same code the quick-add field uses, so the two cannot disagree
 *     about what "Oct 2" means.
 *
 * Columns are guessed and then shown, never guessed and applied. A date column
 * read as a points column would file a hundred assignments on the wrong day, and
 * the difference between guessing well and guessing invisibly is the whole
 * reason the grid exists.
 */

export interface PastedRow {
  /** Every cell, for a table. One element for a list. */
  cells: string[];
}

export type ColumnRole = 'title' | 'due' | 'points' | 'ignore';

export interface Mapping {
  /** Role per column index. Always as long as the widest row. */
  roles: ColumnRole[];
}

export interface SyllabusRow {
  title: string;
  due: PlainDate | null;
  points: number | null;
  /** What the date cell said, kept so the grid can show a value it could not
   *  read rather than an empty box. */
  dueText: string;
}

/** A table needs this share of its lines to agree on a delimiter. */
const AGREEMENT = 0.6;

/** Lines that are almost certainly a heading rather than an assignment. */
const HEADING = /^(week|date|due|assignment|topic|reading|points|title)\b/i;

/**
 * Lines, with the blank ones dropped and nothing else touched.
 *
 * Deliberately not trimmed. A table row whose first cell is empty starts with
 * the delimiter, and trimming the line eats it: `\tOct 2\t100` became a
 * two-column row and every column after it shifted left, so the points landed
 * in the title. Cells are trimmed individually once the row is split, which is
 * the only place it is safe.
 */
export function splitLines(text: string): string[] {
  return text.split(/\r\n|\n|\r/).filter((line) => line.trim().length > 0);
}

/**
 * The delimiter a paste is using, or null for a list.
 *
 * A tab wins outright: text containing tabs came out of a table, and a title
 * with a comma in it is common enough that commas need more evidence. For
 * commas the column *count* has to agree too, or a list of sentences with commas
 * in them reads as a ragged table.
 */
export function detectDelimiter(lines: readonly string[]): '\t' | ',' | null {
  if (lines.length === 0) return null;

  const tabbed = lines.filter((line) => line.includes('\t')).length;
  if (tabbed / lines.length >= AGREEMENT) return '\t';

  const commaCounts = lines.map((line) => line.split(',').length);
  const common = mode(commaCounts.filter((count) => count > 1));
  if (common === null) return null;

  const agreeing = commaCounts.filter((count) => count === common).length;
  return agreeing / lines.length >= AGREEMENT ? ',' : null;
}

function mode(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
}

/** The pasted text as rows of cells, headings dropped. */
export function toRows(text: string): { rows: PastedRow[]; delimiter: '\t' | ',' | null } {
  const lines = splitLines(text).filter((line) => !HEADING.test(line.trim()));
  const delimiter = detectDelimiter(lines);

  // A list row is one cell, so the line is trimmed whole. A table row is split
  // first and its cells trimmed after, or a leading empty cell disappears.
  if (delimiter === null) {
    return { rows: lines.map((line) => ({ cells: [line.trim()] })), delimiter };
  }

  return {
    rows: lines.map((line) => ({ cells: line.split(delimiter).map((cell) => cell.trim()) })),
    delimiter,
  };
}

/**
 * A guess at what each column holds.
 *
 * Scored per column rather than per row: one cell that happens to parse as a
 * date proves nothing, and the column that parses most often is the date column
 * even when a few of its cells say "TBD".
 *
 * Points before title, because a column of bare numbers is unambiguous and a
 * column of prose is only the title by elimination. The widest text column wins
 * the title, since a syllabus puts the week number and the topic in the same
 * table and the topic is the longer of the two.
 */
export function detectColumns(rows: readonly PastedRow[], window: DateWindow): Mapping {
  const width = rows.reduce((widest, row) => Math.max(widest, row.cells.length), 0);
  const roles: ColumnRole[] = Array.from({ length: width }, () => 'ignore');

  if (width === 1) {
    return { roles: ['title'] };
  }

  const column = (index: number) => rows.map((row) => row.cells[index] ?? '');

  const dateScore = (index: number) =>
    column(index).filter((cell) => resolveSyllabusDate(cell, window) !== null).length;

  const numeric = (cell: string) => /^\d{1,4}(\.\d+)?$/.test(cell);
  const numberScore = (index: number) => column(index).filter(numeric).length;

  /**
   * A column that just counts the rows.
   *
   * Every schedule table has one and none of them mean anything: "Week" runs
   * 1, 2, 3 and is bare numbers, so it beat the real points column to the
   * numeric role and filed every assignment as worth one point. Detected as a
   * run rather than by its heading, because the heading row is already gone by
   * the time anything is scored.
   */
  const isCounter = (index: number) => {
    const values = column(index).map(Number);
    if (values.length < 2 || values.some((value) => !Number.isInteger(value))) return false;
    return values.every((value, at) => value === values[0]! + at);
  };

  /** Points are bigger than week numbers, which is the other half of telling
   *  the two apart when a table is short enough that a run proves nothing. */
  const meanOf = (index: number) => {
    const values = column(index).filter(numeric).map(Number);
    return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
  };

  const textWidth = (index: number) =>
    column(index).reduce((total, cell) => total + cell.length, 0) / Math.max(1, rows.length);

  const indexes = Array.from({ length: width }, (_, index) => index);

  const dueAt = best(indexes, dateScore, rows.length * 0.5);
  if (dueAt !== null) roles[dueAt] = 'due';

  const numericColumns = indexes.filter(
    (index) =>
      roles[index] === 'ignore' &&
      !isCounter(index) &&
      numberScore(index) >= rows.length * 0.5,
  );
  // The biggest numbers win. A week column that survived the run check is still
  // 1 through 15, and points are not.
  const pointsAt = best(numericColumns, meanOf, Number.MIN_VALUE);
  if (pointsAt !== null) roles[pointsAt] = 'points';

  const titleAt = best(
    indexes.filter((index) => roles[index] === 'ignore'),
    textWidth,
    1,
  );
  if (titleAt !== null) roles[titleAt] = 'title';

  return { roles };
}

/** The highest-scoring index, if anything clears the bar. */
function best(
  indexes: readonly number[],
  score: (index: number) => number,
  floor: number,
): number | null {
  let winner: number | null = null;
  let high = 0;
  for (const index of indexes) {
    const value = score(index);
    if (value > high) {
      high = value;
      winner = index;
    }
  }
  return high >= floor ? winner : null;
}

/**
 * The rows, read through a mapping.
 *
 * A list row has one cell and goes through `parseQuickAdd`, so a date written
 * inside the sentence is found and taken out of the title. A table row takes its
 * title verbatim: the date is already its own column, and running the title
 * through the parser there would eat a word out of "Quiz 4 on Chapter 2".
 */
export function applyMapping(
  rows: readonly PastedRow[],
  mapping: Mapping,
  window: DateWindow,
): SyllabusRow[] {
  const out: SyllabusRow[] = [];

  for (const row of rows) {
    const cellFor = (role: ColumnRole) => {
      const index = mapping.roles.indexOf(role);
      return index === -1 ? '' : (row.cells[index] ?? '');
    };

    if (mapping.roles.length === 1) {
      const line = row.cells[0] ?? '';
      const now = new Date(`${window.today}T12:00:00Z`);
      const parsed = parseQuickAdd(line, now);
      const title = tidy(parsed.title);
      if (title === '') continue;

      // The words the date was written in, which is what needs re-resolving:
      // the parser hands back a year it chose, and choosing that year again is
      // the whole job of `resolveSyllabusDate`.
      const spoken = parsed.tokens.find((token) => token.kind === 'date')?.text.trim() ?? '';

      out.push({
        title,
        due: spoken === '' ? null : resolveSyllabusDate(spoken, window),
        points: null,
        dueText: spoken,
      });
      continue;
    }

    const title = cellFor('title').trim();
    if (title === '') continue;

    const dueText = cellFor('due').trim();
    const pointsText = cellFor('points').trim();
    const points = /^\d{1,4}(\.\d+)?$/.test(pointsText) ? Number(pointsText) : null;

    out.push({ title, due: resolveSyllabusDate(dueText, window), points, dueText });
  }

  return out;
}

/**
 * A title with the words that only led to the date taken off.
 *
 * `parseQuickAdd` removes the date and leaves what surrounded it, so
 * "Project 1 due Sep 14" comes back as "Project 1 due". Fine in a quick-add
 * field, where you watch the chip appear and can fix the line. Not fine over a
 * hundred pasted rows, where the stray word ends up in every title.
 */
function tidy(title: string): string {
  return title
    .trim()
    .replace(/[\s,;:–—-]+(due|by|on|at|before)\s*$/i, '')
    .replace(/[\s,;:–—-]+$/, '')
    .trim();
}

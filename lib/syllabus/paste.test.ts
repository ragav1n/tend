import { describe, expect, it } from 'vitest';
import { applyMapping, detectColumns, detectDelimiter, splitLines, toRows } from './paste';

const FALL = { today: '2026-09-21', termStart: '2026-08-17', termEnd: '2026-12-11' };

/** A schedule table copied out of a PDF, week column and all. */
const TABLE = [
  'Week\tDate\tAssignment\tPoints',
  '1\tSep 14\tProject 1: Buffer Overflow\t100',
  '2\tOct 2\tProject 2: Web Security\t100',
  '3\tOct 20\tMidterm Exam\t150',
  '4\tDec 8\tFinal Project\t200',
].join('\n');

/** A bulleted assignment list, dates inside the sentence. */
const LIST = [
  'Project 1: Buffer Overflow due Sep 14',
  'Project 2: Web Security due Oct 2',
  'Read chapter 4 by Oct 9',
].join('\n');

describe('splitting a paste', () => {
  it('drops blank lines', () => {
    expect(splitLines('a\n\nb\n')).toEqual(['a', 'b']);
  });

  it('leaves a leading empty cell alone', () => {
    // Trimming the line ate it, so `\tOct 2\t100` became two columns and
    // everything after shifted left: the points landed in the title.
    expect(splitLines('\tOct 2\t100')).toEqual(['\tOct 2\t100']);
  });

  it('takes any line ending', () => {
    expect(splitLines('a\r\nb\rc')).toEqual(['a', 'b', 'c']);
  });
});

describe('spotting a delimiter', () => {
  it('takes tabs outright', () => {
    expect(detectDelimiter(splitLines(TABLE))).toBe('\t');
  });

  it('takes commas when the column count agrees', () => {
    const csv = ['1,Sep 14,Project 1,100', '2,Oct 2,Project 2,100'];
    expect(detectDelimiter(csv)).toBe(',');
  });

  it('refuses commas that are just punctuation', () => {
    // A title with a comma in it is common. Reading these as a ragged table
    // would split "See the rubric, and note the late policy" down the middle.
    const prose = [
      'Project 1, which covers stack smashing, due Sep 14',
      'Read chapter 4 by Oct 9',
    ];
    expect(detectDelimiter(prose)).toBeNull();
  });

  it('answers nothing for a list', () => {
    expect(detectDelimiter(splitLines(LIST))).toBeNull();
  });

  it('answers nothing for an empty paste', () => {
    expect(detectDelimiter([])).toBeNull();
  });
});

describe('guessing the columns', () => {
  it('finds the date, the points and the title in a schedule table', () => {
    const { rows } = toRows(TABLE);
    expect(detectColumns(rows, FALL).roles).toEqual(['ignore', 'due', 'title', 'points']);
  });

  it('drops the heading row before guessing', () => {
    // "Week Date Assignment Points" parses as nothing and would drag every
    // column's score down.
    const { rows } = toRows(TABLE);
    expect(rows).toHaveLength(4);
  });

  it('copes with the columns in another order', () => {
    const swapped = [
      'Project 1\t100\tSep 14',
      'Project 2\t100\tOct 2',
      'Midterm\t150\tOct 20',
    ].join('\n');
    const { rows } = toRows(swapped);
    expect(detectColumns(rows, FALL).roles).toEqual(['title', 'points', 'due']);
  });

  it('treats a list as one title column', () => {
    const { rows } = toRows(LIST);
    expect(detectColumns(rows, FALL).roles).toEqual(['title']);
  });

  it('leaves a column it cannot place alone', () => {
    const noDates = ['Project 1\tTBD', 'Project 2\tTBD'].join('\n');
    const { rows } = toRows(noDates);
    const roles = detectColumns(rows, FALL).roles;
    expect(roles).toContain('title');
    expect(roles).not.toContain('due');
  });
});

describe('reading the rows', () => {
  it('reads a schedule table into assignments', () => {
    const { rows } = toRows(TABLE);
    const mapping = detectColumns(rows, FALL);
    expect(applyMapping(rows, mapping, FALL)).toEqual([
      { title: 'Project 1: Buffer Overflow', due: '2026-09-14', points: 100, dueText: 'Sep 14' },
      { title: 'Project 2: Web Security', due: '2026-10-02', points: 100, dueText: 'Oct 2' },
      { title: 'Midterm Exam', due: '2026-10-20', points: 150, dueText: 'Oct 20' },
      { title: 'Final Project', due: '2026-12-08', points: 200, dueText: 'Dec 8' },
    ]);
  });

  it('keeps a past date in the term rather than a year out', () => {
    // The whole reason `resolveSyllabusDate` exists. Sep 14 was a week ago.
    const { rows } = toRows(TABLE);
    const out = applyMapping(rows, detectColumns(rows, FALL), FALL);
    expect(out[0]!.due).toBe('2026-09-14');
  });

  it('takes a table title verbatim', () => {
    // The date is already its own column, so running the title through the
    // parser would eat a word out of "Quiz 4 on Chapter 2".
    const quiz = ['Quiz 4 on Chapter 2\tOct 9\t20'].join('\n');
    const { rows } = toRows(quiz);
    const out = applyMapping(rows, detectColumns(rows, FALL), FALL);
    expect(out[0]!.title).toBe('Quiz 4 on Chapter 2');
  });

  it('takes the date out of a list line title', () => {
    const { rows } = toRows(LIST);
    const out = applyMapping(rows, detectColumns(rows, FALL), FALL);
    expect(out).toEqual([
      { title: 'Project 1: Buffer Overflow', due: '2026-09-14', points: null, dueText: 'Sep 14' },
      { title: 'Project 2: Web Security', due: '2026-10-02', points: null, dueText: 'Oct 2' },
      { title: 'Read chapter 4', due: '2026-10-09', points: null, dueText: 'Oct 9' },
    ]);
  });

  it('keeps a row whose date it could not read, and says what it saw', () => {
    // Dropping it would be silent. The grid shows "TBD" and an empty date, and
    // you fix it there.
    const tbd = ['Project 1\tTBD\t100', 'Project 2\tOct 2\t100'].join('\n');
    const { rows } = toRows(tbd);
    const out = applyMapping(rows, detectColumns(rows, FALL), FALL);
    expect(out[0]).toMatchObject({ title: 'Project 1', due: null, dueText: 'TBD' });
    expect(out[1]!.due).toBe('2026-10-02');
  });

  it('drops a row with no title at all', () => {
    const ragged = ['\tOct 2\t100', 'Project 2\tOct 9\t100'].join('\n');
    const { rows } = toRows(ragged);
    const out = applyMapping(rows, detectColumns(rows, FALL), FALL);
    expect(out.map((row) => row.title)).toEqual(['Project 2']);
  });

  it('honours a mapping you corrected by hand', () => {
    // The guess is shown, not applied. Swapping two roles has to change the
    // answer, or the grid is decoration.
    const { rows } = toRows(TABLE);
    const corrected = { roles: ['title', 'due', 'ignore', 'points'] as const };
    const out = applyMapping(rows, { roles: [...corrected.roles] }, FALL);
    expect(out[0]!.title).toBe('1');
  });

  it('answers nothing for an empty paste', () => {
    const { rows } = toRows('');
    expect(applyMapping(rows, detectColumns(rows, FALL), FALL)).toEqual([]);
  });
});

describe('a whole syllabus rather than its schedule', () => {
  /**
   * The real thing, cut down. Pasting the document instead of the table is the
   * ordinary mistake, and the whole document used to arrive as rows: 226 of
   * them from one real syllabus, two dated, offering to file "Georgia
   * Institute of Technology" and "1" as coursework.
   */
  const DOCUMENT = [
    'Georgia Institute of Technology',
    'Syllabus: Incident Response',
    '1',
    'CS 6261/CS 4803',
    'Dr. Vijay Madisetti vkm@gatech.edu',
    'This course provides students with the background information and skillsets necessary to operate',
    'Office hours will be held once per week.',
    'Case Study 2: Desert Sands Case Study Report',
    'Lab 1 Due: Splunk for Logs Analysis (Part 1)',
    'Midterm',
  ].join('\n');

  it('keeps what you hand in and drops the prose', () => {
    const { rows } = toRows(DOCUMENT);
    const out = applyMapping(rows, detectColumns(rows, FALL), FALL);
    const titles = out.map((row) => row.title);

    expect(titles).toContain('Case Study 2: Desert Sands Case Study Report');
    expect(titles).toContain('Lab 1 Due: Splunk for Logs Analysis (Part 1)');
    expect(titles).toContain('Midterm');

    expect(titles).not.toContain('Georgia Institute of Technology');
    expect(titles).not.toContain('1');
    expect(titles).not.toContain('Dr. Vijay Madisetti vkm@gatech.edu');
    // Long enough to be a sentence about the course rather than a deadline.
    expect(titles.some((t) => t.startsWith('This course provides'))).toBe(false);
  });

  it('keeps a dated line whatever it says', () => {
    // The date is the strongest signal there is, so it overrides the wording.
    const { rows } = toRows('Guest speaker on Oct 14');
    const out = applyMapping(rows, detectColumns(rows, FALL), FALL);
    expect(out).toHaveLength(1);
    expect(out[0]!.due).toBe('2026-10-14');
  });
});

import { formatClock, formatDueLabel } from '@/lib/format/date';
import { NO_PROJECT, type ActivityAction, type ActivityEntry, type PlainDate } from '@/lib/db/types';

/**
 * The activity log, read as English.
 *
 * The log stores a patch, not a sentence: `before` and `after` hold the fields
 * that moved in the same camelCase shape `mutations.ts` takes, because undo
 * feeds them straight back. That is the right thing to store and the wrong
 * thing to show, so the translation lives here where a test can hold it rather
 * than inside the panel that renders it.
 *
 * `summary` is not used. It was written for a toast, so it names the task,
 * which the detail panel is already showing at the top of the same screen.
 *
 * Only an update lists fields. The verb on every other action already says
 * everything the entry knows: "Completed" with "Status active to done" under it
 * is the same fact twice.
 */

export interface ActivityLine {
  /** "Added", "Completed", "Changed". */
  verb: string;
  /** One per field that moved, empty for every action but update. */
  changes: FieldChange[];
  /** The entry was taken back, so it no longer stands. */
  undone: boolean;
}

export interface FieldChange {
  label: string;
  /** Absent when the value is too long to sit on one line, such as notes. */
  from?: string;
  to?: string;
}

export interface DescribeContext {
  /** Today in the device zone, passed in so this stays pure. */
  today: PlainDate;
  /** A project's name, or null when it is not on this device yet. */
  projectName: (id: string) => string | null;
  locale?: string;
}

const VERBS: Record<ActivityAction, string> = {
  create: 'Added',
  update: 'Changed',
  complete: 'Completed',
  reopen: 'Reopened',
  delete: 'Deleted',
  restore: 'Restored',
};

/**
 * Field labels, matching what the detail panel calls each one. A field missing
 * from here is one no gesture logs today, and it renders under its own name
 * rather than being dropped: a history that silently omits a change is worse
 * than one that names a field oddly.
 */
const LABELS: Record<string, string> = {
  title: 'Title',
  notes: 'Notes',
  status: 'Status',
  priority: 'Priority',
  dueDate: 'Due',
  dueTime: 'Time',
  startDate: 'Start',
  plannedFor: 'Planned',
  estimateMinutes: 'Estimate',
  projectId: 'Project',
  parentTaskId: 'Parent',
  cancelReason: 'Cancelled as',
  seriesId: 'Repeat',
  occurrenceDate: 'Occurrence',
};

/** Written by the mutation layer for undo, never by a person. */
const INTERNAL = new Set(['sortKey', 'plannedSortKey', 'occurrenceSeq', 'spawnedId', 'advancedSeriesId']);

const PRIORITIES = ['None', 'Low', 'Medium', 'High'];

const STATUSES: Record<string, string> = {
  inbox: 'Inbox',
  active: 'Active',
  waiting: 'Waiting',
  done: 'Done',
  cancelled: 'Cancelled',
};

/** Longer than this and the value goes in a tooltip rather than on the line. */
const MAX_VALUE = 40;

export function describeActivity(entry: ActivityEntry, ctx: DescribeContext): ActivityLine {
  return {
    verb: VERBS[entry.action] ?? 'Changed',
    changes: entry.action === 'update' ? fieldChanges(entry, ctx) : [],
    undone: entry.undoneAt !== null,
  };
}

/**
 * The fields an update moved.
 *
 * Keyed off `before`, which `previousValues` builds from the patch, so it holds
 * exactly the fields the gesture touched. Reading `after` instead would pick up
 * the bookkeeping a completion adds.
 */
function fieldChanges(entry: ActivityEntry, ctx: DescribeContext): FieldChange[] {
  const changes: FieldChange[] = [];

  for (const key of Object.keys(entry.before)) {
    if (INTERNAL.has(key)) continue;
    const from = entry.before[key];
    const to = entry.after[key];
    // A patch that set a field to what it already held. Rare, since the panel
    // compares before writing, but a bulk edit does not.
    if (Object.is(from, to)) continue;

    const change: FieldChange = { label: LABELS[key] ?? humanize(key) };
    // Notes are markdown and run to paragraphs. Naming the field is the whole
    // useful part; the text itself is on screen above.
    if (key !== 'notes') {
      change.from = clip(render(key, from, ctx));
      change.to = clip(render(key, to, ctx));
    }
    changes.push(change);
  }

  return changes;
}

function render(key: string, value: unknown, ctx: DescribeContext): string {
  if (value === null || value === undefined || value === '') {
    // Inbox is a real place rather than an absence, and it is what an empty
    // projectId means everywhere else in the app.
    return key === 'projectId' ? 'Inbox' : 'None';
  }

  switch (key) {
    case 'priority':
      return PRIORITIES[Number(value)] ?? String(value);
    case 'status':
      return STATUSES[String(value)] ?? String(value);
    case 'dueDate':
    case 'startDate':
    case 'plannedFor':
    case 'occurrenceDate':
      return formatDueLabel(String(value), ctx.today, ctx.locale);
    case 'dueTime':
      return formatClock(String(value));
    case 'estimateMinutes':
      return `${String(value)} min`;
    case 'projectId': {
      const id = String(value);
      if (id === NO_PROJECT) return 'Inbox';
      // A project this device has not pulled yet. Naming it "a project" beats
      // showing a uuid, and beats "None", which would read as the opposite.
      return ctx.projectName(id) ?? 'Another project';
    }
    case 'seriesId':
      return 'Repeating';
    default:
      return String(value);
  }
}

function clip(value: string): string {
  return value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE - 1)}…` : value;
}

/** `estimateMinutes` to "Estimate minutes". Only reached by a field no gesture
 *  logs today, so it exists to stay readable rather than to read well. */
function humanize(key: string): string {
  const spaced = key.replace(/([A-Z])/g, ' $1').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

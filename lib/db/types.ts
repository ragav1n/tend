/**
 * Local row shapes.
 *
 * These mirror the Postgres tables, with two deliberate differences:
 *
 * 1. **Sentinels instead of null on anything indexed.** IndexedDB cannot index
 *    `null`, `undefined` or booleans, so a row that needs to appear in a range
 *    scan carries a derived field with a real value. `projectId` uses `''` for
 *    Inbox rather than null for the same reason.
 * 2. **Derived fields prefixed `_`.** Computed by `derive.ts` and never sent to
 *    the server. They exist so the hot queries are index-bound.
 *
 * Server-owned columns (`updatedAt`, `rowVersion`, `completedAt`, `cancelledAt`,
 * `depth`) appear here because the client reads them, but `mutations.ts` never
 * puts them in an outbox patch. Triggers own them.
 */

/** Wall-clock calendar date, `YYYY-MM-DD`. Never an instant. */
export type PlainDate = string;
/** Wall-clock time of day, `HH:mm`. Never an instant. */
export type PlainTime = string;
/** ISO 8601 instant, `2026-08-18T09:15:00.000Z`. */
export type Instant = string;

/** Sorts after every real date, so "no due date" stays inside a range scan
 *  instead of needing a separate query. */
export const NO_DUE_DAY = '9999-12-31';
/** Inbox, meaning "no project". `''` sorts before every uuid. */
export const NO_PROJECT = '';
/** Top level, meaning "not a subtask". */
export const NO_PARENT = '';
/** Not coursework. `''` for the same reason `projectId` uses it. */
export const NO_COURSE = '';
/** Coursework that is not weighted, or not weighted yet. */
export const NO_COMPONENT = '';

export type TaskStatus = 'inbox' | 'active' | 'waiting' | 'done' | 'cancelled';
export type CancelReason = 'skipped' | 'obsolete' | 'duplicate' | 'other';

/** 0 none, 1 low, 2 medium, 3 high. Numeric so it can be indexed and sorted. */
export type Priority = 0 | 1 | 2 | 3;

export interface SyncedRow {
  id: string;
  userId: string;
  createdAt: Instant;
  /** Server-stamped. Display and debugging only, never a sync cursor. */
  updatedAt: Instant;
  /** Tombstone. A soft-deleted row keeps its content for the retention window. */
  deletedAt: Instant | null;
  /** Server-assigned monotonic counter. This is the sync cursor. 0 means the row
   *  has only ever existed locally. */
  rowVersion: number;
}

export interface DerivedTaskFields {
  /** 1 when `deletedAt` is set. Leads every compound index. */
  _del: 0 | 1;
  /** 1 when the task is done or cancelled, meaning it leaves the open lists. */
  _done: 0 | 1;
  /** `dueDate` or NO_DUE_DAY. */
  _dueDay: PlainDate;
  /** `plannedFor` or NO_DUE_DAY. */
  _plannedDay: PlainDate;
  /** Denormalized from taskTags. multiEntry indexed, so tag filtering is one scan. */
  _tagIds: string[];
  /** Lowercased, de-accented tokens from title and notes. multiEntry indexed,
   *  which gives prefix search with no search dependency. */
  _words: string[];
}

export interface Task extends SyncedRow, DerivedTaskFields {
  /** NO_PROJECT for Inbox. A subtask leaves this empty: its project is its
   *  parent's, and storing it twice invites the two to disagree. */
  projectId: string;
  /** NO_PARENT for a top-level task. */
  parentTaskId: string;
  /** Empty unless the task is an occurrence of a recurring series. */
  seriesId: string;
  /** 0 top level, 1 subtask. Capped at 1 so nothing needs a recursive CTE. */
  depth: 0 | 1;

  title: string;
  /** Markdown source. Rendered on the client. */
  notes: string;
  status: TaskStatus;
  priority: Priority;

  /** A commitment. Wall clock: due "tomorrow 9am" is 9am wherever you stand. */
  dueDate: PlainDate | null;
  /** Null means all-day. */
  dueTime: PlainTime | null;
  /** Hides the task until this date. */
  startDate: PlainDate | null;
  /** "I intend to do this today", which is what makes a Today list a plan
   *  rather than a pile of deadlines. Distinct from dueDate on purpose. */
  plannedFor: PlainDate | null;
  estimateMinutes: number | null;

  /** Server-derived from `status`. Never sent by the client. */
  completedAt: Instant | null;
  /**
   * When the task was cancelled. Server-derived from `status` the same way, and
   * kept apart from `completedAt` on purpose: the review, the streak and the
   * digest all read that column, and abandoning something is not finishing it.
   *
   * Null on everything else, which is what puts only cancelled rows in the
   * `[_del+cancelledAt]` index: IndexedDB does not index null, so the index is
   * the cancelled list rather than a filter over every task.
   */
  cancelledAt: Instant | null;
  cancelReason: CancelReason | null;
  archivedAt: Instant | null;

  /** Fractional index. A string, not a number, so two offline devices can
   *  reorder different parts of a list without touching each other's rows. */
  sortKey: string;
  /** Separate ordering for the Today list, which the user arranges by hand. */
  plannedSortKey: string;

  occurrenceDate: PlainDate | null;
  occurrenceSeq: number | null;

  /** NO_COURSE unless the task is coursework. Independent of `projectId`: a
   *  task can belong to CS 6035 and to a project called Term paper, and being
   *  made to choose is not a choice anybody wants. A subtask leaves this empty
   *  and takes its parent's, the way `projectId` does. */
  courseId: string;
  /** Which weighted bucket of the course this counts toward. NO_COMPONENT until
   *  it is filed under one. */
  componentId: string;
  pointsPossible: number | null;
  /** Null until it is graded, which is what tells an ungraded final apart from
   *  one that scored zero. The projection turns on that difference. */
  pointsEarned: number | null;
  gradedAt: PlainDate | null;

  /** The feed item this task came from. Null for anything typed by hand.
   *  Server-owned: a client that could set it could claim a row was imported. */
  feedUid: string | null;
  /**
   * What the feed last wrote into `title`, `dueDate` and `dueTime`.
   *
   * The feed owns a field only while the field still holds this. Edit a due date
   * yourself and the next import leaves it alone, because it can see its own
   * writing is gone. A per-field version would say that something changed
   * without saying who changed it.
   */
  feedSnapshot: Record<string, unknown>;
}

/**
 * One subscribed calendar.
 *
 * The URL is credential-shaped: anybody holding it can read the whole Canvas
 * calendar it points at. It is never logged and never put in an error message.
 */
export interface Feed extends SyncedRow {
  url: string;
  label: string;
  enabled: boolean;
  lastFetchedAt: Instant | null;
  lastError: string | null;
  lastCount: number;
  /** Items the feed carried that matched no course. Said out loud rather than
   *  swallowed, since they land in the Inbox. */
  lastUnmatched: number;
  _del: 0 | 1;
}

/**
 * A lecture, an exam slot, an office hour.
 *
 * Not a task. Ticking one off means nothing, so it renders behind the day rather
 * than in a list. Server-owned: the client has a SELECT policy and nothing else,
 * and `sync_push` refuses the table by not listing it as writable.
 */
export interface CourseEvent extends SyncedRow {
  courseId: string;
  feedUid: string;
  title: string;
  startsOn: PlainDate;
  startsAt: PlainTime | null;
  endsAt: PlainTime | null;
  location: string;
  kind: 'event' | 'exam' | 'class';
  _del: 0 | 1;
}

/**
 * A semester.
 *
 * Thin like an area: a name and the two dates that bound it. Everything else
 * about a term is a property of the courses inside it, and the moment this
 * carries more it starts competing with the course for which one holds the
 * plan.
 */
export interface Term extends SyncedRow {
  name: string;
  startDate: PlainDate;
  endDate: PlainDate;
  sortKey: string;
  _del: 0 | 1;
}

/** One meeting of a course, in wall clock like every other time on a row. */
export interface CourseMeeting {
  /** ISO day of week, 1 Monday through 7 Sunday. */
  byday: number;
  start: PlainTime;
  end: PlainTime;
  location: string;
}

/** One band of a grading scale. `min` is the lowest percent that earns it. */
export interface GradeBand {
  letter: string;
  min: number;
  points: number;
}

export interface Course extends SyncedRow {
  termId: string;
  /** "CS 6035". What you call it out loud, so it leads every list. */
  code: string;
  name: string;
  /** Hex. Survives export and needs no lookup table, same as a project's. */
  color: string;
  creditHours: number;
  instructor: string;
  meetings: CourseMeeting[];
  /** Empty means the default scale. Per course, because a seminar graded A/B/C
   *  and a lab graded on 93 are both normal. */
  gradeScale: GradeBand[];
  status: 'active' | 'done' | 'dropped';
  notes: string;
  /** What Canvas calls this course, when its own code is not close enough to
   *  match on. `CS-6035-O01` for a course you call CS 6035. */
  feedLabel: string;
  sortKey: string;
  _del: 0 | 1;
}

/**
 * "Homework is 30% of the grade."
 *
 * `weight` is a percentage because that is how a syllabus writes it. The weights
 * across a course are not forced to sum to 100: extra credit sums past it, a
 * syllabus half entered sums under it, and refusing the row would mean you
 * cannot record a course until you have all of it.
 */
export interface CourseComponent extends SyncedRow {
  courseId: string;
  name: string;
  weight: number;
  /** How many of the worst scores this bucket throws away. */
  dropLowest: number;
  sortKey: string;
  _del: 0 | 1;
}

/**
 * A folder for projects, and nothing else.
 *
 * Deliberately thinner than a project: a name and a place in the order. An area
 * carries no colour, no due date and no status, because the moment it does it
 * competes with the project for which one holds the plan, and the answer has to
 * stay the project.
 */
export interface Area extends SyncedRow {
  name: string;
  sortKey: string;
  _del: 0 | 1;
}

export interface Project extends SyncedRow {
  areaId: string;
  name: string;
  notes: string;
  status: 'active' | 'on_hold' | 'done' | 'cancelled';
  /** Hex. Survives export and needs no lookup table. */
  color: string;
  dueDate: PlainDate | null;
  completedAt: Instant | null;
  sortKey: string;
  archivedAt: Instant | null;
  _del: 0 | 1;
  _archived: 0 | 1;
}

export interface Tag extends SyncedRow {
  name: string;
  color: string;
  sortKey: string;
  _del: 0 | 1;
}

/**
 * "Remind me two days before this one."
 *
 * The global `reminderLeadMinutes` is one number for every task, which cannot
 * say that a thesis deadline wants two days and a standup wants five minutes.
 * A row here overrides it for one task, and the pipeline in 0008 has always
 * preferred an explicit reminder over the derived one.
 *
 * `offsetMinutes` is signed against the due instant: negative is before, which
 * is the direction people mean. Positive is legal and means after, which is
 * occasionally what somebody wants for a follow-up.
 */
export interface TaskReminder extends SyncedRow {
  taskId: string;
  offsetMinutes: number;
  _del: 0 | 1;
}

/**
 * A recurring series.
 *
 * Holds the rule and the counters, nothing else. The next occurrence is cloned
 * from the one just completed, so there is no second set of template columns to
 * keep in step with the task, no series-level tag table and no series-level
 * reminders. "Edit all future occurrences" becomes "edit the open occurrence",
 * which is how people already expect it to behave.
 *
 * Column names mirror the Postgres `task_series` table so the sync mapping stays
 * a rename from snake_case and nothing else.
 */
export interface TaskSeries extends SyncedRow {
  /** Discriminator reserving an RRULE escape hatch. Always 'structured' today. */
  kind: 'structured';
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  /** Every N periods. 1 means every period. */
  interval: number;
  /** ISO days of week, 1 Monday through 7 Sunday. Empty unless weekly, or
   *  monthly paired with `monthWeek`. */
  byday: number[];
  /** 1 through 31, or -1 for the last day of the month. */
  bymonthday: number[];
  bymonth: number[];
  /** 1 through 5 for "nth", -1 for "last". 0 means unused. */
  monthWeek: number;
  anchorMode: 'due_date' | 'completion_date';
  catchupPolicy: 'skip_to_future' | 'keep_backlog';
  endsMode: 'never' | 'on_date' | 'after_count';
  endsOn: PlainDate | null;
  endsAfterCount: number | null;
  /** Occurrences completed so far. Drives `endsAfterCount`. */
  completedCount: number;
  _del: 0 | 1;
}

/**
 * One run of the focus timer.
 *
 * Written when the timer starts, finished when it stops, so a tab that dies
 * mid-session still leaves a record of the part that happened. `focusedSeconds`
 * is accumulated by the client with paused time excluded, which is why it is
 * stored rather than derived from the two instants.
 *
 * These are the only absolute instants in a local row. A task due 9am is due at
 * 9am wherever you stand; a session that began at 14:03 began once.
 */
export interface FocusSession extends SyncedRow {
  /** '' when the session is not about one task. */
  taskId: string;
  startedAt: Instant;
  /** Null while it is still running. */
  endedAt: Instant | null;
  plannedMinutes: number;
  focusedSeconds: number;
  _del: 0 | 1;
}

/**
 * One thing that happened, and enough to take it back.
 *
 * `before` and `after` hold only the fields that moved, in the local camelCase
 * shape, which is exactly what `mutations.ts` takes as a patch. Storing the
 * wire shape would mean undo had to translate on the way out.
 *
 * `groupId` is one gesture. A bulk reschedule of six tasks writes six entries
 * sharing a group, and undo takes the group rather than the row, because
 * somebody who moved six things and pressed undo was not asking about the
 * sixth one.
 */
export type ActivityAction =
  | 'create'
  | 'update'
  | 'complete'
  | 'reopen'
  | 'delete'
  | 'restore';

export interface ActivityEntry extends SyncedRow {
  action: ActivityAction;
  /** Only 'tasks' today. The column exists so a second kind needs no migration
   *  of the rows already written. */
  entityTable: 'tasks';
  entityId: string;
  groupId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  /** What a toast says. Written by the client that made the change, so undoing
   *  on a phone can still name what it took back. */
  summary: string;
  /** Set once the entry has been taken back. The entry stays: it is still true,
   *  it just no longer stands. */
  undoneAt: Instant | null;
  _del: 0 | 1;
  /** 1 when `undoneAt` is set. Leads the stack index, since booleans cannot be
   *  indexed. */
  _undone: 0 | 1;
}

/**
 * A filter with a name.
 *
 * `filter` and `sort` are the shapes `lib/views/filter.ts` defines. They are
 * typed as unknown-ish here on purpose: this file describes rows, and a row
 * written by a newer client can carry a filter key this one has never heard of.
 * Reading it back as a partial is correct; rejecting it would lose the view.
 */
export interface SavedView extends SyncedRow {
  name: string;
  /** A Phosphor icon name the client knows, or a fallback. */
  icon: string;
  filter: Record<string, unknown>;
  sort: string;
  /** In the sidebar, rather than only on the views screen. */
  pinned: boolean;
  sortKey: string;
  _del: 0 | 1;
}

/** Join rows are hard-deleted rather than tombstoned. The sync layer treats
 *  "the tag set for task X" as a replaceable set keyed by taskId, which avoids
 *  needing tombstones on a three-column table. */
export interface TaskTag {
  taskId: string;
  tagId: string;
  userId: string;
  createdAt: Instant;
  rowVersion: number;
}

export interface Prefs {
  /** Always 'me'. A singleton row, so the key is a constant. */
  id: 'me';
  /** IANA name. Drives every local date calculation, and every reminder instant. */
  timezone: string;
  /** ISO day of week, 1 Monday through 7 Sunday. */
  weekStart: number;
  allDayReminderTime: PlainTime;
  digestEnabled: boolean;
  digestTime: PlainTime;

  /** The master switch. Off means nothing at all is emailed. */
  emailEnabled: boolean;
  /** Per-task reminders at the due time. */
  remindersEnabled: boolean;
  /** Minutes before the due instant. Positive, because that is how people say it. */
  reminderLeadMinutes: number;
  quietHoursEnabled: boolean;
  quietStart: PlainTime;
  quietEnd: PlainTime;
  nudgeEnabled: boolean;
  nudgeTime: PlainTime;
  weeklyReviewEnabled: boolean;
  weeklyReviewDay: number;
  weeklyReviewTime: PlainTime;
  maxReminderEmailsPerDay: number;

  /** Minutes of real work in a work day. Hours of work, not hours awake: a
   *  capacity set to eight tells you everything is fine right up to the week it
   *  is not, which is the opposite of the point. */
  dailyCapacityMinutes: number;
  /** ISO weekdays that carry capacity, 1 Monday through 7 Sunday. */
  workDays: number[];
  /** Server-owned in practice: bumping it revokes every unsubscribe link. */
  emailTokenVersion: number;

  rowVersion: number;
  updatedAt: Instant;
}

// ─── Outbox ───────────────────────────────────────────────────────────────────

export type EntityTable =
  | 'tasks'
  | 'areas'
  | 'projects'
  | 'terms'
  | 'courses'
  | 'courseComponents'
  | 'feeds'
  | 'courseEvents'
  | 'taskReminders'
  | 'tags'
  | 'taskTags'
  | 'taskSeries'
  | 'focusSessions'
  | 'activityLog'
  | 'savedViews'
  | 'prefs';
export type MutationOp = 'insert' | 'update' | 'delete' | 'undelete';
export type OutboxState = 'pending' | 'inflight' | 'failed' | 'dead';

export interface OutboxRecord {
  /** Dexie auto-increment. Gives a total order for this device, which is all the
   *  ordering the protocol needs: batches apply in array order inside one
   *  server transaction. */
  seq?: number;
  /** Server idempotency key. A retried push returns the original result rather
   *  than applying twice. */
  mutationId: string;
  /** Mutations that must land in one server transaction share a batchId, so a
   *  subtask created offline under an offline-created project commits atomically
   *  or not at all. */
  batchId: string | null;
  table: EntityTable;
  entityId: string;
  op: MutationOp;
  /** Sparse: only the changed fields. An insert carries the full row. */
  patch: Record<string, unknown>;
  /** The rowVersion the client held while editing. 0 for an insert. The server
   *  compares this against field_versions to decide the per-field merge. */
  baseVersion: number;
  /** entityIds that must exist server-side first, so the server can topologically
   *  sort within a batch to satisfy foreign keys. */
  deps: string[];
  /** Client clock. Diagnostics and intra-device ordering only, never trusted for
   *  conflict resolution. */
  createdAt: number;
  state: OutboxState;
  attempts: number;
  nextAttemptAt: number;
  lastError?: { code: string; message: string; status?: number; at: number };
}

export interface SyncMetaRow {
  key: string;
  value: unknown;
}

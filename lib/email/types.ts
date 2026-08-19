/**
 * The shapes `claim_reminder_batch` hands back.
 *
 * Mirrored from `reminder_payload` in 0008 rather than generated, because the
 * only consumer is the route and one hand-written interface is cheaper than a
 * codegen step. `lib/email/render.test.ts` renders each of them, so a payload
 * that changes shape server-side breaks a test rather than an inbox.
 */

export type ReminderKind = 'task_reminder' | 'daily_digest' | 'overdue_nudge' | 'weekly_review';

/** How far a task's subtasks have got. Absent when it has none. */
export interface SubtaskProgress {
  done: number;
  total: number;
}

/**
 * What every task carries beyond its title, added in 0013.
 *
 * Optional to a field, because a delivery claimed before that migration and
 * retried after it renders from a payload that predates all of this.
 */
export interface TaskDetail {
  projectColor?: string | null;
  waiting?: boolean;
  repeats?: boolean;
  estimate?: number | null;
  tags?: string[];
  subtasks?: SubtaskProgress | null;
}

/** One line in a list. `dueTime` is wall clock, already local to the reader. */
export interface DigestItem extends TaskDetail {
  id: string;
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  priority: number;
  project: string | null;
  planned: boolean;
}

export interface TaskReminderPayload {
  kind: 'task_reminder';
  task: TaskDetail & {
    id: string;
    title: string;
    notes: string;
    dueDate: string | null;
    dueTime: string | null;
    priority: number;
    project: string | null;
  };
}

/** One column of the weekly chart. `date` is a local calendar day. */
export interface DayCount {
  date: string;
  count: number;
}

export interface SummaryPayload {
  kind: 'daily_digest' | 'overdue_nudge' | 'weekly_review';
  localDate: string;
  today: DigestItem[];
  overdue: DigestItem[];
  dueSoon: DigestItem[];
  completedThisWeek: number;
  openTotal: number;
  completedToday?: number;
  completedByDay?: DayCount[];
  streak?: number;
}

export type ReminderPayload = TaskReminderPayload | SummaryPayload;

/**
 * Which ways this delivery may go out, decided by the claim in 0014.
 *
 * At least one is always true: a row with both closed is cancelled in Postgres
 * and never reaches the route.
 */
export interface Channels {
  email: boolean;
  push: boolean;
}

export interface ClaimedDelivery {
  id: string;
  userId: string;
  kind: ReminderKind;
  /** Null only where the account has no address at all, which is push-only. */
  email: string | null;
  channels: Channels;
  scheduledAt: string;
  dedupeKey: string;
  attempts: number;
  timezone: string;
  tokenVersion: number;
  payload: ReminderPayload;
}

export interface ClaimResponse {
  claimed: ClaimedDelivery[];
  skipped: number;
  quotaAvailable: boolean;
}

/**
 * Deliveries that go out as one email.
 *
 * Task reminders coalesce: three tasks due inside the same ten minutes are one
 * email with three lines, not three emails. That is the first line of defence on
 * a 100 a day allowance, and it is also what a person would rather receive.
 */
/**
 * One notification, on whatever channels its deliveries agreed on.
 *
 * Still called a group rather than renamed, because that is what it has always
 * been: the set of deliveries that become one thing a person receives. What
 * changed in 0014 is that "one thing" can now be an email, a push, or both.
 */
export interface EmailGroup {
  kind: ReminderKind;
  userId: string;
  /** Null on a push-only group, so every read of it is guarded. */
  email: string | null;
  channels: Channels;
  timezone: string;
  tokenVersion: number;
  deliveries: ClaimedDelivery[];
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  /** Minted while rendering, because the footer link and the RFC 8058 header
   *  have to be the same URL. */
  unsubscribeUrl: string;
}

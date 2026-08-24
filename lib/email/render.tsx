import { render } from '@react-email/render';
import { APP_NAME } from '@/lib/config';
import { DigestEmail, plannedMinutes } from '@/emails/DigestEmail';
import { SignInEmail } from '@/emails/SignInEmail';
import { NudgeEmail } from '@/emails/NudgeEmail';
import { ReminderEmail } from '@/emails/ReminderEmail';
import { ReviewEmail } from '@/emails/ReviewEmail';
import { authCodeSubject, authCodeText } from './auth-code';
import { appUrl } from './env';
import {
  formatDay,
  formatDuration,
  formatRelativeDay,
  formatTime,
  formatWhen,
  plural,
  taskMeta,
} from './format';
import type {
  DigestItem,
  EmailGroup,
  RenderedEmail,
  SummaryPayload,
  TaskReminderPayload,
} from './types';
import { unsubscribeUrl } from './unsubscribe';

/**
 * The sign-in code, which is the one email nobody subscribed to.
 *
 * No unsubscribe anywhere in it, so `sendEmail` leaves the RFC 8058 headers off
 * too. A code is transactional: the person asked for it thirty seconds ago and
 * there is nothing to opt out of.
 */
export async function renderSignInCode(code: string): Promise<RenderedEmail> {
  const app = appUrl();

  return {
    subject: authCodeSubject(code, APP_NAME),
    html: await render(<SignInEmail code={code} appUrl={app} />),
    text: authCodeText(code, APP_NAME, app),
  };
}

/**
 * A group of claimed deliveries turned into one email.
 *
 * The plaintext part is written by hand rather than derived from the markup. An
 * automatic conversion of a table layout reads like a table read aloud, and the
 * text part is what a screen reader and a plain-text client actually get.
 */
export async function renderGroup(group: EmailGroup): Promise<RenderedEmail> {
  // Guaranteed by the claim, which closes the email channel when the account has
  // no address, and asserted here because the unsubscribe token is signed over
  // the address and a group without one has no email to render.
  if (!group.email) {
    throw new Error('cannot render an email for a group with no address');
  }

  const app = appUrl();
  const address = group.email;
  const unsubscribe = unsubscribeUrl({
    email: address,
    kind: group.kind,
    version: group.tokenVersion,
  });
  const links = { appUrl: app, unsubscribeUrl: unsubscribe };

  if (group.kind === 'task_reminder') {
    const tasks = group.deliveries
      .map((delivery) => (delivery.payload as TaskReminderPayload).task)
      .filter(Boolean);

    return {
      subject: reminderSubject(tasks),
      html: await render(<ReminderEmail tasks={tasks} {...links} />),
      text: reminderText(tasks, app, unsubscribe),
      unsubscribeUrl: unsubscribe,
    };
  }

  const payload = group.deliveries[0]!.payload as SummaryPayload;

  if (group.kind === 'overdue_nudge') {
    return {
      subject: nudgeSubject(payload),
      html: await render(<NudgeEmail payload={payload} {...links} />),
      text: summaryText(
        [
          `${plural(payload.overdue.length, 'task')} past due`,
          `${payload.completedToday ?? 0} done today, ${plural(payload.openTotal, 'task')} open`,
        ],
        payload,
        [['Late', payload.overdue]],
        app,
        unsubscribe,
      ),
      unsubscribeUrl: unsubscribe,
    };
  }

  if (group.kind === 'weekly_review') {
    const streak = payload.streak ?? 0;

    return {
      subject: reviewSubject(payload),
      html: await render(<ReviewEmail payload={payload} {...links} />),
      text: summaryText(
        [
          `${plural(payload.completedThisWeek, 'task')} done, ${plural(payload.openTotal, 'task')} open`,
          ...(streak >= 2 ? [`${streak} days in a row.`] : []),
        ],
        payload,
        [
          ['Carried over', payload.overdue],
          ['This week', payload.dueSoon],
        ],
        app,
        unsubscribe,
      ),
      unsubscribeUrl: unsubscribe,
    };
  }

  const planned = plannedMinutes(payload.today);

  return {
    subject: digestSubject(payload),
    html: await render(<DigestEmail payload={payload} {...links} />),
    text: summaryText(
      [
        formatDay(payload.localDate),
        ...(planned > 0 ? [`${formatDuration(planned)} planned.`] : []),
      ],
      payload,
      [
        ['Late', payload.overdue],
        ['Today', payload.today],
        ['Next few days', payload.dueSoon],
      ],
      app,
      unsubscribe,
    ),
    unsubscribeUrl: unsubscribe,
  };
}

/**
 * The longest a task title may be before it is cut.
 *
 * A subject is read in a list two lines high and a notification in one. Past
 * this the tail is being written for nobody, and the count after it, which is the
 * part that says how much else there is, gets pushed out of sight.
 */
const LEAD_TITLE = 48;

function clip(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length <= LEAD_TITLE) return trimmed;
  // Cut on a word rather than mid-syllable, then only if that leaves most of the
  // room used: a title of one very long word should still be cut somewhere.
  const cut = trimmed.slice(0, LEAD_TITLE);
  const space = cut.lastIndexOf(' ');
  return `${(space > LEAD_TITLE * 0.6 ? cut.slice(0, space) : cut).trimEnd()}...`;
}

/**
 * The one task worth naming, and which list it came from.
 *
 * Late outranks today, because a subject that names something due at five while
 * two things have already slipped is a subject that buries the alarm. Shared with
 * the push title so the notification and the email cannot name different tasks
 * for the same morning.
 */
export function summaryLead(
  payload: SummaryPayload,
): { item: DigestItem; late: boolean } | null {
  const late = payload.overdue[0];
  if (late) return { item: late, late: true };
  const today = payload.today[0];
  if (today) return { item: today, late: false };
  const soon = payload.dueSoon[0];
  return soon ? { item: soon, late: false } : null;
}

/**
 * Name the thing, then say how much else there is.
 *
 * The old shape was "Today: 4 tasks, 2 late", which spends a whole subject line
 * on two numbers the reader could have guessed. A title is the only part of this
 * that could not have been guessed, so it goes first and the counts follow it.
 */
export function digestSubject(payload: SummaryPayload): string {
  const lead = summaryLead(payload);
  if (!lead) return 'Nothing due today';

  // Late and today are the actionable set. What is merely coming up is not
  // something this subject counts, or a quiet day with a busy Friday reads busy.
  const actionable = payload.overdue.length + payload.today.length;
  const rest = Math.max(actionable - 1, 0);
  const title = clip(lead.item.title);

  if (lead.late) {
    if (rest === 0) return `${title} is late`;
    return `${title} is late, and ${rest} more to do`;
  }

  if (actionable === 0) return `${title} is coming up`;
  if (rest === 0) return `${title}, and nothing else today`;
  return `${title}, and ${plural(rest, 'more task')} today`;
}

/** The evening nudge, which is late by definition, so it never says so twice. */
export function nudgeSubject(payload: SummaryPayload): string {
  const first = payload.overdue[0];
  if (!first) return 'Nothing is past due';

  const rest = payload.overdue.length - 1;
  const title = clip(first.title);
  return rest === 0 ? `${title} is past due` : `${title}, and ${rest} more past due`;
}

/**
 * The week, as two numbers rather than a task.
 *
 * The exception to naming the thing, on purpose: a review is about the shape of
 * the week and there is no one task it is about. What got done and what is still
 * open is the shape.
 */
export function reviewSubject(payload: SummaryPayload): string {
  const done = payload.completedThisWeek;
  if (done === 0 && payload.openTotal === 0) return 'A clear week';
  if (done === 0) return `Nothing closed last week, ${payload.openTotal} still open`;
  return `${done} done last week, ${payload.openTotal} still open`;
}

export function reminderSubject(tasks: TaskReminderPayload['task'][]): string {
  const first = tasks[0];
  if (!first) return 'A task is due';
  if (tasks.length === 1) {
    const when = first.dueTime ? `, due ${formatTime(first.dueTime)}` : ' is due';
    return `${first.title}${when}`;
  }
  return `${tasks.length} due now: ${first.title} and ${tasks.length - 1} more`;
}

function line(item: DigestItem, localDate: string): string {
  const when = item.dueDate
    ? formatRelativeDay(item.dueDate, localDate) + (item.dueTime ? `, ${formatTime(item.dueTime)}` : '')
    : 'planned';
  const meta = taskMeta(item);
  const detail = meta.length > 0 ? ` (${meta.join(', ')})` : '';
  return `- ${item.title}${detail} — ${when}`;
}

function footer(app: string, unsubscribe: string): string {
  return ['', `Open Tend: ${app}`, `Turn these off: ${unsubscribe}`].join('\n');
}

function summaryText(
  intro: string[],
  payload: SummaryPayload,
  sections: [string, DigestItem[]][],
  app: string,
  unsubscribe: string,
): string {
  const lines = [...intro, ''];
  const before = lines.length;

  for (const [title, items] of sections) {
    if (items.length === 0) continue;
    lines.push(`${title}:`);
    for (const item of items) lines.push(line(item, payload.localDate));
    lines.push('');
  }

  if (lines.length === before) lines.push('Nothing due and nothing late.', '');
  return lines.join('\n').trimEnd() + footer(app, unsubscribe);
}

function reminderText(
  tasks: TaskReminderPayload['task'][],
  app: string,
  unsubscribe: string,
): string {
  const lines = [tasks.length === 1 ? 'Due now' : `${tasks.length} due now`, ''];

  for (const task of tasks) {
    const when = formatWhen(task.dueDate, task.dueTime);
    const meta = taskMeta(task);
    const detail = meta.length > 0 ? ` (${meta.join(', ')})` : '';
    lines.push(`- ${task.title}${when ? ` — ${when}` : ''}${detail}`);
    if (tasks.length === 1 && task.notes) lines.push('', task.notes);
  }

  return lines.join('\n').trimEnd() + footer(app, unsubscribe);
}

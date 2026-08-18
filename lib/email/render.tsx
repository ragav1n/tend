import { render } from '@react-email/render';
import { DigestEmail } from '@/emails/DigestEmail';
import { NudgeEmail } from '@/emails/NudgeEmail';
import { ReminderEmail } from '@/emails/ReminderEmail';
import { ReviewEmail } from '@/emails/ReviewEmail';
import { appUrl } from './env';
import { formatDay, formatRelativeDay, formatTime, formatWhen, plural } from './format';
import type {
  DigestItem,
  EmailGroup,
  RenderedEmail,
  SummaryPayload,
  TaskReminderPayload,
} from './types';
import { unsubscribeUrl } from './unsubscribe';

/**
 * A group of claimed deliveries turned into one email.
 *
 * The plaintext part is written by hand rather than derived from the markup. An
 * automatic conversion of a table layout reads like a table read aloud, and the
 * text part is what a screen reader and a plain-text client actually get.
 */
export async function renderGroup(group: EmailGroup): Promise<RenderedEmail> {
  const app = appUrl();
  const unsubscribe = unsubscribeUrl({
    email: group.email,
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
      subject: `${plural(payload.overdue.length, 'task')} past due`,
      html: await render(<NudgeEmail payload={payload} {...links} />),
      text: summaryText(`${plural(payload.overdue.length, 'task')} past due`, payload, [
        ['Late', payload.overdue],
      ], app, unsubscribe),
      unsubscribeUrl: unsubscribe,
    };
  }

  if (group.kind === 'weekly_review') {
    return {
      subject: `Last week: ${plural(payload.completedThisWeek, 'task')} done`,
      html: await render(<ReviewEmail payload={payload} {...links} />),
      text: summaryText(
        `${plural(payload.completedThisWeek, 'task')} done, ${plural(payload.openTotal, 'task')} open`,
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

  return {
    subject: digestSubject(payload),
    html: await render(<DigestEmail payload={payload} {...links} />),
    text: summaryText(
      formatDay(payload.localDate),
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

export function digestSubject(payload: SummaryPayload): string {
  if (payload.today.length === 0 && payload.overdue.length === 0) {
    return 'Today: nothing due';
  }

  const parts: string[] = [];
  if (payload.today.length > 0) parts.push(plural(payload.today.length, 'task'));
  if (payload.overdue.length > 0) parts.push(`${payload.overdue.length} late`);
  return `Today: ${parts.join(', ')}`;
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
  const project = item.project ? ` (${item.project})` : '';
  return `- ${item.title}${project} — ${when}`;
}

function footer(app: string, unsubscribe: string): string {
  return ['', `Open Tend: ${app}`, `Turn these off: ${unsubscribe}`].join('\n');
}

function summaryText(
  heading: string,
  payload: SummaryPayload,
  sections: [string, DigestItem[]][],
  app: string,
  unsubscribe: string,
): string {
  const lines = [heading, ''];

  for (const [title, items] of sections) {
    if (items.length === 0) continue;
    lines.push(`${title}:`);
    for (const item of items) lines.push(line(item, payload.localDate));
    lines.push('');
  }

  if (lines.length === 2) lines.push('Nothing due and nothing late.', '');
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
    lines.push(`- ${task.title}${when ? ` — ${when}` : ''}${task.project ? ` (${task.project})` : ''}`);
    if (tasks.length === 1 && task.notes) lines.push('', task.notes);
  }

  return lines.join('\n').trimEnd() + footer(app, unsubscribe);
}

import { digestSubject, reminderSubject } from '@/lib/email/render';
import { formatTime, plural, taskMeta } from '@/lib/email/format';
import type { DigestItem, EmailGroup, SummaryPayload, TaskReminderPayload } from '@/lib/email/types';

/**
 * A group turned into the notification a phone will show.
 *
 * Not the email with the markup stripped. A notification is two short lines on a
 * lock screen and the whole thing has to be readable without opening anything, so
 * the title carries the answer and the body carries the detail. The email can
 * afford a list of twelve tasks; this cannot.
 *
 * Pure, and separate from the sending, which is the only way any of these strings
 * can be held to a test. Every phrase here is the same one the email uses, through
 * the same helpers, so the two cannot drift into describing the same day
 * differently.
 */

/** Titles listed in a body before it turns into "and 4 more". */
const BODY_ITEMS = 3;

export interface PushMessage {
  title: string;
  body: string;
  /** Where a tap lands. */
  url: string;
  /**
   * Notifications sharing a tag replace each other. Per kind for the summaries,
   * because a second digest should update the first rather than stack under it,
   * and per group for reminders, because two different tasks falling due an hour
   * apart are two different things to be told.
   */
  tag: string;
}

function titles(items: DigestItem[]): string {
  if (items.length === 0) return '';
  const shown = items.slice(0, BODY_ITEMS).map((item) => item.title);
  const rest = items.length - shown.length;
  return rest > 0 ? `${shown.join(', ')}, and ${rest} more` : shown.join(', ');
}

/** The soonest of late, today and coming up, which is what to name first. */
function firstList(payload: SummaryPayload): DigestItem[] {
  if (payload.overdue.length > 0) return payload.overdue;
  if (payload.today.length > 0) return payload.today;
  return payload.dueSoon;
}

export function pushMessage(group: EmailGroup): PushMessage {
  if (group.kind === 'task_reminder') {
    const tasks = group.deliveries
      .map((delivery) => (delivery.payload as TaskReminderPayload).task)
      .filter(Boolean);
    const first = tasks[0];

    if (tasks.length === 1 && first) {
      // The title is the task, because that is the thing being remembered. The
      // time and the project go underneath rather than into a title that gets
      // truncated on a narrow lock screen.
      const meta = [
        ...(first.dueTime ? [`Due ${formatTime(first.dueTime)}`] : ['Due now']),
        ...taskMeta(first),
      ];
      return {
        title: first.title,
        body: meta.join(' · '),
        url: '/today',
        tag: `task:${group.deliveries[0]!.dedupeKey}`,
      };
    }

    return {
      title: reminderSubject(tasks),
      body: titles(tasks.map((task) => ({ title: task.title }) as DigestItem)),
      url: '/today',
      tag: `task:${group.deliveries[0]!.dedupeKey}`,
    };
  }

  const payload = group.deliveries[0]!.payload as SummaryPayload;

  if (group.kind === 'overdue_nudge') {
    return {
      title: `${plural(payload.overdue.length, 'task')} past due`,
      body: titles(payload.overdue),
      url: '/today',
      tag: 'overdue_nudge',
    };
  }

  if (group.kind === 'weekly_review') {
    const streak = payload.streak ?? 0;
    return {
      title: `Last week: ${plural(payload.completedThisWeek, 'task')} done`,
      body: [
        `${plural(payload.openTotal, 'task')} open`,
        ...(streak >= 2 ? [`${streak} days in a row`] : []),
      ].join(' · '),
      url: '/logbook',
      tag: 'weekly_review',
    };
  }

  return {
    title: digestSubject(payload),
    body: titles(firstList(payload)) || 'Nothing due. Enjoy it.',
    url: '/today',
    tag: 'daily_digest',
  };
}

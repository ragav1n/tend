import {
  digestSubject,
  nudgeSubject,
  reminderSubject,
  reviewSubject,
  summaryLead,
} from '@/lib/email/render';
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

/**
 * The body for a summary, given that the title now names the leading task.
 *
 * Dropping that task here is the whole point: a title reading "Repot the ficus is
 * late" over a body reading "Repot the ficus" says the same thing twice on a
 * surface two lines tall.
 *
 * Drawn from every list rather than from the one the lead came out of. Filtering
 * inside that list alone empties the body whenever the lead was the only thing in
 * it, and an empty body falls through to "nothing due" on a day that has work in
 * the next list down.
 */
function restOf(payload: SummaryPayload): string {
  const lead = summaryLead(payload);
  const all = [...payload.overdue, ...payload.today, ...payload.dueSoon];
  const rest = lead ? all.filter((item) => item.id !== lead.item.id) : all;
  return titles(rest);
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
      title: nudgeSubject(payload),
      body: restOf(payload) || `${plural(payload.openTotal, 'task')} open`,
      url: '/today',
      tag: 'overdue_nudge',
    };
  }

  if (group.kind === 'weekly_review') {
    const streak = payload.streak ?? 0;
    return {
      title: reviewSubject(payload),
      // The subject already carries done and open, so the body carries the one
      // thing it does not: how long the run is.
      body:
        streak >= 2
          ? `${streak} days in a row`
          : `${plural(payload.completedThisWeek, 'task')} closed`,
      url: '/logbook',
      tag: 'weekly_review',
    };
  }

  return {
    title: digestSubject(payload),
    body: restOf(payload) || 'Nothing due. Enjoy it.',
    url: '/today',
    tag: 'daily_digest',
  };
}

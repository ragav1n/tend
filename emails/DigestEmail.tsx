import { Section, Text } from '@react-email/components';
import type { DigestItem, SummaryPayload } from '@/lib/email/types';
import { formatDay, formatDuration, plural } from '@/lib/email/format';
import { Action, Heading, Shell, Stats } from './Shell';
import { TaskList } from './TaskList';
import { email, fonts } from './theme';

/**
 * The morning digest, and the reason this app can live inside 100 emails a day.
 *
 * One email carrying today's plan, what is late and what is coming replaces a
 * dozen individual reminders, and it is what a person actually wants: the day on
 * one screen rather than a drip.
 *
 * The numbers sit in a band under the date because a count belongs at the top of
 * a list and not inside it. They are hidden on an empty day: three zeroes over
 * "nothing is due" is a worse way of saying the same thing.
 */
export interface DigestEmailProps {
  payload: SummaryPayload;
  appUrl: string;
  unsubscribeUrl: string;
}

export function DigestEmail({ payload, appUrl, unsubscribeUrl }: DigestEmailProps) {
  const { today, overdue, dueSoon, localDate } = payload;
  const nothing = today.length === 0 && overdue.length === 0;

  return (
    <Shell
      preview={digestPreview(payload)}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      reason="You get this each morning because your Tend digest is on."
    >
      <Section style={{ backgroundColor: email.surface }}>
        <Text
          style={{
            fontFamily: fonts.serif,
            fontSize: 24,
            lineHeight: '32px',
            color: email.heading,
            margin: '22px 0 0',
          }}
        >
          {formatDay(localDate)}
        </Text>
        <Text style={{ fontSize: 15, lineHeight: '22px', color: email.textSoft, margin: '4px 0 0' }}>
          {nothing ? 'Nothing is due and nothing is late. Enjoy it.' : summary(payload)}
        </Text>
      </Section>

      {nothing ? null : (
        <Stats
          items={[
            { value: String(today.length), label: 'today' },
            { value: String(overdue.length), label: 'late' },
            thirdStat(payload),
          ]}
        />
      )}

      {overdue.length > 0 ? (
        <>
          <Heading>Late</Heading>
          <TaskList items={overdue} localDate={localDate} showDay />
        </>
      ) : null}

      {today.length > 0 ? (
        <>
          <Heading>Today</Heading>
          <TaskList items={today} localDate={localDate} />
        </>
      ) : null}

      {dueSoon.length > 0 ? (
        <>
          <Heading>Next few days</Heading>
          <TaskList items={dueSoon} localDate={localDate} showDay />
        </>
      ) : null}

      <Action href={appUrl}>Open today</Action>
    </Shell>
  );
}

export function digestPreview(payload: SummaryPayload): string {
  if (payload.today.length === 0 && payload.overdue.length === 0) {
    return 'Nothing due today.';
  }
  return summary(payload);
}

/** The estimates on today's list, which is the closest thing to a plan for it. */
export function plannedMinutes(items: DigestItem[]): number {
  return items.reduce((total, item) => total + (item.estimate ?? 0), 0);
}

/**
 * Time planned when the tasks carry estimates, and the size of the backlog when
 * they do not. Nobody has filled in an estimate on an empty afternoon.
 */
function thirdStat(payload: SummaryPayload): { value: string; label: string } {
  const minutes = plannedMinutes(payload.today);
  if (minutes > 0) return { value: formatDuration(minutes), label: 'planned' };
  return { value: String(payload.openTotal), label: 'open' };
}

function summary(payload: SummaryPayload): string {
  const parts: string[] = [];
  if (payload.today.length > 0) parts.push(`${plural(payload.today.length, 'task')} today`);
  if (payload.overdue.length > 0) parts.push(`${payload.overdue.length} late`);
  if (payload.dueSoon.length > 0) parts.push(`${payload.dueSoon.length} coming up`);
  return parts.join(', ');
}

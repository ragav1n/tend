import { Section, Text } from '@react-email/components';
import type { SummaryPayload } from '@/lib/email/types';
import { formatDay, plural } from '@/lib/email/format';
import { Action, Heading, Shell } from './Shell';
import { TaskList } from './TaskList';
import { email } from './theme';

/**
 * The morning digest, and the reason this app can live inside 100 emails a day.
 *
 * One email carrying today's plan, what is late and what is coming replaces a
 * dozen individual reminders, and it is what a person actually wants: the day on
 * one screen rather than a drip.
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
        <Text style={{ fontSize: 22, lineHeight: '30px', color: email.heading, margin: '20px 0 0' }}>
          {formatDay(localDate)}
        </Text>
        <Text style={{ fontSize: 15, lineHeight: '22px', color: email.textSoft, margin: '4px 0 0' }}>
          {nothing
            ? 'Nothing is due and nothing is late. Enjoy it.'
            : summary(payload)}
        </Text>
      </Section>

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

function summary(payload: SummaryPayload): string {
  const parts: string[] = [];
  if (payload.today.length > 0) parts.push(`${plural(payload.today.length, 'task')} today`);
  if (payload.overdue.length > 0) parts.push(`${payload.overdue.length} late`);
  if (payload.dueSoon.length > 0) parts.push(`${payload.dueSoon.length} coming up`);
  return parts.join(', ');
}

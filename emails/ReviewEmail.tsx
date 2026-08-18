import { Section, Text } from '@react-email/components';
import type { SummaryPayload } from '@/lib/email/types';
import { plural } from '@/lib/email/format';
import { Action, Heading, Shell } from './Shell';
import { TaskList } from './TaskList';
import { email } from './theme';

/**
 * The weekly review. A count of what got done, then what is still waiting, which
 * is the only pair of numbers worth putting in front of somebody once a week.
 */
export function ReviewEmail({
  payload,
  appUrl,
  unsubscribeUrl,
}: {
  payload: SummaryPayload;
  appUrl: string;
  unsubscribeUrl: string;
}) {
  return (
    <Shell
      preview={`${plural(payload.completedThisWeek, 'task')} done last week.`}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      reason="You get this once a week because your Tend review is on."
    >
      <Section style={{ backgroundColor: email.surface }}>
        <Text style={{ fontSize: 22, lineHeight: '30px', color: email.heading, margin: '20px 0 0' }}>
          {plural(payload.completedThisWeek, 'task')} done
        </Text>
        <Text style={{ fontSize: 15, lineHeight: '22px', color: email.textSoft, margin: '4px 0 0' }}>
          {plural(payload.openTotal, 'task')} still open
          {payload.overdue.length > 0 ? `, ${payload.overdue.length} of them late` : ''}.
        </Text>
      </Section>

      {payload.overdue.length > 0 ? (
        <>
          <Heading>Carried over</Heading>
          <TaskList items={payload.overdue} localDate={payload.localDate} showDay />
        </>
      ) : null}

      {payload.dueSoon.length > 0 ? (
        <>
          <Heading>This week</Heading>
          <TaskList items={payload.dueSoon} localDate={payload.localDate} showDay />
        </>
      ) : null}

      <Action href={appUrl}>Plan the week</Action>
    </Shell>
  );
}

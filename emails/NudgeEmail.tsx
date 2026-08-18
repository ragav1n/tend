import { Section, Text } from '@react-email/components';
import type { SummaryPayload } from '@/lib/email/types';
import { plural } from '@/lib/email/format';
import { Action, Shell } from './Shell';
import { TaskList } from './TaskList';
import { email } from './theme';

/**
 * The evening nudge. Only sent when something is actually late, which is enforced
 * in SQL rather than here: a nudge that says "nothing is late" is a notification
 * that teaches you to ignore notifications.
 */
export function NudgeEmail({
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
      preview={`${plural(payload.overdue.length, 'task')} past due.`}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      reason="You get this when something is still open past its date."
    >
      <Section style={{ backgroundColor: email.surface }}>
        <Text style={{ fontSize: 22, lineHeight: '30px', color: email.heading, margin: '20px 0 0' }}>
          {plural(payload.overdue.length, 'task')} past due
        </Text>
        <Text style={{ fontSize: 15, lineHeight: '22px', color: email.textSoft, margin: '4px 0 0' }}>
          Reschedule them or let them go. Both count as tending.
        </Text>
      </Section>

      <TaskList items={payload.overdue} localDate={payload.localDate} showDay />
      <Action href={appUrl}>Sort it out</Action>
    </Shell>
  );
}

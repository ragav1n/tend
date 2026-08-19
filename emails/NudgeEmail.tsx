import { Section, Text } from '@react-email/components';
import type { SummaryPayload } from '@/lib/email/types';
import { plural } from '@/lib/email/format';
import { Action, Shell, Stats } from './Shell';
import { TaskList } from './TaskList';
import { email, fonts } from './theme';

/**
 * The evening nudge. Only sent when something is actually late, which is enforced
 * in SQL rather than here: a nudge that says "nothing is late" is a notification
 * that teaches you to ignore notifications.
 *
 * The band carries what got finished today next to what did not, because an
 * evening email that counts only the misses is one nobody opens twice.
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
        <Text
          style={{
            fontFamily: fonts.serif,
            fontSize: 24,
            lineHeight: '32px',
            color: email.heading,
            margin: '22px 0 0',
          }}
        >
          {plural(payload.overdue.length, 'task')} past due
        </Text>
        <Text style={{ fontSize: 15, lineHeight: '22px', color: email.textSoft, margin: '4px 0 0' }}>
          Reschedule them or let them go. Both count as tending.
        </Text>
      </Section>

      <Stats
        items={[
          { value: String(payload.overdue.length), label: 'late' },
          { value: String(payload.completedToday ?? 0), label: 'done today' },
          { value: String(payload.openTotal), label: 'open' },
        ]}
      />

      <Section style={{ backgroundColor: email.surface, paddingTop: 14 }}>
        <TaskList items={payload.overdue} localDate={payload.localDate} showDay />
      </Section>

      <Action href={appUrl}>Sort it out</Action>
    </Shell>
  );
}

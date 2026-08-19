import { Section, Text } from '@react-email/components';
import type { SummaryPayload } from '@/lib/email/types';
import { plural } from '@/lib/email/format';
import { Action, Heading, Shell, Stats } from './Shell';
import { TaskList } from './TaskList';
import { WeekChart } from './WeekChart';
import { email, fonts } from './theme';

/**
 * The weekly review: what got done, when it got done, and what is still waiting.
 *
 * The chart is the point of this email. Two numbers say a week was busy or quiet;
 * seven bars say which days carried it, which is the only version of the question
 * anybody can act on.
 *
 * The streak only appears once it is worth mentioning. A one day streak is a day.
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
  const streak = payload.streak ?? 0;

  return (
    <Shell
      preview={`${plural(payload.completedThisWeek, 'task')} done last week.`}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      reason="You get this once a week because your Tend review is on."
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
          {plural(payload.completedThisWeek, 'task')} done
        </Text>
        <Text style={{ fontSize: 15, lineHeight: '22px', color: email.textSoft, margin: '4px 0 0' }}>
          {plural(payload.openTotal, 'task')} still open
          {payload.overdue.length > 0 ? `, ${payload.overdue.length} of them late` : ''}.
        </Text>
      </Section>

      <Stats
        items={[
          { value: String(payload.completedThisWeek), label: 'done' },
          ...(streak >= 2
            ? [{ value: `${streak}`, label: 'day streak' }]
            : [{ value: String(payload.today.length), label: 'today' }]),
          { value: String(payload.openTotal), label: 'open' },
        ]}
      />

      {payload.completedByDay && payload.completedByDay.length > 0 ? (
        <WeekChart days={payload.completedByDay} today={payload.localDate} />
      ) : null}

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

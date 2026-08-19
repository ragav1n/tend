import { Column, Row, Section, Text } from '@react-email/components';
import type { DayCount } from '@/lib/email/types';
import { weekdayInitial } from '@/lib/email/format';
import { email, fonts } from './theme';

const TALLEST = 64;
const SHORTEST = 3;

/**
 * Seven days of finished work, as bars.
 *
 * A bar is a div with a height, a matching line-height and a non-breaking space
 * inside it. An empty div collapses in Outlook's Word engine whatever height it
 * carries, and one character of content is what stops that. Everything is a table
 * cell for the same reason.
 *
 * A day nobody finished anything still gets a stub in the rule colour, because a
 * gap that renders as nothing reads as a missing column rather than a quiet day.
 */
export function WeekChart({ days, today }: { days: DayCount[]; today: string }) {
  const peak = Math.max(...days.map((day) => day.count), 1);

  return (
    <Section style={{ backgroundColor: email.surface, paddingTop: 8 }}>
      <Row style={{ backgroundColor: email.surface }}>
        {days.map((day) => {
          const height = day.count === 0 ? SHORTEST : Math.max(8, Math.round((day.count / peak) * TALLEST));

          return (
            <Column
              key={day.date}
              align="center"
              style={{
                backgroundColor: email.surface,
                verticalAlign: 'bottom',
                padding: '0 20px',
                width: '14%',
              }}
            >
              <Text
                style={{
                  fontSize: 11,
                  lineHeight: '16px',
                  color: day.count === 0 ? email.dot : email.textSoft,
                  margin: '0 0 4px',
                  textAlign: 'center',
                }}
              >
                {day.count}
              </Text>
              <div
                style={{
                  backgroundColor: day.count === 0 ? email.rule : email.heading,
                  borderRadius: 2,
                  fontSize: 1,
                  height,
                  lineHeight: `${height}px`,
                }}
              >
                &nbsp;
              </div>
              <Text
                style={{
                  fontFamily: fonts.body,
                  fontSize: 11,
                  lineHeight: '16px',
                  color: day.date === today ? email.heading : email.textSoft,
                  fontWeight: day.date === today ? 700 : 400,
                  margin: '6px 0 0',
                  textAlign: 'center',
                }}
              >
                {weekdayInitial(day.date)}
              </Text>
            </Column>
          );
        })}
      </Row>
    </Section>
  );
}

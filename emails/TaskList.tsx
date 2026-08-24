import { Column, Row, Section, Text } from '@react-email/components';
import type { DigestItem } from '@/lib/email/types';
import { formatRelativeDay, formatTime, taskMeta } from '@/lib/email/format';
import { email, fonts } from './theme';

/**
 * A list of tasks as a table, one row each.
 *
 * Three columns rather than one line of text: a dot in the project's colour, the
 * title with its small print under it, then the time. A long title wraps under
 * itself instead of pushing the time off the right edge, and the time column is
 * fixed and right aligned because that is the part people scan.
 *
 * The dot is a bullet glyph rather than a shape, because a coloured box is a div
 * with a height and Outlook's Word engine collapses those.
 *
 * `late` paints the time clay. It is the one piece of colour that carries meaning
 * rather than decoration: a section heading says "Late" once at the top, and after
 * three rows of identical grey the reader has stopped seeing it. Not derived from
 * `showDay`, which is also on for the days ahead, and nothing about next Tuesday
 * is late.
 */
export function TaskList({
  items,
  localDate,
  showDay = false,
  late = false,
}: {
  items: DigestItem[];
  localDate: string;
  showDay?: boolean;
  late?: boolean;
}) {
  return (
    <Section style={{ backgroundColor: email.surface }}>
      {items.map((item) => {
        const meta = taskMeta(item);

        return (
          <Row key={item.id} style={{ backgroundColor: email.surface }}>
            <Column
              style={{
                backgroundColor: email.surface,
                padding: '7px 0 7px',
                verticalAlign: 'top',
                width: 16,
              }}
            >
              <Text
                style={{
                  fontSize: 18,
                  lineHeight: '22px',
                  color: item.projectColor ?? email.dot,
                  margin: 0,
                }}
              >
                &bull;
              </Text>
            </Column>

            <Column style={{ backgroundColor: email.surface, padding: '7px 0', verticalAlign: 'top' }}>
              <Text
                style={{
                  fontSize: 15,
                  lineHeight: '22px',
                  color: email.text,
                  margin: 0,
                  fontWeight: item.priority >= 2 ? 600 : 400,
                }}
              >
                {item.title}
              </Text>
              {meta.length > 0 ? (
                <Text
                  style={{
                    fontSize: 12,
                    lineHeight: '17px',
                    color: email.textSoft,
                    margin: '1px 0 0',
                    fontFamily: fonts.body,
                  }}
                >
                  {meta.join(' · ')}
                </Text>
              ) : null}
            </Column>

            <Column
              align="right"
              style={{
                backgroundColor: email.surface,
                padding: '7px 0',
                verticalAlign: 'top',
                // Wide enough for the longest label this can produce, which is a
                // relative day plus a time: "2 days ago, 5:00 pm". At 120 that
                // wrapped and left "pm" alone on the next line, under a number
                // it no longer belonged to.
                width: 140,
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  lineHeight: '22px',
                  color: late ? email.action : email.textSoft,
                  margin: 0,
                  // Belt and braces with the width above. A client that ignores
                  // the column width still keeps the time on one line.
                  whiteSpace: 'nowrap',
                }}
              >
                {label(item, localDate, showDay)}
              </Text>
            </Column>
          </Row>
        );
      })}
    </Section>
  );
}

function label(item: DigestItem, localDate: string, showDay: boolean): string {
  if (!item.dueDate) return item.planned ? 'planned' : '';
  const day = formatRelativeDay(item.dueDate, localDate);
  if (!item.dueTime) return showDay ? day : day === 'today' ? '' : day;
  return showDay || day !== 'today' ? `${day}, ${formatTime(item.dueTime)}` : formatTime(item.dueTime);
}

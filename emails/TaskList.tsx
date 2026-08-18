import { Column, Row, Section, Text } from '@react-email/components';
import type { DigestItem } from '@/lib/email/types';
import { formatRelativeDay, formatTime } from '@/lib/email/format';
import { email, fonts } from './theme';

/**
 * A list of tasks as a table, one row each.
 *
 * Two columns rather than one line of text, so a long title wraps under itself
 * instead of pushing the time off the right edge. The time column is fixed and
 * right aligned because that is the part people scan.
 */
export function TaskList({
  items,
  localDate,
  showDay = false,
}: {
  items: DigestItem[];
  localDate: string;
  showDay?: boolean;
}) {
  return (
    <Section style={{ backgroundColor: email.surface }}>
      {items.map((item) => (
        <Row key={item.id} style={{ backgroundColor: email.surface }}>
          <Column style={{ padding: '6px 0', verticalAlign: 'top' }}>
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
            {item.project ? (
              <Text
                style={{
                  fontSize: 12,
                  lineHeight: '16px',
                  color: email.textSoft,
                  margin: '2px 0 0',
                  fontFamily: fonts.body,
                }}
              >
                {item.project}
              </Text>
            ) : null}
          </Column>
          <Column
            align="right"
            style={{ padding: '6px 0', verticalAlign: 'top', width: 130 }}
          >
            <Text style={{ fontSize: 13, lineHeight: '22px', color: email.textSoft, margin: 0 }}>
              {label(item, localDate, showDay)}
            </Text>
          </Column>
        </Row>
      ))}
    </Section>
  );
}

function label(item: DigestItem, localDate: string, showDay: boolean): string {
  if (!item.dueDate) return item.planned ? 'planned' : '';
  const day = formatRelativeDay(item.dueDate, localDate);
  if (!item.dueTime) return showDay ? day : day === 'today' ? '' : day;
  return showDay || day !== 'today' ? `${day}, ${formatTime(item.dueTime)}` : formatTime(item.dueTime);
}

import { Column, Row, Section, Text } from '@react-email/components';
import type { TaskReminderPayload } from '@/lib/email/types';
import { formatWhen, taskMeta } from '@/lib/email/format';
import { Action, Eyebrow, Shell } from './Shell';
import { email, fonts } from './theme';

/**
 * One or more task reminders that came due together.
 *
 * Coalesced by the route rather than the schedule, because three tasks due at
 * 09:00 are one thing to deal with, and three emails about them is the fastest
 * way to teach somebody to filter this address.
 *
 * A single task gets its notes; several get their small print and nothing else,
 * because the point of the coalesced version is the list.
 */
export interface ReminderEmailProps {
  tasks: TaskReminderPayload['task'][];
  appUrl: string;
  unsubscribeUrl: string;
}

export function ReminderEmail({ tasks, appUrl, unsubscribeUrl }: ReminderEmailProps) {
  const single = tasks.length === 1;

  return (
    <Shell
      preview={reminderPreview(tasks)}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      reason="You get this because a task you set a time on has come due."
    >
      <Section style={{ backgroundColor: email.surface }}>
        <Eyebrow>{single ? 'Due now' : `${tasks.length} due now`}</Eyebrow>

        {tasks.map((task) => {
          const meta = taskMeta({ ...task, project: null });

          return (
            <Section key={task.id} style={{ backgroundColor: email.surface, paddingTop: 10 }}>
              <Row style={{ backgroundColor: email.surface }}>
                <Column
                  style={{
                    backgroundColor: email.surface,
                    verticalAlign: 'top',
                    width: 18,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 20,
                      lineHeight: '28px',
                      color: task.projectColor ?? email.dot,
                      margin: 0,
                    }}
                  >
                    &bull;
                  </Text>
                </Column>
                <Column style={{ backgroundColor: email.surface, verticalAlign: 'top' }}>
                  <Text
                    style={{
                      fontFamily: fonts.serif,
                      fontSize: 21,
                      lineHeight: '28px',
                      color: email.heading,
                      margin: 0,
                    }}
                  >
                    {task.title}
                  </Text>
                  <Text
                    style={{ fontSize: 14, lineHeight: '20px', color: email.textSoft, margin: '3px 0 0' }}
                  >
                    {[formatWhen(task.dueDate, task.dueTime), task.project]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  {meta.length > 0 ? (
                    <Text
                      style={{ fontSize: 12, lineHeight: '17px', color: email.textSoft, margin: '3px 0 0' }}
                    >
                      {meta.join(' · ')}
                    </Text>
                  ) : null}
                </Column>
              </Row>

              {single && task.notes ? (
                <Section
                  style={{
                    backgroundColor: email.tint,
                    borderRadius: 4,
                    marginTop: 14,
                    padding: '12px 14px',
                  }}
                >
                  <Text style={{ fontSize: 14, lineHeight: '21px', color: email.text, margin: 0 }}>
                    {task.notes}
                  </Text>
                </Section>
              ) : null}
            </Section>
          );
        })}
      </Section>

      <Action href={appUrl}>Open in Tend</Action>
    </Shell>
  );
}

export function reminderPreview(tasks: TaskReminderPayload['task'][]): string {
  const first = tasks[0];
  if (!first) return 'A task is due.';
  if (tasks.length === 1) return `${first.title} is due.`;
  return `${first.title} and ${tasks.length - 1} more are due.`;
}

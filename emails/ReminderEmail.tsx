import { Section, Text } from '@react-email/components';
import type { TaskReminderPayload } from '@/lib/email/types';
import { formatWhen } from '@/lib/email/format';
import { Action, Shell } from './Shell';
import { email } from './theme';

/**
 * One or more task reminders that came due together.
 *
 * Coalesced by the route rather than the schedule, because three tasks due at
 * 09:00 are one thing to deal with, and three emails about them is the fastest
 * way to teach somebody to filter this address.
 */
export interface ReminderEmailProps {
  tasks: TaskReminderPayload['task'][];
  appUrl: string;
  unsubscribeUrl: string;
}

export function ReminderEmail({ tasks, appUrl, unsubscribeUrl }: ReminderEmailProps) {
  const single = tasks.length === 1 ? tasks[0]! : null;

  return (
    <Shell
      preview={reminderPreview(tasks)}
      appUrl={appUrl}
      unsubscribeUrl={unsubscribeUrl}
      reason="You get this because a task you set a time on has come due."
    >
      <Section style={{ backgroundColor: email.surface }}>
        <Text style={{ fontSize: 13, lineHeight: '18px', color: email.textSoft, margin: '20px 0 0' }}>
          {tasks.length === 1 ? 'Due now' : `${tasks.length} due now`}
        </Text>

        {tasks.map((task) => (
          <Section key={task.id} style={{ backgroundColor: email.surface, paddingTop: 8 }}>
            <Text
              style={{
                fontSize: 20,
                lineHeight: '28px',
                color: email.heading,
                margin: 0,
                fontWeight: 600,
              }}
            >
              {task.title}
            </Text>
            <Text style={{ fontSize: 14, lineHeight: '20px', color: email.textSoft, margin: '2px 0 0' }}>
              {[formatWhen(task.dueDate, task.dueTime), task.project].filter(Boolean).join(' · ')}
            </Text>
            {single && task.notes ? (
              <Text style={{ fontSize: 14, lineHeight: '21px', color: email.text, margin: '10px 0 0' }}>
                {task.notes}
              </Text>
            ) : null}
          </Section>
        ))}
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

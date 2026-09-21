'use client';

import { Plus, X } from '@phosphor-icons/react/dist/ssr';
import type { CourseMeeting } from '@/lib/db/types';
import { cn } from '@/lib/utils';
import { controlClass } from '@/components/ui/Field';

/**
 * When a course meets.
 *
 * Rows rather than a week grid. A grid is the right way to *read* a timetable
 * and the wrong way to enter one: two or three meetings is the whole answer, and
 * a grid asks you to aim at a cell to say Tuesday.
 *
 * Wall clock, like every other time on a row, so a class at 09:30 is at 09:30
 * wherever the laptop happens to be.
 */

const DAYS: { value: number; label: string }[] = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

export function MeetingRows({
  meetings,
  onChange,
}: {
  meetings: CourseMeeting[];
  onChange: (next: CourseMeeting[]) => void;
}) {
  function patch(index: number, change: Partial<CourseMeeting>) {
    onChange(meetings.map((meeting, i) => (i === index ? { ...meeting, ...change } : meeting)));
  }

  return (
    <div className="space-y-2">
      {meetings.map((meeting, index) => (
        // Index as the key: these rows have no id, and reordering is not
        // offered, so position is a stable identity here.
        <div key={index} className="flex items-center gap-1.5">
          <select
            value={meeting.byday}
            onChange={(event) => patch(index, { byday: Number(event.target.value) })}
            aria-label="Day"
            className={cn(controlClass, 'w-[5.5rem] shrink-0')}
          >
            {DAYS.map((day) => (
              <option key={day.value} value={day.value}>
                {day.label}
              </option>
            ))}
          </select>

          <input
            type="time"
            value={meeting.start}
            onChange={(event) => patch(index, { start: event.target.value })}
            aria-label="Starts"
            className={cn(controlClass, 'tnum min-w-0 flex-1')}
          />
          <input
            type="time"
            value={meeting.end}
            onChange={(event) => patch(index, { end: event.target.value })}
            aria-label="Ends"
            className={cn(controlClass, 'tnum min-w-0 flex-1')}
          />

          <button
            type="button"
            onClick={() => onChange(meetings.filter((_, i) => i !== index))}
            aria-label={`Remove the ${DAYS.find((d) => d.value === meeting.byday)?.label} meeting`}
            className={cn(
              'grid size-8 shrink-0 place-items-center rounded-md text-text-faint',
              'hover:bg-raised hover:text-clay-300',
            )}
          >
            <X size={13} aria-hidden />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() =>
          onChange([...meetings, { byday: 2, start: '09:30', end: '10:45', location: '' }])
        }
        className={cn(
          'label flex items-center gap-1.5 rounded-md px-1 py-1',
          '!text-[0.625rem] hover:text-text-mid',
        )}
      >
        <Plus size={12} weight="bold" aria-hidden />
        Add a meeting
      </button>
    </div>
  );
}

/** "Tue 09:30" for one meeting, which is all a card has room for. */
export function meetingLabel(meeting: CourseMeeting): string {
  const day = DAYS.find((each) => each.value === meeting.byday)?.label ?? '';
  return `${day} ${meeting.start}`;
}

/** The ISO weekday names, for anything rendering a timetable. */
export { DAYS as MEETING_DAYS };

'use client';

import { useEffect, useMemo, useState } from 'react';
import { Pause, Play, Stop, Timer } from '@phosphor-icons/react/dist/ssr';
import { FocusRing } from '@/components/focus/FocusRing';
import { EmptyState } from '@/components/views/EmptyState';
import { Segmented } from '@/components/ui/Segmented';
import { ViewHeader } from '@/components/views/ViewHeader';
import { useFocusBetween, useTodayList } from '@/hooks/use-tasks';
import { useFocusTimer } from '@/hooks/use-focus';
import { updateFocusSession } from '@/lib/db/mutations';
import { focusSeconds, unfinishedFocus } from '@/lib/db/queries';
import { getDb } from '@/lib/db/client';
import {
  elapsedMs,
  formatDuration,
  formatMinutes,
  progress,
  remainingMs,
} from '@/lib/focus/timer';
import { cn } from '@/lib/utils';

/**
 * One session at a time, with what it measured.
 *
 * The length is a choice rather than a doctrine: 25 minutes is the famous one,
 * 15 is what a small job needs, 50 is what deep work needs. Picking a task is
 * optional, because most sessions start before anybody has decided which thing
 * they are about.
 */

const LENGTHS = [15, 25, 50];

/** Local midnight, as the instant the log window starts at. */
function startOfToday(): string {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

const FAR_FUTURE = '9999-12-31T23:59:59.999Z';

export default function FocusPage() {
  const { clock, now, running, done, start, pause, resume, stop } = useFocusTimer();
  const tasks = useTodayList();
  // Memoized, or the window moves every render and the live query never settles.
  const window = useMemo(() => ({ from: startOfToday(), to: FAR_FUTURE }), []);
  const sessions = useFocusBetween(window.from, window.to);

  const [minutes, setMinutes] = useState(25);
  const [taskId, setTaskId] = useState('');

  // A tab killed mid-session leaves a row that says it is still running. Nothing
  // else ever closes it, and an open session poisons every total that counts it.
  useEffect(() => {
    void (async () => {
      const stale = await unfinishedFocus(window.from, getDb());
      for (const session of stale) {
        if (session.id === clock?.sessionId) continue;
        await updateFocusSession(session.id, {
          endedAt: new Date(
            new Date(session.startedAt).getTime() + session.focusedSeconds * 1000,
          ).toISOString(),
        });
      }
    })();
  }, [window.from, clock?.sessionId]);

  const logged = focusSeconds(sessions.filter((s) => s.endedAt !== null));
  const finishedCount = sessions.filter((s) => s.endedAt !== null).length;
  const titleOf = (id: string) => tasks.find((task) => task.id === id)?.title ?? '';

  const eyebrow =
    finishedCount === 0
      ? 'NOTHING LOGGED TODAY'
      : `${finishedCount} ${finishedCount === 1 ? 'SESSION' : 'SESSIONS'}, ${formatMinutes(logged).toUpperCase()} TODAY`;

  // The tab title is the only place a backgrounded timer can still be read.
  useEffect(() => {
    if (!clock) return;
    const original = document.title;
    document.title = `${formatDuration(remainingMs(clock, now))} focus`;
    return () => {
      document.title = original;
    };
  }, [clock, now]);

  return (
    <>
      <ViewHeader title="Focus" eyebrow={eyebrow} />

      <div className="flex flex-col items-center gap-6 rounded-lg border border-line bg-surface px-4 py-8">
        {clock ? (
          <>
            <FocusRing
              ratio={progress(clock, now)}
              time={
                done
                  ? formatDuration(elapsedMs(clock, now))
                  : formatDuration(remainingMs(clock, now))
              }
              caption={done ? 'time is up' : running ? 'focusing' : 'paused'}
              paused={!running && !done}
            />

            {clock.taskId !== '' && (
              <p className="max-w-[28ch] text-center text-sm text-text-mid">
                {titleOf(clock.taskId) || 'On a task from another list'}
              </p>
            )}

            <div className="flex items-center gap-2">
              {!done &&
                (running ? (
                  <button
                    type="button"
                    onClick={() => void pause()}
                    className="flex items-center gap-2 rounded-md border border-line bg-raised px-4 py-2 text-sm text-text-hi"
                  >
                    <Pause size={16} weight="fill" aria-hidden />
                    Pause
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={resume}
                    className="flex items-center gap-2 rounded-md bg-clay-600 px-4 py-2 text-sm text-text-hi"
                  >
                    <Play size={16} weight="fill" aria-hidden />
                    Resume
                  </button>
                ))}

              <button
                type="button"
                onClick={() => void stop()}
                className={cn(
                  'flex items-center gap-2 rounded-md px-4 py-2 text-sm',
                  done
                    ? 'bg-clay-600 text-text-hi'
                    : 'border border-line bg-raised text-text-mid',
                )}
              >
                <Stop size={16} weight="fill" aria-hidden />
                {done ? 'Log it' : 'Stop'}
              </button>
            </div>
          </>
        ) : (
          <>
            <FocusRing ratio={0} time={formatDuration(minutes * 60_000)} caption="ready" />

            <div className="w-full max-w-[19rem]">
              <Segmented
                id="focus-length"
                label="Session length"
                value={minutes}
                onChange={setMinutes}
                options={LENGTHS.map((length) => ({ value: length, label: `${length} min` }))}
              />
            </div>

            <label className="w-full max-w-[19rem] text-sm">
              <span className="label mb-1.5 block">Working on</span>
              <select
                value={taskId}
                onChange={(event) => setTaskId(event.target.value)}
                className="w-full rounded-md border border-line bg-sunken px-2.5 py-2 text-sm text-text-mid"
                style={{ boxShadow: 'var(--shadow-sunken)' }}
              >
                <option value="">Nothing in particular</option>
                {tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={() => void start({ taskId: taskId || undefined, plannedMinutes: minutes })}
              className="flex items-center gap-2 rounded-md bg-clay-600 px-5 py-2.5 text-sm text-text-hi"
            >
              <Play size={16} weight="fill" aria-hidden />
              Start
            </button>
          </>
        )}
      </div>

      <section className="mt-7">
        <h2 className="label mb-3">Today</h2>
        {finishedCount === 0 ? (
          <EmptyState
            icon={Timer}
            title="No sessions yet today"
            hint="Start one above. A session is logged even if you stop it early."
          />
        ) : (
          <ul className="space-y-2">
            {sessions
              .filter((session) => session.endedAt !== null)
              .reverse()
              .map((session) => (
                <li
                  key={session.id}
                  className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3.5 py-2.5"
                  style={{ boxShadow: 'var(--shadow-flush)' }}
                >
                  <span className="tnum text-sm text-olive-300">
                    {formatMinutes(session.focusedSeconds)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-text-mid">
                    {titleOf(session.taskId) || 'No task'}
                  </span>
                  <span className="tnum text-xs text-text-lo" suppressHydrationWarning>
                    {new Date(session.startedAt).toLocaleTimeString(undefined, {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </section>
    </>
  );
}

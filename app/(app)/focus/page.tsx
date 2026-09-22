'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Pause, Play, Stop, Timer } from '@phosphor-icons/react/dist/ssr';
import { FocusRing } from '@/components/focus/FocusRing';
import { EmptyState } from '@/components/views/EmptyState';
import { Segmented } from '@/components/ui/Segmented';
import { ViewHeader } from '@/components/views/ViewHeader';
import { useFocusBetween, useTasksByIds, useTodayList } from '@/hooks/use-tasks';
import { useFocusTimer } from '@/hooks/use-focus';
import { updateFocusSession } from '@/lib/db/mutations';
import { focusSeconds, unfinishedFocus } from '@/lib/db/queries';
import { getDb } from '@/lib/db/client';
import {
  formatDuration,
  formatMinutes,
  plannedMs,
  progress,
  remainingMs,
} from '@/lib/focus/timer';
import { cn } from '@/lib/utils';
import { useHydrated } from '@/hooks/use-hydrated';

/**
 * One session at a time, with what it measured.
 *
 * The length is a choice rather than a doctrine: 25 minutes is the famous one,
 * 15 is what a small job needs, 50 is what deep work needs. Picking a task is
 * optional, because most sessions start before anybody has decided which thing
 * they are about.
 */

const LENGTHS = [15, 25, 50];

/** How far back the sweep for sessions still marked running looks. A session
 *  left open overnight is the case that needs it, so today is not far enough. */
const STALE_LOOKBACK_DAYS = 7;

/** Local midnight, as the instant the log window starts at. */
function startOfToday(): string {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

const FAR_FUTURE = '9999-12-31T23:59:59.999Z';

export default function FocusPage() {
  // Remounts the dates below once hydration ends. `suppressHydrationWarning`
  // leaves the server's text in the DOM and records the client's in the
  // fiber, so a re-render finds no diff and the wrong date stays. A changed
  // key is what actually writes it. See the hook.
  const hydrated = useHydrated();
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
    const since = new Date(Date.now() - STALE_LOOKBACK_DAYS * 86_400_000).toISOString();
    void (async () => {
      const stale = await unfinishedFocus(since, getDb());
      for (const session of stale) {
        if (session.id === clock?.sessionId) continue;
        await updateFocusSession(session.id, {
          endedAt: new Date(
            new Date(session.startedAt).getTime() + session.focusedSeconds * 1000,
          ).toISOString(),
        });
      }
    })();
  }, [clock?.sessionId]);

  const logged = focusSeconds(sessions.filter((s) => s.endedAt !== null));
  const finishedCount = sessions.filter((s) => s.endedAt !== null).length;

  // Sessions point at tasks from any list, so the titles are read by id. Looking
  // them up in today's list reported "no task" for anything worked on that was
  // not also due today, which is most of what a focus session is for.
  const referenced = useMemo(
    () => [...sessions.map((session) => session.taskId), clock?.taskId ?? ''],
    [sessions, clock?.taskId],
  );
  const named = useTasksByIds(referenced);
  const titleOf = (id: string) => named.find((task) => task.id === id)?.title ?? '';
  /** A session outlives the row it was about, so both blanks are possible and
   *  they mean different things. */
  const labelFor = (id: string) =>
    id === '' ? 'No task' : (titleOf(id) || 'Not on this device');

  const eyebrow =
    finishedCount === 0
      ? 'NOTHING LOGGED TODAY'
      : `${finishedCount} ${finishedCount === 1 ? 'SESSION' : 'SESSIONS'}, ${formatMinutes(logged).toUpperCase()} TODAY`;

  // A session ending changed a ring, a caption and a button label, and nothing
  // else. Somebody scrolled down the page, or looking at another one, had no way
  // to find out. The caption carries role="status" for a screen reader; this is
  // the part a person sees.
  useEffect(() => {
    if (!done) return;
    toast('Time is up', { description: 'Log it to keep what the session measured.' });
  }, [done]);

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
              // Frozen at the length once it is up, rather than counting into
              // overtime nothing is measuring and nothing will record.
              time={formatDuration(done ? plannedMs(clock) : remainingMs(clock, now))}
              caption={done ? 'time is up' : running ? 'focusing' : 'paused'}
              paused={!running && !done}
            />

            {clock.taskId !== '' && titleOf(clock.taskId) !== '' && (
              <p className="max-w-[28ch] text-center text-sm text-text-mid">
                {titleOf(clock.taskId)}
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
                    className="flex items-center gap-2 rounded-md bg-clay-600 px-4 py-2 text-sm text-on-accent"
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
                    ? 'bg-clay-600 text-on-accent'
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
              className="flex items-center gap-2 rounded-md bg-clay-600 px-5 py-2.5 text-sm text-on-accent"
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
                    {labelFor(session.taskId)}
                  </span>
                  <span className="tnum text-xs text-text-lo" key={`started-${hydrated}`} suppressHydrationWarning>
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

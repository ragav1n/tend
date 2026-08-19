'use client';

import { useId } from 'react';
import { Bell, EnvelopeSimple, Globe, MoonStars } from '@phosphor-icons/react/dist/ssr';
import { Segmented } from '@/components/ui/Segmented';
import { Toggle } from '@/components/ui/Toggle';
import { controlClass } from '@/components/ui/Field';
import { ViewHeader } from '@/components/views/ViewHeader';
import { usePrefs } from '@/hooks/use-prefs';
import { updatePrefs } from '@/lib/db/mutations';
import { deviceTimezone, fromTimeInput, toTimeInput } from '@/lib/db/prefs';
import type { PrefsPatch } from '@/lib/db/mutations';
import { cn } from '@/lib/utils';

/**
 * Settings, which are one synced row.
 *
 * Every change is written through `updatePrefs`, so it lands in IndexedDB and the
 * outbox in one transaction and the page works offline like everything else. There
 * is no save button: a settings form with one is a form that loses your change
 * when you navigate away.
 *
 * Reminder times are wall clock in the timezone below. Postgres does the
 * conversion when it schedules, which is why this page never mentions an offset.
 */
export default function SettingsPage() {
  const prefs = usePrefs();
  const email = prefs.emailEnabled;

  const set = (patch: PrefsPatch) => {
    void updatePrefs(patch);
  };

  return (
    <>
      <ViewHeader title="Settings" eyebrow="EMAIL AND TIME" />

      <Group title="Email" icon={EnvelopeSimple}>
        <Row
          label="Send me email"
          hint="The master switch. Off means nothing is sent, whatever else is on here."
        >
          {(id) => (
            <Toggle
              id={id}
              label="Send me email"
              checked={email}
              onChange={(next) => set({ emailEnabled: next })}
            />
          )}
        </Row>

        <Row
          label="Morning digest"
          hint="One email with today, what is late, and what is coming."
          disabled={!email}
        >
          {(id) => (
            <div className="flex items-center gap-2">
              <TimeInput
                value={prefs.digestTime}
                disabled={!email || !prefs.digestEnabled}
                label="Digest time"
                onChange={(value) => set({ digestTime: value })}
              />
              <Toggle
                id={id}
                label="Morning digest"
                checked={prefs.digestEnabled}
                onChange={(next) => set({ digestEnabled: next })}
              />
            </div>
          )}
        </Row>

        <Row
          label="Task reminders"
          hint="For a task with a time on it. Several due together arrive as one email."
          disabled={!email}
        >
          {(id) => (
            <div className="flex items-center gap-2">
              <select
                aria-label="Reminder lead time"
                className={cn(controlClass, 'w-auto')}
                value={prefs.reminderLeadMinutes}
                disabled={!email || !prefs.remindersEnabled}
                onChange={(event) => set({ reminderLeadMinutes: Number(event.target.value) })}
              >
                {LEADS.map((lead) => (
                  <option key={lead.value} value={lead.value}>
                    {lead.label}
                  </option>
                ))}
              </select>
              <Toggle
                id={id}
                label="Task reminders"
                checked={prefs.remindersEnabled}
                onChange={(next) => set({ remindersEnabled: next })}
              />
            </div>
          )}
        </Row>

        <Row
          label="Overdue nudge"
          hint="Once a day, and only when something is actually late."
          disabled={!email}
        >
          {(id) => (
            <div className="flex items-center gap-2">
              <TimeInput
                value={prefs.nudgeTime}
                disabled={!email || !prefs.nudgeEnabled}
                label="Nudge time"
                onChange={(value) => set({ nudgeTime: value })}
              />
              <Toggle
                id={id}
                label="Overdue nudge"
                checked={prefs.nudgeEnabled}
                onChange={(next) => set({ nudgeEnabled: next })}
              />
            </div>
          )}
        </Row>

        <Row label="Weekly review" hint="What got done, and what carried over." disabled={!email}>
          {(id) => (
            <div className="flex items-center gap-2">
              <TimeInput
                value={prefs.weeklyReviewTime}
                disabled={!email || !prefs.weeklyReviewEnabled}
                label="Review time"
                onChange={(value) => set({ weeklyReviewTime: value })}
              />
              <Toggle
                id={id}
                label="Weekly review"
                checked={prefs.weeklyReviewEnabled}
                onChange={(next) => set({ weeklyReviewEnabled: next })}
              />
            </div>
          )}
        </Row>

        {prefs.weeklyReviewEnabled && email && (
          <Row label="Review day" hint="">
            {() => (
              <Segmented
                id="review-day"
                label="Weekly review day"
                value={prefs.weeklyReviewDay}
                options={DAYS}
                onChange={(value) => set({ weeklyReviewDay: value })}
              />
            )}
          </Row>
        )}
      </Group>

      <Group title="Quiet hours" icon={MoonStars}>
        <Row
          label="Hold reminders"
          hint="A reminder landing inside these hours waits until they end. Digests keep their own time."
          disabled={!email}
        >
          {(id) => (
            <Toggle
              id={id}
              label="Hold reminders during quiet hours"
              checked={prefs.quietHoursEnabled}
              onChange={(next) => set({ quietHoursEnabled: next })}
            />
          )}
        </Row>

        {prefs.quietHoursEnabled && (
          <Row label="From" hint="">
            {() => (
              <div className="flex items-center gap-2">
                <TimeInput
                  value={prefs.quietStart}
                  disabled={!email}
                  label="Quiet hours start"
                  onChange={(value) => set({ quietStart: value })}
                />
                <span className="text-xs text-text-lo">to</span>
                <TimeInput
                  value={prefs.quietEnd}
                  disabled={!email}
                  label="Quiet hours end"
                  onChange={(value) => set({ quietEnd: value })}
                />
              </div>
            )}
          </Row>
        )}

        <Row
          label="Daily limit"
          hint="A ceiling on reminder emails, so a runaway repeat cannot fill your inbox."
          disabled={!email}
        >
          {(id) => (
            <input
              id={id}
              type="number"
              min={0}
              max={50}
              inputMode="numeric"
              className={cn(controlClass, 'tnum w-20 text-right')}
              value={prefs.maxReminderEmailsPerDay}
              disabled={!email}
              onChange={(event) =>
                set({
                  maxReminderEmailsPerDay: clamp(Number(event.target.value), 0, 50),
                })
              }
            />
          )}
        </Row>
      </Group>

      <Group title="Time" icon={Globe}>
        <Row
          label="Timezone"
          hint={`Every reminder is scheduled against this. This device says ${deviceTimezone()}.`}
        >
          {(id) => (
            <select
              id={id}
              className={controlClass}
              value={prefs.timezone}
              onChange={(event) => set({ timezone: event.target.value })}
            >
              {zones(prefs.timezone).map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          )}
        </Row>

        <Row label="Week starts" hint="">
          {() => (
            <Segmented
              id="week-start"
              label="Week starts on"
              value={prefs.weekStart}
              options={[
                { value: 1, label: 'Mon' },
                { value: 7, label: 'Sun' },
              ]}
              onChange={(value) => set({ weekStart: value })}
            />
          )}
        </Row>

        <Row
          label="All-day tasks"
          hint="When a task has a date but no time, remind me at this hour."
        >
          {(id) => (
            <TimeInput
              id={id}
              value={prefs.allDayReminderTime}
              label="All-day reminder time"
              onChange={(value) => set({ allDayReminderTime: value })}
            />
          )}
        </Row>
      </Group>

      <p className="mt-8 flex items-start gap-2 text-xs leading-relaxed text-text-lo">
        <Bell size={14} className="mt-0.5 shrink-0" aria-hidden />
        Changes sync to your other devices. Every email also carries a link that turns
        that kind off without signing in.
      </p>
    </>
  );
}

const LEADS = [
  { value: 0, label: 'At the time' },
  { value: 5, label: '5 min before' },
  { value: 10, label: '10 min before' },
  { value: 15, label: '15 min before' },
  { value: 30, label: '30 min before' },
  { value: 60, label: '1 hour before' },
  { value: 120, label: '2 hours before' },
  { value: 1440, label: 'A day before' },
];

const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

function clamp(value: number, low: number, high: number): number {
  if (Number.isNaN(value)) return low;
  return Math.min(high, Math.max(low, Math.round(value)));
}

/**
 * The IANA list from the runtime rather than a bundled table, which would be one
 * more thing to update twice a year. The stored value is unioned in, so a zone
 * this browser has never heard of still shows rather than silently reading as
 * whatever sits first in the list.
 */
function zones(current: string): string[] {
  const supported =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  const all = new Set<string>(['UTC', current, ...supported]);
  return [...all].sort();
}

function Group({
  title,
  icon: IconComponent,
  children,
}: {
  title: string;
  icon: typeof Bell;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-7">
      <h2 className="label mb-2 flex items-center gap-1.5">
        <IconComponent size={13} aria-hidden />
        {title}
      </h2>
      <div
        className="rounded-lg border border-line bg-surface px-4 divide-y divide-line"
        style={{ boxShadow: 'var(--shadow-flush)' }}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * One setting. The control is a function of the generated id so the label points
 * at it, which is what makes the label a tap target on a phone.
 */
function Row({
  label,
  hint,
  disabled = false,
  children,
}: {
  label: string;
  hint: string;
  disabled?: boolean;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 py-3.5',
        disabled && 'opacity-45',
      )}
    >
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm text-text-hi">
          {label}
        </label>
        {hint && <p className="mt-0.5 text-xs leading-snug text-text-lo">{hint}</p>}
      </div>
      <div className="flex shrink-0 items-center">{children(id)}</div>
    </div>
  );
}

function TimeInput({
  id,
  value,
  label,
  disabled = false,
  onChange,
}: {
  id?: string;
  value: string;
  label: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <input
      id={id}
      type="time"
      aria-label={label}
      className={cn(controlClass, 'tnum w-[6.5rem]')}
      value={toTimeInput(value)}
      disabled={disabled}
      onChange={(event) => {
        if (!event.target.value) return;
        onChange(fromTimeInput(event.target.value));
      }}
    />
  );
}

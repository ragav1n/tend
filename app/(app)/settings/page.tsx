'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import {
  ArrowClockwise,
  Bell,
  DownloadSimple,
  EnvelopeSimple,
  Globe,
  GraduationCap,
  HardDrives,
  Hourglass,
  MoonStars,
  SignOut,
  Sparkle,
} from '@phosphor-icons/react/dist/ssr';
import { Segmented } from '@/components/ui/Segmented';
import { Toggle } from '@/components/ui/Toggle';
import { controlClass } from '@/components/ui/Field';
import { ViewHeader } from '@/components/views/ViewHeader';
import { FeedSettings } from '@/components/courses/FeedSettings';
import { ModelSettings } from '@/components/courses/ModelSettings';
import { CapacityRow } from '@/components/views/CapacityRow';
import { signOut, useAccountEmail } from '@/hooks/use-account';
import { useAppUpdate } from '@/hooks/use-app-update';
import { usePrefs } from '@/hooks/use-prefs';
import { toast } from 'sonner';
import { useInstall } from '@/hooks/use-install';
import { usePush } from '@/hooks/use-push';
import { formatBytes, useStorageState } from '@/hooks/use-storage';
import { useSyncState } from '@/hooks/use-sync';
import { useTheme } from '@/hooks/use-theme';
import { updatePrefs } from '@/lib/db/mutations';
import { deviceTimezone, fromTimeInput, toTimeInput } from '@/lib/db/prefs';
import { formatSince } from '@/lib/format/date';
import { buildIcs, saveFile } from '@/lib/ics/download';
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

      <Group title="Coursework" icon={GraduationCap}>
        <FeedSettings />
      </Group>

      <Group title="Local model" icon={Sparkle}>
        <ModelSettings />
      </Group>

      <Group title="Your week" icon={Hourglass}>
        <CapacityRow />
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

      <DeviceGroup />

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
 * This device, which is the only group here that is not a synced setting.
 *
 * Worth showing because the app's promise is that the data lives on the device.
 * "Kept on this device" is the answer to whether the browser may throw it away
 * under disk pressure, and nothing else in the app ever tells you. It is a
 * readout rather than a switch: the request can put a dialog on screen in
 * Firefox, and opening settings is not a reason to ask for anything.
 */
function DeviceGroup() {
  const { persisted, report } = useStorageState();
  const { pref, setPref } = useTheme();

  return (
    <Group title="This device" icon={HardDrives}>
      <AccountRow />

      {/* Theme sits here rather than under a synced group on purpose. A phone in
          a dark bedroom and a laptop under an office light are one person making
          two different choices, and a synced setting makes one of them wrong. */}
      <Row label="Theme" hint="Kept on this device, not synced with the account.">
        {(id) => (
          <Segmented
            id={id}
            label="Theme"
            value={pref}
            options={[
              { value: 'system', label: 'Auto' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            onChange={setPref}
          />
        )}
      </Row>

      <NotificationRow />

      <Row
        label="Kept on this device"
        hint={
          persisted === true
            ? 'The browser has promised not to clear it to make room.'
            : 'Granted once the app is installed, on every browser but Firefox.'
        }
      >
        {() => (
          <span className={cn('text-sm', persisted ? 'text-olive-300' : 'text-text-lo')}>
            {persisted === null ? 'Unknown' : persisted ? 'Yes' : 'Not yet'}
          </span>
        )}
      </Row>

      <Row label="Space used" hint="Your tasks, plus the app itself for offline use.">
        {() => (
          <span className="tnum text-sm text-text-mid">
            {report ? formatBytes(report.usage) : '—'}
          </span>
        )}
      </Row>

      <Row
        label="Export to a calendar"
        hint="Everything with a date, as an .ics file any calendar can read."
      >
        {() => <ExportButton />}
      </Row>

      <VersionRow />
    </Group>
  );
}

/**
 * Which version this is, and whether it is the deployed one.
 *
 * The app is installed, so it does not reload the way a website does. Without
 * this the only signal a new version exists is a toast that shows once and can
 * be dismissed by accident, and then there is nothing anywhere that says which
 * version you are on or offers to move you.
 *
 * The button is the same one the toast fires. `lib/pwa/updates.ts` waits for the
 * new worker to take over before reloading, which is what makes it an update
 * rather than a refresh onto the same files.
 */
/**
 * "just now" mid-sentence, and every other answer as it comes.
 *
 * Lowercasing the lot would turn "20 Aug" into "20 aug", and "Just now" is the
 * only answer `formatSince` gives that starts a sentence rather than sitting in
 * one.
 */
function since(at: number): string {
  const label = formatSince(new Date(at).toISOString());
  return label === 'Just now' ? 'just now' : label;
}

function VersionRow() {
  const { status, version, latest, checkedAt, offline, check, apply } = useAppUpdate();

  const newer = status === 'available' || status === 'failed';
  const busy = status === 'checking' || status === 'applying';
  // A waiting worker raises this without `latest` being re-read, so it can hold
  // the version already on screen in the label above. "0.34.0 is out" under
  // "Version 0.34.0" is worse than not naming it.
  const named = latest !== null && latest !== version ? latest : null;

  const hint = newer
    ? status === 'failed'
      ? 'The last try came back on the same version. This one clears the cached app files first.'
      : `${named ? `Version ${named}` : 'A newer version'} is out. Updating reloads the app and loses nothing.`
    : offline
      ? 'Could not reach the server, so this is the last answer it gave.'
      : checkedAt === null
        ? 'Checked against the deployment, not against the cache.'
        : `Checked ${since(checkedAt)}.`;

  return (
    <Row label={`Version ${version === '' ? '—' : version}`} hint={hint}>
      {() => (
        <div className="flex items-center gap-2">
          {!newer && !busy && (
            <span className={cn('text-sm', offline ? 'text-text-lo' : 'text-olive-300')}>
              {status === 'unknown' ? '—' : offline ? 'Offline' : 'Up to date'}
            </span>
          )}
          <button
            type="button"
            onClick={newer ? apply : check}
            disabled={busy}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm',
              'disabled:opacity-40',
              newer
                ? 'border-clay-400 bg-clay-600 text-on-accent hover:bg-clay-500'
                : 'border-line text-text-mid hover:border-clay-400 hover:bg-raised',
            )}
          >
            <ArrowClockwise size={16} aria-hidden />
            {status === 'applying'
              ? 'Updating'
              : status === 'checking'
                ? 'Checking'
                : status === 'failed'
                  ? 'Try again'
                  : newer
                    ? 'Update'
                    : 'Check'}
          </button>
        </div>
      )}
    </Row>
  );
}

/**
 * The .ics download.
 *
 * Built and handed over in the browser rather than through a route, because a
 * route needs the network and this app does not. Undated tasks are left out:
 * a calendar has nowhere to put them.
 */
function ExportButton() {
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const { body, filename } = await buildIcs();
      const events = (body.match(/BEGIN:VEVENT/g) ?? []).length;
      if (events === 0) {
        toast('Nothing to export', { description: 'No task has a date yet.' });
        return;
      }
      saveFile(body, filename);
      toast(`Exported ${events} ${events === 1 ? 'task' : 'tasks'}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={busy}
      className={cn(
        'flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5',
        'text-sm text-text-mid hover:border-clay-400 hover:bg-raised disabled:opacity-40',
      )}
    >
      <DownloadSimple size={16} aria-hidden />
      {busy ? 'Working' : 'Download'}
    </button>
  );
}

/**
 * Notifications, which are a per-device permission rather than a synced setting.
 *
 * Five states and only one of them is a switch, because none of the others can be
 * fixed from here and pretending otherwise gives a control that does nothing.
 *
 * `unsupported` on an iPhone means the app is not on the home screen, and that is
 * the one case where the hint is an instruction: iOS gives a Safari tab no
 * PushManager at all, so installing is the entire fix. `blocked` can only be
 * undone in browser settings, so it says so instead of asking again. Signed out
 * has to be its own state as well: a subscription is a row on the server keyed to
 * an account, so with no session the browser would subscribe, the POST would come
 * back 401, and the switch would flick itself off with nothing said.
 */
/**
 * The account this device is signed in to, and the way out.
 *
 * Until this existed there was none: `grep signOut` answered with nothing, so an
 * account was something you could join and never leave. It sits in the device
 * group because a session is per device, which is also what `scope: 'local'` in
 * `signOut` is about.
 *
 * Push goes off first. A subscription is stored server-side against the user, so
 * leaving it behind means this device keeps receiving reminders for an account
 * it is no longer signed in to. Best effort on purpose: a failed unsubscribe is
 * not a reason to trap somebody in a session, and the send path already drops a
 * subscription after `MAX_FAILURES`.
 */
function AccountRow() {
  const email = useAccountEmail();
  const { subscribed, disable } = usePush();
  const [busy, setBusy] = useState(false);

  async function leave() {
    setBusy(true);
    try {
      if (subscribed) {
        try {
          await disable();
        } catch {
          // Reported by the toast below rather than here, since the session is
          // the thing being asked for.
        }
      }
      await signOut();
      toast('Signed out', { description: 'Your tasks stay on this device.' });
    } catch {
      toast('Could not sign out', { description: 'Try again in a moment.' });
    } finally {
      setBusy(false);
    }
  }

  if (email === null) {
    return (
      <Row
        label="Account"
        hint="Tend works signed out. An account is what syncs it to your other devices."
      >
        {() => (
          <Link href="/signin" className={cn(controlClass, 'inline-flex px-3 text-sm')}>
            Sign in
          </Link>
        )}
      </Row>
    );
  }

  return (
    <Row label="Account" hint={`Signed in as ${email}. Your tasks stay here either way.`}>
      {() => (
        <button
          type="button"
          onClick={() => void leave()}
          disabled={busy}
          className={cn(controlClass, 'inline-flex items-center gap-1.5 px-3 text-sm')}
        >
          <SignOut size={13} aria-hidden />
          {busy ? 'Signing out' : 'Sign out'}
        </button>
      )}
    </Row>
  );
}

function NotificationRow() {
  const { ready, availability, subscribed, busy, enable, disable } = usePush();
  const { method } = useInstall();
  const { session } = useSyncState();
  const id = useId();

  const state = !session ? 'signed-out' : availability;

  const hint =
    state === 'signed-out'
      ? 'Sign in first. A notification is sent from the server, so it needs an account to send to.'
      : state === 'blocked'
        ? 'Refused for this site. Your browser settings are the only way back.'
        : state === 'unconfigured'
          ? 'This deployment has no push keys set, so there is nothing to turn on.'
          : state === 'no-worker'
            ? 'The app has not registered its service worker here, so nothing could arrive. A reload usually fixes it.'
            : state === 'unsupported'
              ? method === 'manual-ios'
                ? 'Add Tend to your home screen first. Safari gives a tab no way to receive one.'
                : 'This browser cannot receive notifications.'
              : 'A reminder on the lock screen of this device, alongside the email.';

  async function set(next: boolean) {
    if (!next) {
      await disable();
      return;
    }
    // A refusal at the permission dialog is an answer rather than a failure, and
    // the browser has already shown its own dialog, so only a real failure to
    // register is worth a toast.
    if (!(await enable()) && Notification.permission === 'granted') {
      toast('Could not turn notifications on', {
        description: 'The subscription did not reach the server. Worth trying again.',
      });
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm text-text-hi">
          Notifications
        </label>
        <p className="mt-0.5 text-xs leading-snug text-text-lo">{hint}</p>
      </div>
      <div className="flex shrink-0 items-center">
        {ready && state === 'ready' ? (
          <Toggle
            id={id}
            label="Notifications on this device"
            checked={subscribed}
            disabled={busy}
            onChange={(next) => void set(next)}
          />
        ) : (
          <span className="text-sm text-text-lo">
            {!ready
              ? '—'
              : state === 'signed-out'
                ? 'Signed out'
                : state === 'blocked'
                  ? 'Blocked'
                  : 'Unavailable'}
          </span>
        )}
      </div>
    </div>
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

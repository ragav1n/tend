'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { ArrowsClockwise, Trash, WarningCircle } from '@phosphor-icons/react/dist/ssr';
import { createFeed, deleteFeed, updateFeed } from '@/lib/db/mutations';
import type { Feed } from '@/lib/db/types';
import { useFeeds } from '@/hooks/use-courses';
import { formatSince } from '@/lib/format/date';
import { cn } from '@/lib/utils';
import { controlClass } from '@/components/ui/Field';
import { Toggle } from '@/components/ui/Toggle';

/**
 * Subscribing to a Canvas calendar.
 *
 * One URL, found in Canvas under Calendar then Calendar Feed. No API token and
 * no OAuth, which is why this is the integration rather than something larger.
 *
 * The URL is credential-shaped: anybody holding it can read the whole calendar
 * it points at. So it is shown masked once saved, never logged, and never
 * returned by the import route. Editing it means pasting a new one.
 *
 * What the feed cannot give you is anything an instructor left in the syllabus
 * and out of Canvas, which is said here rather than left to be discovered.
 */

/** Enough to recognise which feed this is, not enough to use. */
function mask(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}/…`;
  } catch {
    return 'a saved link';
  }
}

interface ImportResult {
  feeds: number;
  inserted: number;
  updated: number;
  events: number;
  unmatched: number;
  failures?: { label: string; reason: string }[];
}

export function FeedSettings() {
  const feeds = useFeeds();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  async function add() {
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      toast('That does not look like a feed URL', {
        description: 'Copy it from Canvas under Calendar, then Calendar Feed.',
      });
      return;
    }
    await createFeed({ url: trimmed });
    setUrl('');
    // Imported straight away. Adding a feed and being told nothing happened is
    // how somebody concludes it does not work.
    await run();
  }

  async function run() {
    setBusy(true);
    try {
      const response = await fetch('/api/feeds/import', { method: 'POST' });
      if (!response.ok) {
        toast(
          response.status === 401
            ? 'Sign in first'
            : 'The import did not run',
          {
            description:
              response.status === 401
                ? 'A feed is read by the server, which needs to know whose account to write to.'
                : 'Worth another go in a moment.',
          },
        );
        return;
      }

      const result = (await response.json()) as ImportResult;
      const landed = result.inserted + result.updated + result.events;

      toast(
        result.inserted > 0
          ? `${result.inserted} new ${result.inserted === 1 ? 'deadline' : 'deadlines'}`
          : landed > 0
            ? 'Nothing new'
            : 'Nothing to import',
        {
          description: [
            result.updated > 0 ? `${result.updated} already here` : null,
            result.events > 0 ? `${result.events} class or exam times` : null,
            result.unmatched > 0
              ? `${result.unmatched} matched no course, so they are in the Inbox`
              : null,
            ...(result.failures ?? []).map((failure) => `${failure.label}: ${failure.reason}`),
          ]
            .filter(Boolean)
            .join(' · ') || undefined,
        },
      );
    } catch {
      toast('Could not reach the server', { description: 'The import needs a connection.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="divide-y divide-line">
      {feeds.map((feed) => (
        <FeedRow key={feed.id} feed={feed} />
      ))}

      <div className="py-3">
        <label htmlFor="feed-url" className="text-sm text-text-hi">
          {feeds.length === 0 ? 'Canvas calendar feed' : 'Add another feed'}
        </label>
        <p className="mt-0.5 text-xs text-text-lo">
          In Canvas, open Calendar and click Calendar Feed. Deadlines arrive as tasks, class and
          exam times sit behind your day. Anything an instructor left only in the syllabus is not
          in the feed.
        </p>

        <div className="mt-2 flex items-center gap-2">
          <input
            id="feed-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void add();
            }}
            placeholder="https://…instructure.com/feeds/calendars/…ics"
            autoComplete="off"
            spellCheck={false}
            className={cn(controlClass, 'min-w-0 flex-1')}
          />
          <button
            type="button"
            onClick={() => void add()}
            disabled={url.trim() === ''}
            className="shrink-0 rounded-md bg-clay-600 px-3 py-1.5 text-sm text-on-accent disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>

      {feeds.length > 0 && (
        <div className="flex items-center gap-3 py-3">
          <span className="text-sm text-text-hi">Import now</span>
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy}
            className={cn(
              controlClass,
              'ml-auto inline-flex w-auto shrink-0 items-center gap-1.5 px-3 text-sm',
            )}
          >
            <ArrowsClockwise size={13} aria-hidden className={busy ? 'animate-spin' : undefined} />
            {busy ? 'Reading' : 'Read the feeds'}
          </button>
        </div>
      )}
    </div>
  );
}

function FeedRow({ feed }: { feed: Feed }) {
  function remove() {
    // The tasks stay. They are real work with real deadlines, and arriving by
    // feed is not a reason to disturb them. Their feedUid stays too, so adding
    // the same URL back reconciles onto the same rows.
    void deleteFeed(feed.id).then(() =>
      toast('Feed removed', { description: 'The deadlines it imported are still here.' }),
    );
  }

  return (
    <div className="flex items-start gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-text-hi">{feed.label || mask(feed.url)}</p>
        <p className="mt-0.5 text-xs text-text-lo">
          {feed.lastError !== null ? (
            <span className="inline-flex items-center gap-1 text-clay-200">
              <WarningCircle size={12} weight="bold" aria-hidden />
              {feed.lastError}
            </span>
          ) : feed.lastFetchedAt === null ? (
            'Not read yet'
          ) : (
            <>
              Read {formatSince(feed.lastFetchedAt)}, <span className="tnum">{feed.lastCount}</span>{' '}
              {feed.lastCount === 1 ? 'item' : 'items'}
              {feed.lastUnmatched > 0 && (
                <>
                  , <span className="tnum">{feed.lastUnmatched}</span> in the Inbox
                </>
              )}
            </>
          )}
        </p>
        <p className="mt-0.5 text-xs text-text-faint">{mask(feed.url)}</p>
      </div>

      <Toggle
        checked={feed.enabled}
        onChange={(enabled) => void updateFeed(feed.id, { enabled })}
        label={`Read ${feed.label || 'this feed'}`}
      />

      <button
        type="button"
        onClick={remove}
        aria-label={`Remove ${feed.label || 'this feed'}`}
        className="grid size-8 shrink-0 place-items-center rounded-md text-text-faint hover:bg-raised hover:text-clay-300"
      >
        <Trash size={14} aria-hidden />
      </button>
    </div>
  );
}

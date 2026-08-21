'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Hash, PencilSimple, Trash } from '@phosphor-icons/react/dist/ssr';
import { deleteTag, renameTag, restoreTag } from '@/lib/db/mutations';
import type { Tag } from '@/lib/db/types';
import { cn } from '@/lib/utils';
import { useTagCounts, useTaggedWith, useTags } from '@/hooks/use-tasks';
import { EmptyState } from '@/components/views/EmptyState';
import { TaskList } from '@/components/views/TaskList';
import { ViewHeader } from '@/components/views/ViewHeader';

/**
 * Tags: the list of them, and one of them.
 *
 * A tag was write-only until this screen existed. Quick-add types `#work` into
 * a task, the row shows it, and there was nowhere to go from there: no list of
 * what carries a tag, no rename, no delete. The filter existed in the saved-view
 * builder, which is a place you have to already know about.
 *
 * The open tag lives in `?t=` rather than a `/tags/[id]` segment, for the reason
 * saved views do: a dynamic segment cannot be prerendered, and the service
 * worker precaches prerendered routes. A tag behind a dynamic route would be a
 * screen that needs the network to open.
 */

function TagIndex({ tags }: { tags: Tag[] }) {
  const counts = useTagCounts();

  return (
    <>
      <ViewHeader
        title="Tags"
        eyebrow="Labels"
        subtitle="Typed as #name in the quick-add field. Open one to see what carries it."
      />

      {tags.length === 0 ? (
        <EmptyState
          icon={Hash}
          title="No tags yet"
          hint="Type #errands at the end of a task and it becomes one."
        />
      ) : (
        <ul className="space-y-2">
          {tags.map((tag) => {
            const open = counts.get(tag.id) ?? 0;
            return (
              <li key={tag.id}>
                <Link
                  href={`/tags?t=${tag.id}`}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border border-line bg-surface',
                    'px-3.5 py-3 hover:border-line-bright',
                  )}
                  style={{ boxShadow: 'var(--shadow-flush)' }}
                >
                  <Hash size={17} className="shrink-0 text-clay-300" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-[0.9375rem] text-text-hi">
                    {tag.name}
                  </span>
                  <span className="tnum shrink-0 text-xs text-text-lo">
                    {open} open
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function OneTag({ tag }: { tag: Tag }) {
  const router = useRouter();
  const tasks = useTaggedWith(tag.id);
  const [name, setName] = useState<string | null>(null);

  /**
   * Commits a rename, or hands the words back.
   *
   * A refusal from Enter keeps the field open with what was typed still in it,
   * because the person is mid-edit and being told "taken" over a field that has
   * closed means typing it all again. A refusal from blur closes: reopening on
   * blur would take focus back off whatever was clicked, and the field would be
   * impossible to leave until the name was acceptable.
   */
  async function commitName(from: 'enter' | 'blur') {
    const wanted = name ?? '';
    if (from === 'blur') setName(null);

    const result = await renameTag(tag.id, wanted);
    if (result === 'ok' || result === 'empty') {
      setName(null);
      return;
    }

    toast('There is already a tag with that name', {
      description: 'Two tags with one name would be two names for one thing.',
    });
  }

  async function remove() {
    const touched = await deleteTag(tag.id);
    router.push('/tags');
    toast(
      touched.length === 0
        ? `#${tag.name} deleted`
        : `#${tag.name} deleted, off ${touched.length} ${touched.length === 1 ? 'task' : 'tasks'}`,
      { action: { label: 'Undo', onClick: () => void restoreTag(tag.id, touched) } },
    );
  }

  return (
    <>
      {name === null ? (
        <ViewHeader title={tag.name} eyebrow="Tag" />
      ) : (
        <div className="mb-5">
          <p className="label mb-1.5">Tag</p>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Tag name"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void commitName('enter');
              }
              // The old name stays. Renaming is the one thing on this screen
              // that touches every task carrying the tag.
              if (event.key === 'Escape') setName(null);
            }}
            onBlur={() => void commitName('blur')}
            className={cn(
              'w-full rounded-md border border-line bg-sunken px-2.5 py-1.5',
              'font-display text-[2rem] leading-none text-text-hi',
              'focus:border-clay-400 focus:outline-none',
            )}
          />
        </div>
      )}

      <div className="mb-4 flex items-center gap-2">
        <Link href="/tags" className="label rounded-md px-2 py-1 hover:text-text-mid">
          All tags
        </Link>

        <button
          type="button"
          onClick={() => setName(tag.name)}
          className="label ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 hover:text-text-mid"
        >
          <PencilSimple size={13} aria-hidden />
          Rename
        </button>

        <button
          type="button"
          onClick={() => void remove()}
          className="label flex items-center gap-1.5 rounded-md px-2 py-1 text-clay-200 hover:bg-raised"
        >
          <Trash size={13} aria-hidden />
          Delete
        </button>
      </div>

      <TaskList
        tasks={tasks}
        empty={
          <EmptyState
            icon={Hash}
            title={`Nothing open with #${tag.name}`}
            hint="Type the tag at the end of a task to file it here."
          />
        }
      />
    </>
  );
}

function TagsScreen() {
  const openId = useSearchParams().get('t');
  const tags = useTags();
  const tag = tags.find((row) => row.id === openId);

  // A deleted tag leaves the url pointing at nothing, which is the index.
  return tag ? <OneTag key={tag.id} tag={tag} /> : <TagIndex tags={tags} />;
}

export default function TagsPage() {
  // useSearchParams needs its own boundary or this route stops being
  // prerendered, and the service worker only precaches what is.
  return (
    <Suspense fallback={<ViewHeader title="Tags" eyebrow="Labels" />}>
      <TagsScreen />
    </Suspense>
  );
}

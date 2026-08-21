'use client';

import { createContext, useContext, useMemo } from 'react';
import { useTags } from '@/hooks/use-tasks';

/**
 * One tag lookup for the page.
 *
 * A row holds tag ids and has to print names, and the list resolved them with its
 * own live query. One list is one query, and the logbook mounts a list per day,
 * so a page with a week on it opened seven subscriptions to a table holding a
 * dozen rows and re-read all of them whenever any tag changed.
 *
 * Provided in the shell for the same reason the keyboard cursor and the selection
 * bar live there: the answer is the same for every list on the screen. Outside the
 * provider the map is empty rather than absent, so a row renders its tags as
 * nothing instead of throwing, and every list in the app is inside it.
 */
const TagNames = createContext<ReadonlyMap<string, string>>(new Map());

export function TagNamesProvider({ children }: { children: React.ReactNode }) {
  const tags = useTags();
  const names = useMemo(() => new Map(tags.map((tag) => [tag.id, tag.name])), [tags]);
  return <TagNames value={names}>{children}</TagNames>;
}

/** id to name, which is what a row needs to print a tag it holds by id. */
export function useTagNames(): ReadonlyMap<string, string> {
  return useContext(TagNames);
}

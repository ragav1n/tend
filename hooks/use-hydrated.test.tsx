// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { useHydrated } from './use-hydrated';

/**
 * Why a date needs a key and not just a re-render.
 *
 * Measured first in a browser: built with `TZ=Pacific/Kiritimati` and loaded
 * from New York, the Today eyebrow read the server's date and never corrected.
 * The reason is not obvious from reading React's docs, so it is pinned here.
 * `suppressHydrationWarning` leaves the server's text in the DOM while the
 * fiber records the client's, so every later render agrees with itself and the
 * DOM keeps a date nobody has.
 */

function Suppressed({ label }: { label: string }) {
  useHydrated();
  return <p suppressHydrationWarning>{label}</p>;
}

function Keyed({ label }: { label: string }) {
  const hydrated = useHydrated();
  return (
    <p key={`only-${hydrated}`} suppressHydrationWarning>
      {label}
    </p>
  );
}

async function hydrateWithDifferentText(Component: (p: { label: string }) => React.ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  container.innerHTML = renderToString(<Component label="SERVER DATE" />);
  await act(async () => {
    hydrateRoot(container, <Component label="CLIENT DATE" />);
  });
  return container.textContent;
}

describe('useHydrated', () => {
  it('a re-render alone leaves the server text in the DOM', async () => {
    // Not the behaviour anybody wants, recorded so the key below is not
    // mistaken for redundancy and deleted.
    expect(await hydrateWithDifferentText(Suppressed)).toBe('SERVER DATE');
  });

  it('a hydration-keyed remount writes the client text', async () => {
    expect(await hydrateWithDifferentText(Keyed)).toBe('CLIENT DATE');
  });
});

/**
 * The half of the rule React enforces, and the source is where to enforce it.
 *
 * The key has to *change* when hydration ends, which is the test above, and it
 * has to be *unique among its siblings*, which is React's own requirement and
 * the part eleven hand-written copies of `hydrated ? 'client' : 'server'` could
 * not keep. Review put two of them in one header `<div>` and logged "Encountered
 * two children with the same key" on every load, for months, in a build where
 * React warns that such children "may be duplicated and/or omitted" and so
 * might skip the very remount the key exists for.
 *
 * Whether two keys are siblings is not something a scan can see. Whether one
 * file writes the same key twice is, and that is the shape the bug had: naming
 * the key after the element it sits on is what makes a collision within a file
 * a collision worth failing on.
 */
const NAMED_KEY = /key=\{`([a-z0-9-]+)-\$\{hydrated\}`\}/g;
const BARE_KEY = /hydrated \? 'client' : 'server'/;

/** Every view file, walked rather than globbed: `fs.globSync` is not in the
 *  Node types this repo pins, so it typechecks as a missing export. */
function views(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return views(path);
    return entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [path] : [];
  });
}

const VIEWS = [...views('app'), ...views('components')];

describe('the hydration keys in the source', () => {
  it('finds the views to scan at all', () => {
    // Or a glob that matched nothing would report every rule below as kept.
    expect(VIEWS.length).toBeGreaterThan(40);
    expect(VIEWS.some((file) => file.includes('review'))).toBe(true);
  });

  it('names every key after the element it sits on', () => {
    const bare = VIEWS.filter((file) => BARE_KEY.test(readFileSync(file, 'utf8')));
    expect(bare).toEqual([]);
  });

  it('never writes the same key twice in one file', () => {
    const clashes: string[] = [];

    for (const file of VIEWS) {
      const names = [...readFileSync(file, 'utf8').matchAll(NAMED_KEY)].map((m) => m[1]!);
      const seen = new Set<string>();
      for (const name of names) {
        if (seen.has(name)) clashes.push(`${file}: ${name}`);
        seen.add(name);
      }
    }

    expect(clashes).toEqual([]);
  });
});

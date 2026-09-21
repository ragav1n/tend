// @vitest-environment jsdom
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
    <p key={hydrated ? 'client' : 'server'} suppressHydrationWarning>
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

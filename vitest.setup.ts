// Dexie needs a real IndexedDB implementation under node.
import 'fake-indexeddb/auto';

/**
 * jsdom ships no `matchMedia`, and `useMediaQuery` calls it during render.
 *
 * Answering false everywhere matches the server snapshot the hook already
 * documents, so a component under test renders its narrow layout. A case that
 * cares about the wide one stubs `window.matchMedia` itself.
 *
 * Guarded rather than assumed: most of this suite runs in node, where there is
 * no window to hang it on.
 */
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      media: query,
      matches: false,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

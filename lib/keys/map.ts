/**
 * The keyboard map, as data.
 *
 * Every binding in the app is a row in a list, so the shortcuts overlay and the
 * command palette can render the same source the dispatcher matches against.
 * Two hand-kept lists of the same shortcut drift the week one of them changes,
 * which is the lesson `nav.ts` already learned.
 *
 * A chord is a string. One key press is `k`, a modified press is `mod+k`, and a
 * two-step sequence is `g t`, typed as g then t. `mod` means Command on a Mac
 * and Control everywhere else, resolved from the event rather than from the
 * platform string, so a Mac keyboard plugged into Linux still works.
 */

export type BindingGroup = 'Go to' | 'Tasks' | 'In a list' | 'App' | 'While selecting';

/**
 * Where a binding is live.
 *
 * `global` is bound for the life of the app. `selection` is bound by the
 * selection bar, which only exists while rows are selected, so `Backspace` is
 * not a app-wide delete key and ⌘A only stops meaning "select this page" while
 * there is a list selection to grow. `list` is bound by the task list, so `j`
 * moves a cursor on Today and types a letter on Settings.
 */
export type BindingScope = 'global' | 'selection' | 'list';

export interface Binding {
  /** Stable handler key. Never shown. */
  id: string;
  /** What to press. `g t` is a sequence, `mod+k` is one press. */
  chord: string;
  label: string;
  group: BindingGroup;
  /** Defaults to global. */
  scope?: BindingScope;
  /**
   * Fires while a text field has focus. Off by default: someone typing "great"
   * into a title is not asking to go to the Board. Only the ones that have to
   * work from inside the palette or a note set it.
   */
  whileTyping?: boolean;
  /**
   * The browser already does this one.
   *
   * Enter on the row under the cursor is the focused button's own click. The
   * dispatcher calls `preventDefault` on any chord it finds in the index, so
   * binding Enter would take it away from every other control on the page for
   * as long as a list is mounted. Listed here so the overlay teaches it, and
   * `chordIndex` leaves it out so nothing tries to dispatch it.
   */
  native?: true;
}

/**
 * First keys of a sequence. Held for the window below, then dropped.
 *
 * `g` is the only one. A second prefix would need this to become a trie, and a
 * task app has nowhere near enough shortcuts to need one.
 */
export const PREFIX_KEYS = new Set(['g']);

/** How long a prefix waits for its second key. Long enough to be typed by hand,
 *  short enough that a forgotten g does not swallow the next real shortcut. */
export const SEQUENCE_WINDOW_MS = 1200;

/**
 * Keys that only exist as part of a chord.
 *
 * A keydown for one of these is somebody reaching for the modifier, not a
 * press to match. `chordOf({ key: 'Shift', shiftKey: true })` reads `shift+shift`
 * and would consume an armed sequence prefix, so the dispatcher drops these
 * before it gets that far.
 */
export const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);

export interface KeyLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/**
 * The chord a key event stands for.
 *
 * Shift is only named when it is not already inside the character. `?` arrives
 * as `?` with shiftKey set, so writing `shift+/` would mean the binding could
 * never be typed on a keyboard that puts `?` somewhere else. A letter is the
 * other way round: shift+e arrives as `E`, and lowercasing it alone would make
 * it collide with plain `e`.
 */
export function chordOf(event: KeyLike): string {
  const key = event.key;
  const parts: string[] = [];

  if (event.metaKey || event.ctrlKey) parts.push('mod');
  if (event.altKey) parts.push('alt');

  const single = key.length === 1;
  const letter = single && key.toLowerCase() !== key.toUpperCase();
  if (event.shiftKey && (!single || letter)) parts.push('shift');

  parts.push(key.toLowerCase());
  return parts.join('+');
}

export interface Pending {
  key: string;
  at: number;
}

export interface Resolution {
  /** The chord to look up, or null while a sequence is still open. */
  chord: string | null;
  /** The prefix now waiting for its second key. */
  pending: Pending | null;
}

/**
 * Fold a chord into whatever sequence is open.
 *
 * Returns the chord to dispatch and the prefix still waiting. A stale prefix is
 * dropped rather than completed, so pressing g, walking away and coming back to
 * press t types a t.
 *
 * `now` is the key event's own timestamp rather than a wall clock, so a handler
 * that runs late behind a busy main thread still measures the gap the user
 * typed.
 */
export function resolveChord(chord: string, pending: Pending | null, now: number): Resolution {
  const live = pending && now - pending.at <= SEQUENCE_WINDOW_MS ? pending : null;

  if (live) return { chord: `${live.key} ${chord}`, pending: null };
  if (PREFIX_KEYS.has(chord)) return { chord: null, pending: { key: chord, at: now } };
  return { chord, pending: null };
}

/**
 * Elements that own the keyboard while they have focus.
 *
 * Read off the target's own properties rather than through `instanceof Element`,
 * so this stays a pure function a node test can call with a plain object.
 */
export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  if (el.isContentEditable === true) return true;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

/** The shape `nav.ts` items already have. Structural so this file stays free of
 *  component imports and its test needs no DOM. */
export interface NavLike {
  href: string;
  label: string;
  key?: string;
}

/** `g <key>` for every destination that claimed a letter. */
export function navBindings(items: readonly NavLike[]): Binding[] {
  return items
    .filter((item): item is NavLike & { key: string } => Boolean(item.key))
    .map((item) => ({
      id: `nav:${item.href}`,
      chord: `g ${item.key}`,
      label: item.label,
      group: 'Go to' as const,
    }));
}

/** Everything that is not a destination. */
export const ACTIONS: Binding[] = [
  { id: 'palette', chord: 'mod+k', label: 'Command palette', group: 'App', whileTyping: true },
  { id: 'search', chord: '/', label: 'Search tasks', group: 'App' },
  { id: 'shortcuts', chord: '?', label: 'Keyboard shortcuts', group: 'App' },
  { id: 'new-task', chord: 'n', label: 'New task', group: 'Tasks' },
  { id: 'select-mode', chord: 'shift+s', label: 'Select tasks', group: 'Tasks' },
  // Not whileTyping. Inside a field ⌘Z belongs to the field, and taking it
  // would mean a mistyped title could only be fixed by retyping it.
  { id: 'undo', chord: 'mod+z', label: 'Undo the last change', group: 'Tasks' },
];

/**
 * Live only while a task list is on screen.
 *
 * The cursor is DOM focus, which is why Enter needs no handler and why these
 * belong to the list rather than to the app: a key that moves a cursor through
 * rows has nothing to move on a page with no rows.
 */
export const CURSOR_ACTIONS: Binding[] = [
  { id: 'cursor-next', chord: 'j', label: 'Next task', group: 'In a list', scope: 'list' },
  { id: 'cursor-prev', chord: 'k', label: 'Previous task', group: 'In a list', scope: 'list' },
  {
    id: 'cursor-open',
    chord: 'enter',
    label: 'Open the task under the cursor',
    group: 'In a list',
    scope: 'list',
    native: true,
  },
  {
    id: 'cursor-pick',
    chord: 'x',
    label: 'Select the task under the cursor',
    group: 'In a list',
    scope: 'list',
  },
];

/** Live only while a selection exists. */
export const SELECTION_ACTIONS: Binding[] = [
  {
    id: 'select-all',
    chord: 'mod+a',
    label: 'Select every task in the list',
    group: 'While selecting',
    scope: 'selection',
  },
  {
    id: 'complete-selected',
    chord: 'e',
    label: 'Complete the selection',
    group: 'While selecting',
    scope: 'selection',
  },
  {
    id: 'delete-selected',
    chord: 'backspace',
    label: 'Delete the selection',
    group: 'While selecting',
    scope: 'selection',
  },
  {
    id: 'exit-selection',
    chord: 'escape',
    label: 'Stop selecting',
    group: 'While selecting',
    scope: 'selection',
  },
];

/**
 * chord to binding id, which is the lookup the dispatcher does per key press.
 *
 * A `native` binding is left out. It is in the list to be taught, not to be
 * matched, and a chord in this map is a chord the dispatcher takes off the page.
 */
export function chordIndex(bindings: readonly Binding[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const binding of bindings) {
    if (!binding.native) index.set(binding.chord, binding.id);
  }
  return index;
}

/** The bindings live in one scope. */
export function inScope(bindings: readonly Binding[], scope: BindingScope): Binding[] {
  return bindings.filter((binding) => (binding.scope ?? 'global') === scope);
}

/** Bindings that survive a focused text field, by id. */
export function typingSafe(bindings: readonly Binding[]): Set<string> {
  return new Set(bindings.filter((b) => b.whileTyping).map((b) => b.id));
}

const KEY_LABEL: Record<string, string> = {
  mod: '⌘',
  alt: '⌥',
  shift: '⇧',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  enter: '↵',
  escape: 'Esc',
  backspace: '⌫',
  delete: '⌦',
  tab: '⇥',
};

/**
 * A chord split into the keys to draw, one <kbd> each.
 *
 * `mod` renders as ⌘ everywhere. Writing Ctrl on Windows would be more correct
 * and would also mean the overlay disagrees with itself between two of the
 * user's own devices, since the same account opens this app on both.
 *
 * A space cannot be a chord here, because space is what separates the steps of
 * a sequence. Nothing needs one.
 */
export function chordKeys(chord: string): string[] {
  return chord
    .split(' ')
    .flatMap((step) => step.split('+'))
    .map((key) => KEY_LABEL[key] ?? (key.length === 1 ? key.toUpperCase() : key));
}

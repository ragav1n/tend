import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  chordIndex,
  MODIFIER_KEYS,
  chordKeys,
  chordOf,
  isTypingTarget,
  navBindings,
  resolveChord,
  SEQUENCE_WINDOW_MS,
  typingSafe,
  type Binding,
} from './map';

describe('chordOf', () => {
  it('lowercases a plain letter', () => {
    expect(chordOf({ key: 'K' })).toBe('k');
    expect(chordOf({ key: 'n' })).toBe('n');
  });

  it('names mod for either Command or Control', () => {
    expect(chordOf({ key: 'k', metaKey: true })).toBe('mod+k');
    expect(chordOf({ key: 'k', ctrlKey: true })).toBe('mod+k');
  });

  it('leaves shift out of a character that already carries it', () => {
    // `?` is shift+/ on a US layout and somewhere else entirely on others. The
    // character is the portable name for it.
    expect(chordOf({ key: '?', shiftKey: true })).toBe('?');
    expect(chordOf({ key: '/', shiftKey: false })).toBe('/');
  });

  it('names shift on a letter, which lowercasing would otherwise erase', () => {
    expect(chordOf({ key: 'E', shiftKey: true })).toBe('shift+e');
  });

  it('names shift on a key that has no character', () => {
    expect(chordOf({ key: 'Tab', shiftKey: true })).toBe('shift+tab');
    expect(chordOf({ key: 'Escape' })).toBe('escape');
  });

  it('orders modifiers so one press has one name', () => {
    expect(chordOf({ key: 'k', metaKey: true, altKey: true, shiftKey: true })).toBe(
      'mod+alt+shift+k',
    );
  });
});

describe('resolveChord', () => {
  it('dispatches an ordinary key straight through', () => {
    expect(resolveChord('n', null, 1000)).toEqual({ chord: 'n', pending: null });
  });

  it('holds a prefix instead of dispatching it', () => {
    expect(resolveChord('g', null, 1000)).toEqual({ chord: null, pending: { key: 'g', at: 1000 } });
  });

  it('completes a sequence inside the window', () => {
    const held = { key: 'g', at: 1000 };
    expect(resolveChord('t', held, 1000 + SEQUENCE_WINDOW_MS)).toEqual({
      chord: 'g t',
      pending: null,
    });
  });

  it('drops a stale prefix rather than completing it', () => {
    const held = { key: 'g', at: 1000 };
    expect(resolveChord('t', held, 1001 + SEQUENCE_WINDOW_MS)).toEqual({
      chord: 't',
      pending: null,
    });
  });

  it('restarts the sequence when the prefix is pressed twice', () => {
    const held = { key: 'g', at: 1000 };
    // Second g completes a `g g` lookup that matches nothing, which is the
    // right answer: the alternative is a prefix that can never be cancelled.
    expect(resolveChord('g', held, 1200)).toEqual({ chord: 'g g', pending: null });
  });
});

describe('modifier keys', () => {
  it('names the ones that only exist inside a chord', () => {
    // A keydown for one of these is somebody reaching for the modifier. Left to
    // reach chordOf, Shift reads as `shift+shift` and eats an armed prefix.
    expect(chordOf({ key: 'Shift', shiftKey: true })).toBe('shift+shift');
    expect(MODIFIER_KEYS.has('Shift')).toBe(true);
    for (const key of ['Control', 'Alt', 'Meta', 'CapsLock']) {
      expect(MODIFIER_KEYS.has(key), key).toBe(true);
    }
    // And not the keys that are real presses.
    for (const key of ['g', 'Escape', 'Backspace', 'Tab']) {
      expect(MODIFIER_KEYS.has(key), key).toBe(false);
    }
  });
});

describe('isTypingTarget', () => {
  it('claims the keyboard for fields and gives it back for everything else', () => {
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV' })).toBe(false);
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('navBindings', () => {
  it('builds g-sequences and skips destinations with no letter', () => {
    expect(
      navBindings([
        { href: '/today', label: 'Today', key: 't' },
        { href: '/nowhere', label: 'Nowhere' },
      ]),
    ).toEqual([{ id: 'nav:/today', chord: 'g t', label: 'Today', group: 'Go to' }]);
  });
});

describe('the map as a whole', () => {
  const bindings = [
    ...navBindings([
      { href: '/today', label: 'Today', key: 't' },
      { href: '/board', label: 'Board', key: 'b' },
    ]),
    ...ACTIONS,
  ];

  it('gives every chord exactly one meaning', () => {
    const chords = bindings.map((b) => b.chord);
    expect(new Set(chords).size).toBe(chords.length);
  });

  it('gives every binding exactly one id', () => {
    const ids = bindings.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps single-key shortcuts off the sequence prefixes', () => {
    // A binding on plain `g` would never fire, because `g` is always held.
    const shadowed = bindings.filter((b) => b.chord === 'g');
    expect(shadowed).toEqual([]);
  });

  it('indexes chords to ids', () => {
    expect(chordIndex(bindings).get('g b')).toBe('nav:/board');
    expect(chordIndex(bindings).get('mod+k')).toBe('palette');
  });

  it('lets only the palette through a focused field', () => {
    expect([...typingSafe(bindings)]).toEqual(['palette']);
  });
});

describe('chordKeys', () => {
  it('splits a sequence into one key per step', () => {
    expect(chordKeys('g t')).toEqual(['G', 'T']);
  });

  it('splits a modified press into its modifiers', () => {
    expect(chordKeys('mod+k')).toEqual(['⌘', 'K']);
  });

  it('leaves a symbol alone and names the keys that have no glyph', () => {
    expect(chordKeys('?')).toEqual(['?']);
    expect(chordKeys('escape')).toEqual(['Esc']);
    // Or the overlay draws a cap reading "backspace" in lower case next to a
    // row of glyphs.
    expect(chordKeys('backspace')).toEqual(['⌫']);
    expect(chordKeys('mod+a')).toEqual(['⌘', 'A']);
  });
});

// A compile-time check that the exported shape is what the components consume.
const _sample: Binding = ACTIONS[0]!;
void _sample;

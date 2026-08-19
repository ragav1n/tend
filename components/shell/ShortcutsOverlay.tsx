'use client';

import { Sheet } from '@/components/ui/Sheet';
import { Chord } from '@/components/ui/Kbd';
import { BINDINGS } from '@/components/shell/keymap';
import { useUiStore } from '@/hooks/use-ui';
import type { BindingGroup } from '@/lib/keys/map';

/**
 * Every shortcut, from the same list the dispatcher matches against.
 *
 * A hand-written cheatsheet is a promise the code stops keeping, so this reads
 * `BINDINGS`. A binding that exists appears here; one that is removed leaves.
 */

const GROUP_ORDER: BindingGroup[] = ['Go to', 'Tasks', 'App', 'While selecting'];

export function ShortcutsOverlay() {
  const open = useUiStore((state) => state.shortcutsOpen);
  const setOpen = useUiStore((state) => state.setShortcutsOpen);

  return (
    <Sheet open={open} onClose={() => setOpen(false)} label="Keyboard shortcuts">
      <h2 className="text-lg">Keyboard shortcuts</h2>
      <p className="mt-1 text-sm text-text-lo">
        Sequences are typed one key after the other. Press G then T for Today.
      </p>

      <div className="mt-6 space-y-6 pb-2">
        {GROUP_ORDER.map((group) => {
          const rows = BINDINGS.filter((binding) => binding.group === group);
          if (rows.length === 0) return null;

          return (
            <section key={group}>
              <h3 className="label">{group}</h3>
              <ul className="mt-2 space-y-0.5">
                {rows.map((binding) => (
                  <li
                    key={binding.id}
                    className="flex items-center gap-3 rounded-md px-1 py-1.5 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate text-text-mid">{binding.label}</span>
                    <Chord chord={binding.chord} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </Sheet>
  );
}

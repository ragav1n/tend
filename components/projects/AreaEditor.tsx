'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { SquaresFour, Trash } from '@phosphor-icons/react/dist/ssr';
import { createArea, deleteArea, restoreArea, updateArea } from '@/lib/db/mutations';
import type { Area } from '@/lib/db/types';
import { cn } from '@/lib/utils';
import { Field, controlClass } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';

/**
 * Build or rename one area.
 *
 * A name and nothing else. An area with its own colour, status and due date
 * would start competing with the project for which one holds the plan, and the
 * answer has to stay the project.
 */

function AreaForm({ area, onClose }: { area?: Area; onClose: (savedId?: string) => void }) {
  const [name, setName] = useState(area?.name ?? '');

  async function save() {
    const title = name.trim();
    if (title === '') return;

    if (area) {
      await updateArea(area.id, { name: title });
      onClose(area.id);
    } else {
      onClose(await createArea({ name: title }));
    }
  }

  async function remove() {
    if (!area) return;
    const id = area.id;
    onClose();

    const unfiled = await deleteArea(id);
    toast('Area deleted', {
      description:
        unfiled.length === 0
          ? undefined
          : `${unfiled.length} ${unfiled.length === 1 ? 'project' : 'projects'} moved out of it.`,
      action: { label: 'Undo', onClick: () => void restoreArea(id, unfiled) },
    });
  }

  return (
    <>
      <h2 className="text-lg">{area ? 'Edit area' : 'New area'}</h2>

      <div className="mt-4">
        <Field label="Name" icon={SquaresFour} htmlFor="area-name">
          <input
            id="area-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Home"
            className={controlClass}
          />
        </Field>
      </div>

      <div className="mt-6 flex items-center gap-2 pb-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={name.trim() === ''}
          className={cn(
            'rounded-md border border-clay-400 bg-clay-600 px-3 py-2 text-sm text-on-accent',
            'hover:bg-clay-500 disabled:opacity-40',
          )}
          style={{ boxShadow: 'var(--shadow-flush)' }}
        >
          {area ? 'Save' : 'Create area'}
        </button>

        {area && (
          <button
            type="button"
            onClick={() => void remove()}
            className={cn(
              'ml-auto flex items-center gap-1.5 rounded-md px-2.5 py-2 text-sm',
              'text-clay-200 hover:bg-raised',
            )}
          >
            <Trash size={16} aria-hidden />
            Delete
          </button>
        )}
      </div>

      {area && (
        <p className="pb-2 text-xs text-text-lo">
          Deleting an area keeps its projects. They move to No area.
        </p>
      )}
    </>
  );
}

export function AreaEditor({
  open,
  area,
  onClose,
}: {
  open: boolean;
  area?: Area;
  onClose: (savedId?: string) => void;
}) {
  return (
    <Sheet open={open} onClose={() => onClose()} label={area ? 'Edit area' : 'New area'}>
      <AreaForm key={area?.id ?? 'new'} area={area} onClose={onClose} />
    </Sheet>
  );
}

'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash, WarningCircle } from '@phosphor-icons/react/dist/ssr';
import {
  createComponent,
  deleteComponent,
  restoreComponent,
  updateComponent,
} from '@/lib/db/mutations';
import type { Course, CourseComponent, Task } from '@/lib/db/types';
import {
  courseStanding,
  reachTarget,
  type ComponentStanding,
  type ComponentWork,
} from '@/lib/courses/grade';
import { letterFor, scaleFor, targetFor } from '@/lib/courses/scale';
import { cn } from '@/lib/utils';
import { controlClass } from '@/components/ui/Field';
import { EmptyState } from '@/components/views/EmptyState';

/**
 * Where the course stands, and what is still reachable.
 *
 * Three numbers, in the order they are useful. Current standing is what you have
 * earned. Projected is where it lands if the rest goes the way the graded work
 * went. The target row is the one people actually open this for: "what do I need
 * on the final".
 *
 * Nothing here is a zero it has not earned. A component with no marks reports
 * nothing rather than 0%, and weight belonging to a component with no items at
 * all is excluded from both numbers and said out loud, because a projection that
 * counts an unentered final as a failure is a projection you learn to ignore.
 */

/** Percentages are shown to one place. Two is false precision on a projection. */
function pct(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

export function GradesTab({
  course,
  components,
  tasks,
}: {
  course: Course;
  components: CourseComponent[];
  tasks: Task[];
}) {
  const [target, setTarget] = useState<string>('90');
  const [adding, setAdding] = useState(false);

  const scale = scaleFor(course.gradeScale);

  const standing = useMemo(() => {
    const work: ComponentWork[] = components.map((component) => ({
      component,
      tasks: tasks.filter((task) => task.componentId === component.id),
    }));
    return courseStanding(work);
  }, [components, tasks]);

  const targetValue = Number.parseFloat(target);
  const reach = Number.isFinite(targetValue) ? reachTarget(standing, targetValue) : null;

  if (components.length === 0 && !adding) {
    return (
      <EmptyState
        icon={WarningCircle}
        title="No weights yet"
        hint="Add what each part of the grade is worth, and Tend can tell you where you stand."
        action={
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="label flex items-center gap-1.5 rounded-md px-2 py-1 !text-[0.625rem] hover:text-text-mid"
          >
            <Plus size={12} weight="bold" aria-hidden />
            Add a component
          </button>
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="Where you stand"
          value={pct(standing.current)}
          hint={
            standing.current === null
              ? 'Nothing graded yet'
              : `${letterFor(standing.current, scale)} on the ${standing.settledWeight.toFixed(0)}% graded`
          }
        />
        <Stat
          label="On this pace"
          value={pct(standing.projected)}
          hint={
            standing.projected === null
              ? 'Needs one mark first'
              : `${letterFor(standing.projected, scale)} if the rest goes the same`
          }
        />
      </div>

      {standing.uncoveredWeight > 0 && (
        // Said out loud rather than folded into the numbers above. Counting it
        // as a zero would read as failure; counting it as earned would lie.
        <p className="flex items-start gap-1.5 rounded-md border border-line bg-surface px-3 py-2 text-xs text-text-lo">
          <WarningCircle size={14} weight="bold" aria-hidden className="mt-px shrink-0" />
          <span>
            <span className="tnum">{standing.uncoveredWeight.toFixed(0)}%</span> of the grade has
            nothing entered against it, so neither number above is speaking for it.
          </span>
        </p>
      )}

      <section>
        <h3 className="label mb-2 px-1">What each part is worth</h3>
        <ul className="space-y-1.5">
          {standing.components.map((row) => (
            <ComponentRow
              key={row.componentId}
              row={row}
              component={components.find((c) => c.id === row.componentId)!}
              scale={scale}
            />
          ))}
        </ul>

        <div className="mt-2 flex items-center gap-3 px-1">
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="label flex items-center gap-1.5 rounded-md py-1 !text-[0.625rem] hover:text-text-mid"
          >
            <Plus size={12} weight="bold" aria-hidden />
            Add a component
          </button>

          <span
            className={cn(
              'tnum ml-auto text-xs',
              standing.totalWeight === 100 ? 'text-text-faint' : 'text-clay-200',
            )}
          >
            {standing.totalWeight.toFixed(0)}% total
          </span>
        </div>

        {adding && (
          <NewComponent
            courseId={course.id}
            onDone={() => setAdding(false)}
          />
        )}
      </section>

      <section className="border-t border-line pt-4">
        <h3 className="label mb-2 px-1">What you need on the rest</h3>

        {/* The letters first, because "I want an A" is the question people
            actually have, and what number that is depends on this course's
            scale rather than on the letter. The field stays for anything in
            between. */}
        <div className="mb-2 flex flex-wrap gap-1 px-1">
          {scale.map((band) => {
            const min = targetFor(band.letter, scale);
            if (min === null) return null;
            const picked = Number.isFinite(targetValue) && targetValue === min;
            return (
              <button
                key={band.letter}
                type="button"
                onClick={() => setTarget(String(min))}
                aria-pressed={picked}
                className={cn(
                  'label rounded-md px-2 py-1 !text-[0.625rem]',
                  picked ? 'bg-raised text-text-hi' : 'hover:text-text-mid',
                )}
              >
                {band.letter}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 px-1">
          <label htmlFor="grade-target" className="text-xs text-text-lo">
            To finish on
          </label>
          <input
            id="grade-target"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            inputMode="decimal"
            aria-label="Target percentage"
            className={cn(controlClass, 'tnum w-20')}
          />
          <span className="text-xs text-text-lo">%</span>
          {Number.isFinite(targetValue) && (
            <span className="ml-1 text-xs text-text-faint">
              {letterFor(targetValue, scale)}
            </span>
          )}
        </div>

        <p className="mt-3 px-1 text-sm text-text-mid">
          {reach === null ? (
            'Give a target as a number.'
          ) : reach.verdict === 'nothing-left' ? (
            'Nothing left with points on it. This grade is settled.'
          ) : reach.verdict === 'already' ? (
            <>You are already there. Anything on the rest holds it.</>
          ) : reach.verdict === 'impossible' ? (
            <>
              Out of reach: that needs{' '}
              <span className="tnum text-clay-200">{reach.required!.toFixed(1)}%</span> of the
              remaining <span className="tnum">{reach.pendingWeight.toFixed(0)}%</span>.
            </>
          ) : (
            <>
              You need{' '}
              <span className="tnum text-text-hi">{reach.required!.toFixed(1)}%</span> across the
              remaining <span className="tnum">{reach.pendingWeight.toFixed(0)}%</span> of the
              grade.
            </>
          )}
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div
      className="rounded-lg border border-line bg-surface px-3.5 py-3"
      style={{ boxShadow: 'var(--shadow-flush)' }}
    >
      <p className="label !text-[0.5625rem]">{label}</p>
      <p className="tnum mt-1 text-2xl leading-none text-text-hi">{value}</p>
      <p className="mt-1.5 text-xs text-text-lo">{hint}</p>
    </div>
  );
}

/**
 * One component, editable in place.
 *
 * The weight and the drop count commit on blur, like every other text field in
 * the app. A sheet per component would be three taps to change one number on a
 * screen whose whole job is those numbers.
 */
function ComponentRow({
  row,
  component,
  scale,
}: {
  row: ComponentStanding;
  component: CourseComponent;
  scale: Parameters<typeof letterFor>[1];
}) {
  const [name, setName] = useState(component.name);
  const [weight, setWeight] = useState(String(component.weight));
  const [drop, setDrop] = useState(String(component.dropLowest));

  function commit() {
    const patch: Parameters<typeof updateComponent>[1] = {};
    if (name.trim() !== component.name) patch.name = name.trim();

    const parsedWeight = Number.parseFloat(weight);
    if (Number.isFinite(parsedWeight) && parsedWeight !== component.weight) {
      patch.weight = Math.max(0, Math.min(100, parsedWeight));
    }

    const parsedDrop = Number.parseInt(drop, 10);
    if (Number.isFinite(parsedDrop) && parsedDrop !== component.dropLowest) {
      patch.dropLowest = Math.max(0, parsedDrop);
    }

    if (Object.keys(patch).length > 0) void updateComponent(component.id, patch);
  }

  function remove() {
    const doomed = component.id;
    void deleteComponent(doomed).then(({ taskIds }) => {
      toast('Component deleted', {
        description:
          taskIds.length === 0
            ? undefined
            : `${taskIds.length} ${taskIds.length === 1 ? 'task' : 'tasks'} no longer count toward a weight.`,
        action: { label: 'Undo', onClick: () => void restoreComponent(doomed, taskIds) },
      });
    });
  }

  // The bar is the score, because that is what a bar reads as. It used to show
  // how much of the component was decided, which drew a full olive bar beside
  // "78.0%" on a fully marked midterm and looked like a full mark. How much is
  // decided is already said in words underneath: "78/100 marked, 100 pending".
  const filled = row.percent === null ? 0 : Math.max(0, Math.min(100, row.percent));

  return (
    <li
      className="rounded-lg border border-line bg-surface px-3.5 py-2.5"
      style={{ boxShadow: 'var(--shadow-flush)' }}
    >
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={commit}
          placeholder="Homework"
          aria-label="Component name"
          className="min-w-0 flex-1 bg-transparent text-sm text-text-hi placeholder:text-text-lo focus:outline-none"
        />

        <input
          value={weight}
          onChange={(event) => setWeight(event.target.value)}
          onBlur={commit}
          inputMode="decimal"
          aria-label={`${component.name} weight, percent of the grade`}
          className={cn(controlClass, 'tnum w-14 shrink-0 text-right')}
        />
        <span className="shrink-0 text-xs text-text-lo">%</span>

        <button
          type="button"
          onClick={remove}
          aria-label={`Delete ${component.name}`}
          className="grid size-7 shrink-0 place-items-center rounded-md text-text-faint hover:bg-raised hover:text-clay-300"
        >
          <Trash size={13} aria-hidden />
        </button>
      </div>

      <div className="mt-2 flex items-center gap-2.5">
        {/* How much of this component is decided, not how well it went. The
            score is the number beside it. */}
        <span
          className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-sunken"
          role="img"
          aria-label={
            row.percent === null
              ? `${row.name} is not marked yet`
              : `${row.name} at ${row.percent.toFixed(1)} percent`
          }
        >
          <span
            className="block h-full rounded-full bg-olive-400"
            style={{ width: `${filled}%` }}
          />
        </span>

        <span className="tnum shrink-0 text-xs text-text-mid">
          {row.percent === null ? 'not marked' : `${row.percent.toFixed(1)}%`}
        </span>
        {row.percent !== null && (
          <span className="shrink-0 text-xs text-text-faint">
            {letterFor(row.percent, scale)}
          </span>
        )}
      </div>

      <div className="mt-1.5 flex items-center gap-2 text-xs text-text-faint">
        <span className="tnum">
          {row.gradedEarned.toFixed(0)}/{row.gradedPossible.toFixed(0)} marked
        </span>
        {row.pendingPossible > 0 && (
          <span className="tnum">{row.pendingPossible.toFixed(0)} pending</span>
        )}
        <label className="ml-auto flex items-center gap-1">
          <span>drop</span>
          <input
            value={drop}
            onChange={(event) => setDrop(event.target.value)}
            onBlur={commit}
            inputMode="numeric"
            aria-label={`How many lowest scores ${component.name} drops`}
            className="tnum w-7 rounded border border-line bg-sunken px-1 py-0.5 text-center text-text-mid focus:border-clay-400 focus:outline-none"
          />
        </label>
        {row.dropped > 0 && <span className="tnum">−{row.dropped} dropped</span>}
      </div>
    </li>
  );
}

function NewComponent({ courseId, onDone }: { courseId: string; onDone: () => void }) {
  const [name, setName] = useState('');
  const [weight, setWeight] = useState('');

  async function save() {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      onDone();
      return;
    }
    const parsed = Number.parseFloat(weight);
    await createComponent({
      courseId,
      name: trimmed,
      weight: Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0,
    });
    onDone();
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void save();
          if (event.key === 'Escape') onDone();
        }}
        placeholder="Homework"
        aria-label="New component name"
        className={cn(controlClass, 'min-w-0 flex-1')}
      />
      <input
        value={weight}
        onChange={(event) => setWeight(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void save();
          if (event.key === 'Escape') onDone();
        }}
        inputMode="decimal"
        placeholder="30"
        aria-label="New component weight"
        className={cn(controlClass, 'tnum w-14 shrink-0 text-right')}
      />
      <span className="shrink-0 text-xs text-text-lo">%</span>
      <button
        type="button"
        onClick={() => void save()}
        className="rounded-md bg-clay-600 px-2.5 py-1.5 text-xs text-on-accent"
      >
        Add
      </button>
    </div>
  );
}

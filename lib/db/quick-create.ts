import { parseQuickAdd } from '@/lib/parse';
import { createTask, ensureProject, ensureTag } from './mutations';

/**
 * One line of text to one task.
 *
 * Lives outside the component so the quick-add field and the command palette
 * create tasks the same way. When they each had their own version, typing
 * "Pay rent tomorrow #bills" got a due date in one place and a title containing
 * the word "tomorrow" in the other.
 */

export interface QuickDefaults {
  /** The view's date, used only when the text names none. */
  plannedFor?: string | null;
  dueDate?: string | null;
  projectId?: string;
}

export async function quickCreate(text: string, defaults: QuickDefaults = {}): Promise<string | null> {
  const parsed = parseQuickAdd(text);
  if (parsed.title.length === 0) return null;

  // Tags and the project resolve to ids first, so the task and its join rows
  // land in one batch rather than the task appearing unfiled for a beat.
  const tagIds = await Promise.all(parsed.tagNames.map((name) => ensureTag(name)));
  // A typed @project wins over the view default: it is the more specific
  // instruction, and the chip already promised it would be applied.
  const projectId = parsed.projectName ? await ensureProject(parsed.projectName) : defaults.projectId;

  // A typed date wins over the view's, for the same reason a typed project does.
  const dueDate = parsed.dueDate ?? defaults.dueDate ?? null;

  return createTask({
    title: parsed.title,
    dueDate,
    dueTime: parsed.dueTime,
    priority: parsed.priority,
    plannedFor: dueDate === null ? (defaults.plannedFor ?? null) : null,
    ...(projectId ? { projectId } : {}),
    tagIds,
  });
}

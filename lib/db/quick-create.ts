import { parseQuickAdd } from '@/lib/parse';
import { createTask, ensureProject, ensureTag } from './mutations';
import { courseOptions } from './queries';
import { pickCourse } from '@/lib/courses/pick';

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
  /** The course page's own course, so anything typed there is coursework. */
  courseId?: string;
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

  // A typed +course resolves against the courses that exist rather than creating
  // one. A course is a thing with credit hours, a term and a grading scheme, and
  // conjuring an empty one from a typo is not a favour: "+cs6035" on a fresh
  // install should file nowhere rather than invent CS6035.
  const courseId = parsed.courseCode
    ? ((await matchCourse(parsed.courseCode)) ?? defaults.courseId)
    : defaults.courseId;

  // A typed date wins over the view's, for the same reason a typed project does.
  const dueDate = parsed.dueDate ?? defaults.dueDate ?? null;

  return createTask({
    title: parsed.title,
    ...(defaults.courseId ? { courseId: defaults.courseId } : {}),
    dueDate,
    dueTime: parsed.dueTime,
    priority: parsed.priority,
    plannedFor: dueDate === null ? (defaults.plannedFor ?? null) : null,
    ...(projectId ? { projectId } : {}),
    ...(courseId ? { courseId } : {}),
    tagIds,
  });
}

/**
 * The course a typed code means, or nothing.
 *
 * Folded, so "+cs6035", "+CS 6035" and "+cs-6035" all reach CS 6035. Nobody
 * types a course code the same way twice, and the alternative is a sigil that
 * works only when you spell it exactly as you filed it.
 */
async function matchCourse(code: string): Promise<string | undefined> {
  return pickCourse(code, await courseOptions()) ?? undefined;
}

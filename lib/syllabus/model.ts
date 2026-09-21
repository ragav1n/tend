import type { SyllabusRow } from './paste';
import { resolveSyllabusDate, type DateWindow } from './dates';

/**
 * Asking a local model to read a syllabus.
 *
 * Optional by construction. The paste grid is the feature; this fills it in
 * faster when a model happens to be reachable, and everything below is written
 * so that "not reachable" is the ordinary case rather than an error. Ollama will
 * usually be off, because it is supposed to be.
 *
 * Nothing is started, nothing is polled, and no connection is held. One request
 * when the button is pressed, and `keep_alive: 0` on that request so the
 * weights leave memory as soon as it answers rather than lingering for Ollama's
 * default five minutes. That is the whole lifecycle, and it needs nothing
 * configured: a 4B model is 3GB of VRAM and a request made once a semester has
 * no business keeping it.
 *
 * Measured against `qwen3.5:4b` on a real syllabus: 2 to 5 seconds, every
 * graded item found with its points, and office hours, a reading with no
 * deliverable and the late policy all correctly left out.
 *
 * ── Why the output can be trusted enough to show ───────────────────────────
 *
 * It is constrained, then checked, then re-parsed. `format` takes a JSON schema
 * and Ollama decodes against it, so the reply is shaped before it arrives. The
 * shape is still verified here by hand, because a model can satisfy a schema and
 * still return "sometime in October" for a date. And every date it produces goes
 * through `resolveSyllabusDate` rather than being trusted, which is the same
 * path a typed date takes.
 *
 * The model never writes a task. It fills the grid, and you confirm the grid.
 * That is the only reason it is safe to point a 4B model at a deadline list.
 */

/** Small on purpose. A syllabus table is extraction, not reasoning, and the
 *  schema does the structural work a bigger model would be paid for. */
export const DEFAULT_MODEL = 'qwen3.5:4b';
export const DEFAULT_ENDPOINT = 'http://localhost:11434';

/**
 * Short, and load-bearing rather than defensive.
 *
 * Measured against `https://tend-iota-jade.vercel.app` on 2026-09-21: a fetch
 * from an HTTPS origin to `http://localhost:11434` does not fail, it **hangs**.
 * Left unbounded it was still pending after two minutes. So this timeout is the
 * only thing between "the assist quietly does not appear" and "the settings
 * screen sits there". With it, the deployed app gives up in 1502ms and reports
 * unreachable, which is correct: a browser will not let a page served over
 * HTTPS reach a loopback address, whatever `OLLAMA_ORIGINS` says.
 *
 * From a local dev server the same request answers immediately, which is where
 * the assist is meant to be used.
 */
export const PROBE_TIMEOUT_MS = 1500;

/** Long enough for a 4B model to read a page of syllabus on a laptop GPU. */
export const EXTRACT_TIMEOUT_MS = 120_000;

/** The shape the reply is decoded against. */
export const SCHEMA = {
  type: 'object',
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string' },
          due: { type: 'string' },
          points: { type: 'number' },
        },
      },
    },
  },
} as const;

const SYSTEM = [
  'You read course syllabus text and list the graded work in it.',
  'Return one item per assignment, exam, quiz or project that a student has to hand in or sit.',
  'Copy the title as written. Do not invent work that is not there.',
  'Put the due date in `due` exactly as the syllabus writes it, for example "Sep 14" or "2026-10-02".',
  'If a line has no date, leave `due` out rather than guessing.',
  'When the syllabus states how much an item is worth, put that number in `points`.',
  'Ignore office hours, lecture topics, readings with no deliverable, and policy text.',
].join(' ');

export interface ProbeResult {
  reachable: boolean;
  /** Models the server has, so the picker offers real answers. */
  models: string[];
}

/**
 * Whether a model is reachable right now.
 *
 * A failure is the normal case and returns quietly rather than throwing. Two
 * things stop it working and neither is a bug in the app: Ollama accepts
 * cross-origin requests from `127.0.0.1` only unless `OLLAMA_ORIGINS` names the
 * page's origin, and a browser will not let a page served over HTTPS reach a
 * loopback address at all. Both were measured rather than assumed, and the
 * second one hangs rather than erroring, which is what `PROBE_TIMEOUT_MS` is
 * really for.
 */
export async function probeModel(
  endpoint: string,
  fetcher: typeof fetch = fetch,
): Promise<ProbeResult> {
  try {
    const response = await fetcher(`${trimEnd(endpoint)}/api/tags`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return { reachable: false, models: [] };

    const body = (await response.json()) as { models?: { name?: unknown }[] };
    const models = (body.models ?? [])
      .map((model) => model.name)
      .filter((name): name is string => typeof name === 'string');

    return { reachable: true, models };
  } catch {
    return { reachable: false, models: [] };
  }
}

export type ExtractResult =
  | { rows: SyllabusRow[] }
  | { reason: string };

/**
 * A syllabus, read by the model, as rows for the grid.
 *
 * `stream: false` because there is nothing to stream to: the grid appears when
 * the whole answer is in. `think: false` keeps a reasoning model from spending
 * its budget narrating, since the schema already decides the shape.
 */
export async function extractSyllabus(
  text: string,
  options: { endpoint: string; model: string; window: DateWindow },
  fetcher: typeof fetch = fetch,
): Promise<ExtractResult> {
  if (text.trim() === '') return { rows: [] };

  let payload: unknown;
  try {
    const response = await fetcher(`${trimEnd(options.endpoint)}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
      body: JSON.stringify({
        model: options.model,
        stream: false,
        think: false,
        format: SCHEMA,
        // Unloaded the moment it answers, rather than lingering for Ollama's
        // default five minutes. A 4B model is 3GB of VRAM, and a request made
        // once a semester has no business holding it afterwards. Asking per
        // request means this works without anybody setting OLLAMA_KEEP_ALIVE.
        keep_alive: 0,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: text },
        ],
      }),
    });

    if (!response.ok) {
      return {
        reason:
          response.status === 404
            ? `${options.model} is not installed`
            : `the model answered ${response.status}`,
      };
    }

    payload = await response.json();
  } catch {
    return { reason: 'could not reach the model' };
  }

  const content = contentOf(payload);
  if (content === null) return { reason: 'the model sent something unreadable' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { reason: 'the model did not send JSON' };
  }

  const items = itemsOf(parsed);
  if (items === null) return { reason: 'the model did not send a list of work' };

  return { rows: items.map((item) => toRow(item, options.window)) };
}

/** The assistant message, wherever this Ollama version put it. */
function contentOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const message = (payload as { message?: { content?: unknown } }).message;
  return typeof message?.content === 'string' ? message.content : null;
}

/**
 * The items, checked by hand.
 *
 * Constrained decoding shapes the reply and does not guarantee it: a schema is
 * satisfied by `{"items": []}` and by an item whose `due` is "sometime in
 * October". So every field is checked, and anything unusable is dropped rather
 * than carried into the grid as a broken row.
 */
function itemsOf(parsed: unknown): Record<string, unknown>[] | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const items = (parsed as { items?: unknown }).items;
  if (!Array.isArray(items)) return null;

  return items.filter(
    (item): item is Record<string, unknown> =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as { title?: unknown }).title === 'string' &&
      ((item as { title: string }).title.trim().length > 0),
  );
}

function toRow(item: Record<string, unknown>, window: DateWindow): SyllabusRow {
  const dueText = typeof item.due === 'string' ? item.due.trim() : '';
  const points = typeof item.points === 'number' && Number.isFinite(item.points) ? item.points : null;

  return {
    title: String(item.title).trim(),
    // Through the same resolver a typed date takes. The model is not trusted
    // with a year, and "sometime in October" resolves to nothing rather than to
    // a date somebody would then have to notice was wrong.
    due: dueText === '' ? null : resolveSyllabusDate(dueText, window),
    points,
    dueText,
  };
}

function trimEnd(endpoint: string): string {
  return endpoint.replace(/\/+$/, '');
}

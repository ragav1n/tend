import { parseQuickAdd } from '@/lib/parse';
import type { PlainDate, PlainTime } from '@/lib/db/types';

/**
 * Mail, turned into a task.
 *
 * The one thing Google Tasks does that this app could not: forward something
 * and have it land in the Inbox. A reading list from a supervisor, a deadline
 * buried in a department mailout, a note to yourself from a phone with no app
 * installed.
 *
 * ── Why the subject goes through the quick-add parser ──────────────────────
 *
 * Because it is already the thing people type a task into. "Read chapter 4
 * tomorrow !p2" means the same from a mail client as it does from the field,
 * and having two grammars for one idea is how one of them rots. So the subject
 * is a quick-add line, and the body is the notes.
 *
 * ── What it refuses ───────────────────────────────────────────────────────
 *
 * Mail from anybody but the account holder. An inbound address is guessable and
 * unauthenticated by construction: anybody who learns it can post to it. The
 * sender check is the whole of the authorization, so it is a plain equality
 * against the address on the account and it happens before anything is written.
 *
 * Spoofing a From header is easy, which is worth being honest about: this stops
 * casual noise and somebody who has your address, not a determined forger. The
 * blast radius is a task in your own Inbox, which is why that trade is
 * acceptable here and would not be somewhere that spends money.
 */

export interface InboundAttachment {
  filename?: unknown;
  content_type?: unknown;
}

export interface InboundEvent {
  type?: string;
  data?: {
    email_id?: unknown;
    from?: unknown;
    to?: unknown;
    subject?: unknown;
    attachments?: unknown;
  };
}

/** The bare address out of `Ragav <ragav@example.com>`. */
export function addressOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const angled = /<([^>]+)>/.exec(value);
  const raw = (angled?.[1] ?? value).trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw) ? raw : null;
}

export function senderOf(event: InboundEvent): string | null {
  return addressOf(event.data?.from);
}

export function messageIdOf(event: InboundEvent): string | null {
  const id = event.data?.email_id;
  return typeof id === 'string' && id.trim() !== '' ? id.trim() : null;
}

export interface Capture {
  title: string;
  dueDate: PlainDate | null;
  dueTime: PlainTime | null;
  priority: number;
  /** A course code the subject named with `+`, unresolved. */
  courseCode: string | null;
  notes: string;
}

/** How much of a mail body is worth keeping. Past this it is a newsletter. */
export const MAX_NOTES = 4000;

/** Subjects a mail client adds that are not part of the task. */
const NOISE = /^\s*((re|fwd?|fw)\s*:\s*)+/i;

/**
 * The task a mail means, or null when there is no title in it.
 *
 * `body` arrives separately because Resend's `email.received` payload is
 * metadata only: the text is a second API call, and a caller that could not make
 * it should still be able to capture the subject.
 */
export function toCapture(
  event: InboundEvent,
  body: string,
  now = new Date(),
): Capture | null {
  const subject = typeof event.data?.subject === 'string' ? event.data.subject : '';
  const cleaned = subject.replace(NOISE, '').trim();
  if (cleaned === '') return null;

  const parsed = parseQuickAdd(cleaned, now);
  const title = parsed.title.trim();
  if (title === '') return null;

  return {
    title,
    dueDate: parsed.dueDate,
    dueTime: parsed.dueTime,
    priority: parsed.priority,
    courseCode: parsed.courseCode,
    notes: notesFrom(body, event),
  };
}

/**
 * The body as notes, trimmed to something a task can hold.
 *
 * Quoted reply chains are cut at the first marker. Forwarding a thread is the
 * common case and the whole history is not the task, so keeping it would mean
 * every captured note is mostly somebody else's mail.
 *
 * Attachments are named rather than stored. Resend hands back a temporary
 * download URL, and a link that expires in an hour is worse than a filename: it
 * looks like it works until the day you need it.
 */
export function notesFrom(body: string, event: InboundEvent): string {
  const cut = body
    .replace(/\r\n/g, '\n')
    .split(/\n\s*(?:On .+ wrote:|-{2,}\s*Original Message|_{5,}|>{1}\s)/)[0]
    ?.trim() ?? '';

  const trimmed = cut.length > MAX_NOTES ? `${cut.slice(0, MAX_NOTES).trimEnd()}\n\n…` : cut;

  const names = attachmentNames(event);
  if (names.length === 0) return trimmed;

  const listed = names.map((name) => `- ${name}`).join('\n');
  return [trimmed, `Attached: \n${listed}`].filter((part) => part !== '').join('\n\n');
}

function attachmentNames(event: InboundEvent): string[] {
  const list = event.data?.attachments;
  if (!Array.isArray(list)) return [];

  return list
    .map((item) => (item as InboundAttachment)?.filename)
    .filter((name): name is string => typeof name === 'string' && name.trim() !== '')
    .slice(0, 10);
}

/**
 * The payload `capture_email` takes.
 *
 * Out here rather than inline in the route because getting a field wrong is
 * silent: a missing `priority` files everything as none, and a `feed_uid`
 * without its prefix would let a mail collide with a calendar import and count
 * against the wrong cap. Neither shows up as an error, only as rows that are
 * subtly not what you asked for.
 */
export function capturePayload(
  capture: Capture,
  messageId: string,
  courseId: string | null,
): Record<string, unknown> {
  return {
    // `mail:` prefixed so the identity cannot collide with a calendar feed, and
    // so the daily cap can count captures without counting imports.
    feed_uid: `mail:${messageId}`,
    title: capture.title,
    due_date: capture.dueDate,
    due_time: capture.dueTime,
    priority: capture.priority,
    notes: capture.notes,
    course_id: courseId ?? '',
  };
}

/**
 * A mail body as something a note can hold.
 *
 * Tags out rather than rendered. Notes are markdown, a mail's markup is not,
 * and pasting a marketing template into a task turns it into a wall of
 * table tags.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

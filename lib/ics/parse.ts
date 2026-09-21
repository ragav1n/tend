/**
 * Reading an RFC 5545 calendar, which here means a Canvas feed.
 *
 * The inverse of `serialize.ts`, and deliberately not a general iCalendar
 * library. What arrives is one shape: a Canvas "Calendar Feed" URL, a few
 * hundred VEVENTs, assignments and course events. Recurrence, alarms, attendees,
 * VTIMEZONE and VTODO are all skipped rather than half-understood, because a
 * parser that pretends to read a VTIMEZONE and gets the offset wrong is worse
 * than one that never claimed to.
 *
 * Three things the format does that a naive split on newlines gets wrong, and
 * every one of them appears in a real Canvas feed:
 *
 *   1. **Lines fold.** A content line over 75 octets continues on the next line
 *      with a single leading space or tab, which has to be removed and the two
 *      joined with nothing between them. A Canvas assignment description folds
 *      constantly. Unfolding happens before anything else looks at a line.
 *   2. **Text is escaped.** `\\n`, `\\,`, `\;` and `\\\\` all carry meaning, and a
 *      summary containing a comma is the common case rather than the edge.
 *   3. **A property carries parameters.** `DTSTART;VALUE=DATE:20260914` and
 *      `DTSTART;TZID=America/New_York:20260914T235900` are the same property
 *      with different meanings, so the name, the parameters and the value are
 *      three separate things.
 *
 * Dates come back as wall clock, `YYYY-MM-DD` plus an optional `HH:mm`, because
 * that is what a task stores. A `Z` instant is converted once here; a `TZID` is
 * read as the wall clock it already is, which is right for a feed whose times
 * were written in the course's own zone and is the same assumption the rest of
 * the app makes about a due time.
 */

export interface IcsProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

export interface IcsEvent {
  uid: string;
  summary: string;
  description: string;
  location: string;
  url: string;
  /** Wall-clock start. Null when the event had no readable DTSTART. */
  start: IcsMoment | null;
  end: IcsMoment | null;
  /** Everything else, by property name, for anything this app grows to read. */
  properties: IcsProperty[];
}

export interface IcsMoment {
  /** `YYYY-MM-DD`. */
  date: string;
  /** `HH:mm`, or null for an all-day value. */
  time: string | null;
}

/**
 * Joins folded content lines.
 *
 * A continuation is a line beginning with a space or a tab, and the whole of
 * that first character goes: the spec says the space is the marker, not part of
 * the value. `\r\n` and a bare `\n` are both accepted, because a feed served
 * through a proxy often arrives with the carriage returns stripped.
 */
export function unfold(text: string): string[] {
  const out: string[] = [];

  for (const raw of text.split(/\r\n|\n|\r/)) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += raw.slice(1);
      continue;
    }
    out.push(raw);
  }

  return out.filter((line) => line.length > 0);
}

/** The inverse of `escapeText`. Order matters: backslash last, or it would
 *  unescape the escapes it just produced. */
export function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_match, char: string) =>
    char === 'n' || char === 'N' ? '\n' : char,
  );
}

/**
 * One content line as a name, its parameters, and its value.
 *
 * The value is everything after the first unquoted colon. Quoted because a
 * parameter value may legally contain one: `TZID="GMT+01:00"` is rare but
 * splitting on the first colon anywhere would turn it into a property named
 * `DTSTART;TZID="GMT+01` and lose the event.
 */
export function parseLine(line: string): IcsProperty | null {
  let colon = -1;
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') quoted = !quoted;
    else if (char === ':' && !quoted) {
      colon = i;
      break;
    }
  }

  if (colon === -1) return null;

  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...rest] = head.split(';');
  if (name === undefined || name === '') return null;

  const params: Record<string, string> = {};
  for (const part of rest) {
    const equals = part.indexOf('=');
    if (equals === -1) continue;
    params[part.slice(0, equals).toUpperCase()] = part.slice(equals + 1).replace(/^"|"$/g, '');
  }

  return { name: name.toUpperCase(), params, value };
}

/**
 * A DTSTART or DTEND as wall clock.
 *
 * Four forms appear in the wild:
 *
 *   - `VALUE=DATE:20260914` — all day, no time.
 *   - `20260914T235900Z` — UTC. Converted once, here, because it is a real
 *     instant and everything downstream is wall clock.
 *   - `TZID=America/New_York:20260914T235900` — read as the wall clock it is.
 *     Canvas writes the course's zone, and a deadline at 23:59 means 23:59 to
 *     the person it is set for, which is the assumption `dueTime` already makes.
 *   - `20260914T235900` — floating, which is wall clock by definition.
 *
 * Null for anything unreadable rather than a guessed date. A feed item with no
 * usable date is one this app has nothing to say about, and inventing today for
 * it would put somebody else's mistake on your Today list.
 */
export function parseMoment(property: IcsProperty): IcsMoment | null {
  const value = property.value.trim();

  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return { date: `${y}-${m}-${d}`, time: null };
  }

  const timed = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(value);
  if (!timed) return null;

  const [, y, m, d, hh, mm, , zulu] = timed;

  if (zulu === 'Z') {
    const instant = new Date(`${y}-${m}-${d}T${hh}:${mm}:00Z`);
    if (Number.isNaN(instant.getTime())) return null;
    // Converted through the device's own zone, which is where the person
    // reading the deadline is standing.
    const local = new Date(instant.getTime() - instant.getTimezoneOffset() * 60_000);
    return {
      date: local.toISOString().slice(0, 10),
      time: local.toISOString().slice(11, 16),
    };
  }

  return { date: `${y}-${m}-${d}`, time: `${hh}:${mm}` };
}

/**
 * Every VEVENT in the feed.
 *
 * Nested components are tracked with a depth counter rather than a flag, because
 * a VEVENT may contain a VALARM and the END:VALARM must not be read as the end
 * of the event. VTIMEZONE blocks are skipped whole for the same reason: they
 * contain DTSTART lines that belong to a transition rule rather than to
 * anything on a calendar.
 */
export function parseIcs(text: string): IcsEvent[] {
  const events: IcsEvent[] = [];

  let current: IcsProperty[] | null = null;
  let depth = 0;
  let skipping = false;

  for (const line of unfold(text)) {
    const property = parseLine(line);
    if (!property) continue;

    if (property.name === 'BEGIN') {
      const component = property.value.toUpperCase();

      if (skipping || (current !== null && component !== 'VEVENT')) {
        depth += 1;
        continue;
      }
      if (component === 'VEVENT') {
        current = [];
        depth = 0;
        continue;
      }
      if (component === 'VTIMEZONE') {
        skipping = true;
        depth = 0;
        continue;
      }
      continue;
    }

    if (property.name === 'END') {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
      if (skipping) {
        skipping = false;
        continue;
      }
      if (current !== null && property.value.toUpperCase() === 'VEVENT') {
        const event = toEvent(current);
        if (event) events.push(event);
        current = null;
      }
      continue;
    }

    if (current !== null && depth === 0 && !skipping) current.push(property);
  }

  return events;
}

function toEvent(properties: readonly IcsProperty[]): IcsEvent | null {
  const find = (name: string) => properties.find((property) => property.name === name);

  const uid = find('UID')?.value.trim() ?? '';
  // No UID, no identity, and identity is the whole basis of importing the same
  // feed twice without duplicating it.
  if (uid === '') return null;

  const dtstart = find('DTSTART');
  const dtend = find('DTEND');

  return {
    uid,
    summary: unescapeText(find('SUMMARY')?.value ?? '').trim(),
    description: unescapeText(find('DESCRIPTION')?.value ?? '').trim(),
    location: unescapeText(find('LOCATION')?.value ?? '').trim(),
    url: find('URL')?.value.trim() ?? '',
    start: dtstart ? parseMoment(dtstart) : null,
    end: dtend ? parseMoment(dtend) : null,
    properties: [...properties],
  };
}

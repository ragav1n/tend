/**
 * A small markdown subset for task notes.
 *
 * Not a dependency, because the parsers worth having are 30 to 50kb gzipped and
 * this app's whole argument is a cold start fast enough to feel native. Notes on
 * a task are a few lines, not a document, so the subset below covers what people
 * actually type and nothing else.
 *
 * Supported: `#` to `###` headings, `-` and `*` bullets, `1.` numbered lists,
 * `>` quotes, `---` rules, fenced code, `**bold**`, `*italic*`, `_italic_`,
 * `` `code` ``, `[text](url)` and bare http links.
 *
 * It emits a tree rather than an HTML string, so the renderer builds React
 * elements and there is no `dangerouslySetInnerHTML` anywhere near user text.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; children: Inline[] };

export type Block =
  | { kind: 'paragraph'; children: Inline[] }
  | { kind: 'heading'; level: 1 | 2 | 3; children: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'quote'; children: Inline[] }
  | { kind: 'rule' }
  | { kind: 'codeblock'; text: string };

/**
 * One pass over the inline markers, longest first so `**bold**` is never read as
 * two italics. Code spans come first for the same reason: nothing inside
 * backticks is markup.
 */
const INLINE = new RegExp(
  [
    '`([^`\\n]+)`', // 1 code
    '\\*\\*([^*\\n]+)\\*\\*', // 2 strong
    '\\*([^*\\n]+)\\*', // 3 em
    '_([^_\\n]+)_', // 4 em
    '\\[([^\\]\\n]+)\\]\\(([^)\\s]+)\\)', // 5 text, 6 href
    '(https?://[^\\s<>()]+)', // 7 autolink
  ].join('|'),
  'g',
);

/**
 * Anything that is not http, https or mailto is dropped to plain text.
 * `javascript:` in an href still executes when React renders it, so the check
 * has to happen here rather than being left to the renderer.
 */
function safeHref(href: string): string | null {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href.trim());
  if (!scheme) return href.startsWith('//') ? null : href;
  return /^(https?|mailto)$/i.test(scheme[1]!) ? href : null;
}

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;

  // matchAll rather than a manual exec loop, because this function recurses into
  // its own matches. A shared global regex driven by exec would have its
  // lastIndex rewound by the inner call and re-match the same position forever.
  // matchAll clones the regex, so each level iterates its own cursor.
  for (const m of source.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: 'text', text: source.slice(last, at) });
    last = at + m[0].length;

    if (m[1] !== undefined) {
      out.push({ kind: 'code', text: m[1] });
    } else if (m[2] !== undefined) {
      out.push({ kind: 'strong', children: parseInline(m[2]) });
    } else if (m[3] !== undefined) {
      out.push({ kind: 'em', children: parseInline(m[3]) });
    } else if (m[4] !== undefined) {
      out.push({ kind: 'em', children: parseInline(m[4]) });
    } else if (m[5] !== undefined && m[6] !== undefined) {
      const href = safeHref(m[6]);
      if (href) out.push({ kind: 'link', href, children: parseInline(m[5]) });
      else out.push({ kind: 'text', text: m[0] });
    } else if (m[7] !== undefined) {
      out.push({ kind: 'link', href: m[7], children: [{ kind: 'text', text: m[7] }] });
    }
  }

  if (last < source.length) out.push({ kind: 'text', text: source.slice(last) });
  return out;
}

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const RULE = /^(-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE = /^```/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  function flushParagraph() {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', children: parseInline(paragraph.join('\n')) });
    paragraph = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (FENCE.test(line)) {
      flushParagraph();
      const body: string[] = [];
      i += 1;
      // An unterminated fence runs to the end rather than falling back to
      // paragraphs, because that is what the person typing it meant.
      while (i < lines.length && !FENCE.test(lines[i]!)) body.push(lines[i++]!);
      blocks.push({ kind: 'codeblock', text: body.join('\n') });
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      continue;
    }

    if (RULE.test(line)) {
      flushParagraph();
      blocks.push({ kind: 'rule' });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length as 1 | 2 | 3,
        children: parseInline(heading[2]!),
      });
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      flushParagraph();
      blocks.push({ kind: 'quote', children: parseInline(quote[1]!) });
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = numbered !== null && bullet === null;
      const items: Inline[][] = [];
      // Consume the whole run, so a five-item list is one <ul> rather than five.
      while (i < lines.length) {
        const next = lines[i]!;
        const asBullet = BULLET.exec(next);
        const asNumbered = NUMBERED.exec(next);
        const matched = ordered ? (asBullet ? null : asNumbered) : asBullet;
        if (!matched) break;
        items.push(parseInline(matched[1]!));
        i += 1;
      }
      i -= 1;
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}

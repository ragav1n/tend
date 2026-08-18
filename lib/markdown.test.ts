import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, type Block, type Inline } from './markdown';

/** Flattens a tree back to its text, which is what most assertions care about. */
function textOf(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.kind) {
        case 'text':
          return n.text;
        case 'code':
          return n.text;
        default:
          return textOf(n.children);
      }
    })
    .join('');
}

function kinds(blocks: Block[]): string[] {
  return blocks.map((b) => b.kind);
}

describe('inline markup', () => {
  it('reads bold before italic, so ** is never two *', () => {
    const nodes = parseInline('a **bold** b');
    expect(nodes.map((n) => n.kind)).toEqual(['text', 'strong', 'text']);
    expect(textOf(nodes)).toBe('a bold b');
  });

  it('treats both * and _ as italic', () => {
    expect(parseInline('*one*')[0]).toMatchObject({ kind: 'em' });
    expect(parseInline('_one_')[0]).toMatchObject({ kind: 'em' });
  });

  it('leaves markup inside a code span alone', () => {
    const nodes = parseInline('use `**not bold**` here');
    expect(nodes[1]).toEqual({ kind: 'code', text: '**not bold**' });
  });

  it('parses a labelled link', () => {
    const nodes = parseInline('see [the docs](https://example.com/x)');
    expect(nodes[1]).toMatchObject({ kind: 'link', href: 'https://example.com/x' });
    expect(textOf(nodes)).toBe('see the docs');
  });

  it('autolinks a bare url', () => {
    const nodes = parseInline('go to https://example.com now');
    expect(nodes[1]).toMatchObject({ kind: 'link', href: 'https://example.com' });
  });

  it('refuses a javascript: href and keeps the source as text', () => {
    // React renders href verbatim, so a scheme check here is the only thing
    // between a pasted note and a script running on click.
    const nodes = parseInline('[click](javascript:alert(1))');
    expect(nodes.every((n) => n.kind !== 'link')).toBe(true);
    expect(textOf(nodes)).toBe('[click](javascript:alert(1))');
  });

  it('allows mailto', () => {
    expect(parseInline('[mail](mailto:a@b.co)')[0]).toMatchObject({
      kind: 'link',
      href: 'mailto:a@b.co',
    });
  });

  it('nests emphasis inside a link label', () => {
    const nodes = parseInline('[a **b**](https://x.co)');
    const link = nodes[0];
    expect(link?.kind).toBe('link');
    if (link?.kind === 'link') {
      expect(link.children.map((c) => c.kind)).toEqual(['text', 'strong']);
    }
  });
});

describe('blocks', () => {
  it('splits paragraphs on a blank line', () => {
    expect(kinds(parseMarkdown('one\n\ntwo'))).toEqual(['paragraph', 'paragraph']);
  });

  it('keeps a single newline inside one paragraph', () => {
    const blocks = parseMarkdown('one\ntwo');
    expect(blocks).toHaveLength(1);
    expect(textOf((blocks[0] as { children: Inline[] }).children)).toBe('one\ntwo');
  });

  it('reads the three heading levels and nothing deeper', () => {
    expect(parseMarkdown('# a')[0]).toMatchObject({ kind: 'heading', level: 1 });
    expect(parseMarkdown('### a')[0]).toMatchObject({ kind: 'heading', level: 3 });
    expect(parseMarkdown('#### a')[0]).toMatchObject({ kind: 'paragraph' });
  });

  it('gathers a run of bullets into one list', () => {
    const blocks = parseMarkdown('- one\n- two\n- three');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: false });
    expect((blocks[0] as { items: Inline[][] }).items).toHaveLength(3);
  });

  it('gathers numbered items into an ordered list', () => {
    const blocks = parseMarkdown('1. one\n2. two');
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: true });
    expect((blocks[0] as { items: Inline[][] }).items).toHaveLength(2);
  });

  it('does not swallow the line after a list', () => {
    expect(kinds(parseMarkdown('- one\n- two\nafter'))).toEqual(['list', 'paragraph']);
  });

  it('reads quotes, rules and fenced code', () => {
    expect(kinds(parseMarkdown('> quoted'))).toEqual(['quote']);
    expect(kinds(parseMarkdown('---'))).toEqual(['rule']);
    expect(parseMarkdown('```\nx = 1\n```')[0]).toEqual({ kind: 'codeblock', text: 'x = 1' });
  });

  it('runs an unterminated fence to the end rather than falling back', () => {
    expect(parseMarkdown('```\nstill code')[0]).toEqual({
      kind: 'codeblock',
      text: 'still code',
    });
  });

  it('leaves markup inside a fence unparsed', () => {
    const blocks = parseMarkdown('```\n# not a heading\n```');
    expect(blocks).toEqual([{ kind: 'codeblock', text: '# not a heading' }]);
  });

  it('returns nothing for empty input', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('   \n\n  ')).toEqual([]);
  });

  it('normalizes CRLF, so a paste from Windows still splits', () => {
    expect(kinds(parseMarkdown('one\r\n\r\ntwo'))).toEqual(['paragraph', 'paragraph']);
  });
});

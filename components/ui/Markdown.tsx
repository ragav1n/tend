import { Fragment } from 'react';
import { parseMarkdown, type Block, type Inline } from '@/lib/markdown';
import { cn } from '@/lib/utils';

/**
 * Renders the note subset from `lib/markdown.ts` as React elements.
 *
 * Every node is built with JSX, so user text can never become markup. Links open
 * in a new tab with `noreferrer`, since a note in a task app is a bookmark far
 * more often than it is navigation.
 */

function renderInline(nodes: Inline[]): React.ReactNode {
  return nodes.map((node, i) => {
    switch (node.kind) {
      case 'text':
        return <Fragment key={i}>{node.text}</Fragment>;
      case 'strong':
        return (
          <strong key={i} className="font-semibold text-text-hi">
            {renderInline(node.children)}
          </strong>
        );
      case 'em':
        return (
          <em key={i} className="italic">
            {renderInline(node.children)}
          </em>
        );
      case 'code':
        return (
          <code
            key={i}
            className="rounded-[5px] bg-sunken px-1 py-px font-mono text-[0.8125em] text-text-hi"
          >
            {node.text}
          </code>
        );
      case 'link':
        return (
          <a
            key={i}
            href={node.href}
            target="_blank"
            rel="noreferrer"
            className="text-clay-300 underline underline-offset-2 hover:text-clay-200"
          >
            {renderInline(node.children)}
          </a>
        );
    }
  });
}

const HEADING_CLASS = {
  1: 'text-base',
  2: 'text-[0.9375rem]',
  3: 'text-sm',
} as const;

function renderBlock(block: Block, key: number): React.ReactNode {
  switch (block.kind) {
    case 'paragraph':
      // whitespace-pre-line keeps a single newline as a line break, which is
      // what someone typing a note expects even though markdown says otherwise.
      return (
        <p key={key} className="whitespace-pre-line">
          {renderInline(block.children)}
        </p>
      );
    case 'heading': {
      const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3';
      return (
        <Tag key={key} className={cn('font-semibold', HEADING_CLASS[block.level])}>
          {renderInline(block.children)}
        </Tag>
      );
    }
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag
          key={key}
          className={cn(
            'space-y-1 pl-5',
            block.ordered ? 'list-decimal' : 'list-disc',
            'marker:text-text-faint',
          )}
        >
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </Tag>
      );
    }
    case 'quote':
      return (
        <blockquote key={key} className="border-l-2 border-line-bright pl-3 text-text-lo">
          {renderInline(block.children)}
        </blockquote>
      );
    case 'rule':
      return <hr key={key} className="border-line" />;
    case 'codeblock':
      return (
        <pre
          key={key}
          className="overflow-x-auto rounded-md bg-sunken p-3 font-mono text-xs text-text-mid"
          style={{ boxShadow: 'var(--shadow-sunken)' }}
        >
          <code>{block.text}</code>
        </pre>
      );
  }
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className={cn('space-y-2 text-sm leading-relaxed text-text-mid', className)}>
      {blocks.map(renderBlock)}
    </div>
  );
}

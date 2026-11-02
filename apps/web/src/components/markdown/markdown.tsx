import Link from "next/link";
import type { ReactNode } from "react";

import { type Block, type Inline, parseMarkdown } from "@/utils/markdown";

type MarkdownProps = {
  text: string;
  /** Renders plain text runs, for example to turn `[S1]` into source links. */
  renderText?: (text: string, key: string) => ReactNode;
};

/**
 * Model output as formatted text. Parsed into data first and rendered as React elements, so
 * nothing in the text is ever interpreted as HTML; links are limited to web, mail, and in-app
 * addresses.
 */
export function Markdown({ text, renderText }: MarkdownProps) {
  const blocks = parseMarkdown(text);
  return (
    <div className="space-y-3 text-sm leading-relaxed text-pretty">
      {blocks.map((block, index) => renderBlock(block, `b${index}`, renderText))}
    </div>
  );
}

function renderBlock(
  block: Block,
  key: string,
  renderText: MarkdownProps["renderText"],
): ReactNode {
  const inline = (children: Inline[]) => renderInline(children, key, renderText);
  switch (block.type) {
    case "heading": {
      const className = "font-semibold text-foreground";
      if (block.level === 1)
        return (
          <h3 key={key} className={`text-base ${className}`}>
            {inline(block.children)}
          </h3>
        );
      if (block.level === 2)
        return (
          <h4 key={key} className={`text-sm ${className}`}>
            {inline(block.children)}
          </h4>
        );
      return (
        <h5 key={key} className={`text-sm ${className}`}>
          {inline(block.children)}
        </h5>
      );
    }
    case "paragraph":
      return <p key={key}>{inline(block.children)}</p>;
    case "list": {
      const items = block.items.map((item, index) => (
        <li key={`${key}-${index}`}>{renderInline(item, `${key}-${index}`, renderText)}</li>
      ));
      return block.ordered ? (
        <ol key={key} className="list-decimal space-y-1 pl-5">
          {items}
        </ol>
      ) : (
        <ul key={key} className="list-disc space-y-1 pl-5">
          {items}
        </ul>
      );
    }
    case "quote":
      return (
        <blockquote key={key} className="border-l-2 pl-3 text-muted-foreground">
          {inline(block.children)}
        </blockquote>
      );
    case "code":
      return (
        <pre
          key={key}
          className="overflow-x-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs leading-normal"
        >
          <code>{block.text}</code>
        </pre>
      );
    case "rule":
      return <hr key={key} className="border-border" />;
  }
}

function renderInline(
  nodes: Inline[],
  key: string,
  renderText: MarkdownProps["renderText"],
): ReactNode[] {
  return nodes.map((node, index) => {
    const id = `${key}-${index}`;
    switch (node.type) {
      case "text":
        return renderText ? renderText(node.text, id) : node.text;
      case "strong":
        return <strong key={id}>{renderInline(node.children, id, renderText)}</strong>;
      case "em":
        return <em key={id}>{renderInline(node.children, id, renderText)}</em>;
      case "code":
        return (
          <code key={id} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
            {node.text}
          </code>
        );
      case "link":
        return node.href.startsWith("/") ? (
          <Link key={id} href={node.href} className="text-brand underline-offset-2 hover:underline">
            {renderInline(node.children, id, renderText)}
          </Link>
        ) : (
          <a
            key={id}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-brand underline-offset-2 hover:underline"
          >
            {renderInline(node.children, id, renderText)}
          </a>
        );
    }
  });
}

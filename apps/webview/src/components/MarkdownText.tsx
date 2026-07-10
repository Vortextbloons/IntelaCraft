import { renderSafeMarkdown } from "../utils/format";

export function MarkdownText({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={className ?? "md-text"}
      dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(text) }}
    />
  );
}

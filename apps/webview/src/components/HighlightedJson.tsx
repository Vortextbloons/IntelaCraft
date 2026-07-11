import type { ReactNode } from "react";

/** Tokenize a JSON string into colored spans (keys, strings, numbers, etc.). */
export function HighlightedJson({
  value,
  className = "",
}: {
  value: unknown;
  className?: string;
}) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return <pre className={`json-hl ${className}`.trim()}>{tokenizeJson(text)}</pre>;
}

function tokenizeJson(src: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re =
    /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b|\bnull\b)|([{}[\]:,])|(\s+)|([^"\s{}[\]:,]+)/g;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(src)) !== null) {
    const [full, str, colon, num, lit, punct, space, other] = match;
    if (str !== undefined) {
      if (colon !== undefined) {
        nodes.push(
          <span key={key++} className="json-key">
            {str}
          </span>,
        );
        nodes.push(
          <span key={key++} className="json-punct">
            {colon}
          </span>,
        );
      } else {
        nodes.push(
          <span key={key++} className="json-string">
            {str}
          </span>,
        );
      }
    } else if (num !== undefined) {
      nodes.push(
        <span key={key++} className="json-number">
          {num}
        </span>,
      );
    } else if (lit !== undefined) {
      nodes.push(
        <span key={key++} className="json-literal">
          {lit}
        </span>,
      );
    } else if (punct !== undefined) {
      nodes.push(
        <span key={key++} className="json-punct">
          {punct}
        </span>,
      );
    } else if (space !== undefined) {
      nodes.push(space);
    } else if (other !== undefined) {
      nodes.push(other);
    } else {
      nodes.push(full);
    }
  }
  return nodes;
}

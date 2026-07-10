import { useEffect, useState } from "react";

export function ReasoningBlock({
  text,
  streaming,
}: {
  text: string;
  streaming?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(streaming));

  useEffect(() => {
    if (streaming) setOpen(true);
    else setOpen(false);
  }, [streaming]);

  if (!text.trim() && !streaming) return null;

  return (
    <div className={`reasoning-block ${streaming ? "streaming" : ""}`}>
      <button
        type="button"
        className="reasoning-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="reasoning-label">{streaming ? "Thinking…" : "Thinking"}</span>
        <span className="chev" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && <pre className="reasoning-body">{text || (streaming ? "…" : "")}</pre>}
    </div>
  );
}

export function ConnDot({
  label,
  state,
}: {
  label: string;
  state: "ok" | "warn" | "bad" | "off";
}) {
  return (
    <span className="conn-dot">
      <span className={`dot ${state}`} aria-hidden />
      <span>{label}</span>
    </span>
  );
}

export function ConnectionStrip({
  bds,
  model,
  session,
  mcp,
  emergency,
}: {
  bds: boolean;
  model: boolean;
  session: boolean;
  mcp: { configured?: boolean; available?: boolean } | undefined;
  emergency: boolean;
}) {
  return (
    <div className="conn-row" role="status">
      <ConnDot label="BDS" state={bds ? "ok" : "bad"} />
      <ConnDot label="Model" state={model ? "ok" : "bad"} />
      <ConnDot label="Pi" state={session ? "ok" : "warn"} />
      <ConnDot label="MCP" state={mcp?.available ? "ok" : mcp?.configured ? "warn" : "off"} />
      {emergency && <ConnDot label="EMERGENCY" state="bad" />}
    </div>
  );
}

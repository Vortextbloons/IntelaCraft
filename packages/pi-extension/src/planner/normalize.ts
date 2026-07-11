import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentAction, AgentPlan } from "../types.js";

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* continue */
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* continue */
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  throw new Error("Model plan was not valid JSON");
}

function asActionList(value: unknown, normalizeInspectionName = false): AgentAction[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const rawToolName = String(row.toolName ?? row.tool ?? row.name ?? "").trim();
      // Providers expose native function names with underscores, but plans use
      // the dotted controller names. Accept that provider-safe alias only for
      // read-only inspection/verification steps.
      const toolName = normalizeInspectionName && rawToolName.startsWith("inspect_")
        ? rawToolName.replace("_", ".")
        : rawToolName;
      if (!toolName) return null;
      const args =
        row.arguments && typeof row.arguments === "object" && !Array.isArray(row.arguments)
          ? (row.arguments as Record<string, unknown>)
          : row.params && typeof row.params === "object" && !Array.isArray(row.params)
            ? (row.params as Record<string, unknown>)
            : {};
      const action: AgentAction = {
        ...(typeof row.id === "string" ? { id: row.id } : {}),
        toolName,
        arguments: args,
        summary: String(row.summary ?? row.description ?? toolName),
        ...(Array.isArray(row.dependsOn) ? { dependsOn: row.dependsOn.filter((id): id is string => typeof id === "string") } : {}),
      };
      return action;
    })
    .filter((x): x is AgentAction => Boolean(x));
}

/** Coerce messy model output into a valid AgentPlan. */
export function normalizePlan(raw: unknown, userRequest: string): AgentPlan {
  const p =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : ({} as Record<string, unknown>);
  const summary = String(p.summary ?? p.message ?? p.reply ?? p.response ?? "").trim();
  const inspection = asActionList(p.inspection ?? p.inspect ?? p.reads, true);
  const actions = asActionList(p.actions ?? p.writes ?? p.mutations);
  const verification = asActionList(p.verification ?? p.verify ?? p.checks, true);
  const notes = Array.isArray(p.notes) ? p.notes.map(String) : [];
  const successCriteria = Array.isArray(p.successCriteria) ? p.successCriteria.map(String) : [];
  const evidence = Array.isArray(p.evidence) ? p.evidence.map(String) : [];
  const requestedOutcome = String(p.outcome ?? "");
  const outcome = (["respond", "propose", "complete", "blocked"] as const).includes(requestedOutcome as any)
    ? (requestedOutcome as AgentPlan["outcome"])
    : actions.length > 0 ? "propose" : evidence.length > 0 ? "complete" : "respond";

  const plan: AgentPlan = {
    summary:
      summary ||
      (inspection.length || actions.length
        ? "Plan ready."
        : `Got it — ask me to inspect the world or plan a bounded build.`),
    outcome,
    inspection,
    actions,
    verification,
    notes,
    successCriteria,
    evidence,
  };
  const semantic = actions.filter((a) => a.toolName.startsWith("build."));
  if (semantic.length) {
    plan.build = {
      palette: [],
      steps: semantic.map((step, index) => ({ id: step.id ?? `build-${index + 1}`, summary: step.summary, toolName: step.toolName, arguments: step.arguments, dependsOn: step.dependsOn ?? (index ? [semantic[index - 1].id ?? `build-${index}`] : undefined) })),
      estimates: { blocksChanged: 0, operations: semantic.length },
      warnings: [],
    };
  }

  const casual = /^(hi|hello|hey|thanks|thank you|yo|sup|ok|okay)\b/i.test(userRequest.trim());
  if (casual && !inspection.length && !actions.length && !verification.length) {
    if (!notes.length) {
      plan.notes = ["I can check players, time, weather, or plan fills for approval."];
    }
  }
  return plan;
}

export function assistantTextFromSession(session: AgentSession): string {
  const messages = session.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; content?: unknown };
    if (m?.role !== "assistant") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      return m.content
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object" && (part as { type?: string }).type === "text") {
            return String((part as { text?: string }).text ?? "");
          }
          return "";
        })
        .join("");
    }
  }
  return "";
}

export { extractJsonObject };

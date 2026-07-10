/**
 * Versioned IntelaCraft planner prompts.
 * The live Pi session still loads these via @intelacraft/pi-extension;
 * keep wording changes here and re-export from the extension.
 */

export const PROMPT_VERSION = "1.1.0";

export function wrapUntrusted(tag: string, value: unknown): string {
  return `<${tag}>\n${JSON.stringify(value ?? null, null, 2)}\n</${tag}>`;
}

export function adminAllowlistSection(commandIds: string[]): string {
  if (!commandIds.length) {
    return "## Admin command allowlist\n(none configured — do not propose admin.run_command)";
  }
  return `## Admin command allowlist (commandId only)\n${commandIds.map((id) => `- ${id}`).join("\n")}`;
}

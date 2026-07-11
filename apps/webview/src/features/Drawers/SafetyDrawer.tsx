import { MODES } from "../../constants";
import { THINKING_LEVELS, THINKING_LEVEL_LABELS, type ReasoningCapabilities, type ThinkingLevel } from "../../types";

type SafetyDrawerProps = {
  permissionMode: string;
  thinkingLevel: ThinkingLevel;
  modelCapabilities: ReasoningCapabilities;
  busy: boolean;
  emergencyOn: boolean;
  onPatchMode: (mode: string) => void;
  onPatchThinking: (level: ThinkingLevel) => void;
  onEmergency: (disabled: boolean) => void;
};

export function SafetyDrawer({
  permissionMode,
  thinkingLevel,
  modelCapabilities,
  busy,
  emergencyOn,
  onPatchMode,
  onPatchThinking,
  onEmergency,
}: SafetyDrawerProps) {
  return (
    <div className="stack">
      <h2>Safety</h2>
      <label>
        Permission mode
        <select value={permissionMode} onChange={(e) => void onPatchMode(e.target.value)}>
          {MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label>
        Thinking level
        <select
          value={thinkingLevel}
          onChange={(e) => void onPatchThinking(e.target.value as ThinkingLevel)}
        >
          {(modelCapabilities.levels.length > 0 ? modelCapabilities.levels : THINKING_LEVELS).map((m) => (
            <option key={m} value={m}>
              {THINKING_LEVEL_LABELS[m] ?? m}
            </option>
          ))}
        </select>
        {modelCapabilities.source !== "unknown" && (
          <span className="hint">
            {modelCapabilities.supported ? "Reasoning supported" : "No reasoning support"}
            {modelCapabilities.source === "override" ? " (known model)" : ""}
          </span>
        )}
      </label>
      <div className="row">
        <button className="danger" type="button" disabled={busy} onClick={() => void onEmergency(true)}>
          Emergency disable
        </button>
        <button type="button" disabled={busy || !emergencyOn} onClick={() => void onEmergency(false)}>
          Clear
        </button>
      </div>
    </div>
  );
}

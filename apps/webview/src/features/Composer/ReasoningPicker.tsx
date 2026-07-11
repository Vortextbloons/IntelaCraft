import { THINKING_LEVEL_LABELS, type ReasoningCapabilities, type ThinkingLevel } from "../../types";

type ReasoningPickerProps = {
  thinkingLevel: ThinkingLevel;
  modelCapabilities: ReasoningCapabilities;
  busy: boolean;
  onPatchThinking: (level: ThinkingLevel) => void;
  onClose: () => void;
};

export function ReasoningPicker({
  thinkingLevel,
  modelCapabilities,
  busy,
  onPatchThinking,
  onClose,
}: ReasoningPickerProps) {
  return (
    <div className="reasoning-menu" role="listbox" aria-label="Reasoning effort">
      {modelCapabilities.levels.map((level) => (
        <button
          key={level}
          type="button"
          role="option"
          aria-selected={thinkingLevel === level}
          className={thinkingLevel === level ? "reasoning-option active" : "reasoning-option"}
          disabled={busy}
          onClick={() => {
            void onPatchThinking(level);
            onClose();
          }}
        >
          {THINKING_LEVEL_LABELS[level] ?? level}
        </button>
      ))}
    </div>
  );
}

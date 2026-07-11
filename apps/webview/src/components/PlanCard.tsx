import type { Task } from "../types";
import { taskNeedsApproval } from "../types";
import { estimateFillBlocks, summarizeArgs } from "../utils/format";
import { HighlightedJson } from "./HighlightedJson";

export function PlanCard({
  task,
  busy,
  onApprove,
  onReject,
  onCancel,
  onEditReplan,
}: {
  task: Task;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onCancel: () => void;
  onEditReplan: () => void;
}) {
  const mutations = (task.proposedActions ?? []).filter((a) => a.risk !== "read");
  const inspection = task.plan?.inspection ?? [];
  const verification = task.plan?.verification ?? [];
  const needsApproval = taskNeedsApproval(task);
  const canCancel = ["inspecting", "awaiting_approval", "running", "planned", "partial", "verifying"].includes(
    task.state,
  );

  return (
    <div className="plan-card">
      <div className="plan-card-head">
        <strong>Plan</strong>
        <span className={`plan-state state-${task.state}`}>{task.state.replace(/_/g, " ")}</span>
      </div>

      {inspection.length > 0 && (
        <section className="plan-section">
          <div className="plan-section-title">Inspect</div>
          {inspection.map((step, i) => (
            <div key={`insp-${i}`} className="plan-step inspect">
              <strong>{step.toolName}</strong>
              <div className="meta">
                {step.summary}
                {step.arguments ? ` · ${summarizeArgs(step.arguments)}` : ""}
              </div>
            </div>
          ))}
        </section>
      )}

      {mutations.length > 0 && (
        <section className="plan-section">
          <div className="plan-section-title">Mutations</div>
          {mutations.map((a) => {
            const blocks = a.toolName === "world.fill_blocks"
              ? estimateFillBlocks(a.arguments)
              : a.toolName === "world.place_blocks" && Array.isArray(a.arguments.blocks)
                ? a.arguments.blocks.length
                : null;
            const region = a.arguments.region as
              | { min?: { x: number; y: number; z: number }; max?: { x: number; y: number; z: number } }
              | undefined;
            const dim = typeof a.arguments.dimension === "string" ? a.arguments.dimension : undefined;
            const rollback = a.arguments.captureRollback === true;
            return (
              <div
                key={a.actionId}
                className={`plan-step mutate risk-${a.risk}`}
              >
                <div className="plan-step-head">
                  <strong>{a.toolName}</strong>
                  <span className={`risk-badge risk-${a.risk}`}>{a.risk}</span>
                </div>
                <div className="plan-facts">
                  {dim && (
                    <span>
                      Dimension <code>{String(dim).replace(/^minecraft:/, "")}</code>
                    </span>
                  )}
                  {region?.min && region?.max && (
                    <span>
                      Bounds{" "}
                      <code>
                        {region.min.x},{region.min.y},{region.min.z} → {region.max.x},{region.max.y},
                        {region.max.z}
                      </code>
                    </span>
                  )}
                  {blocks != null && (
                    <span>
                      Est. impact <code>{blocks.toLocaleString()} blocks</code>
                    </span>
                  )}
                  {a.toolName === "world.place_blocks" && Array.isArray(a.arguments.blocks) && (
                    <span>
                      Operation <code>detailed placement</code>
                    </span>
                  )}
                  <span>
                    Rollback <code>{rollback ? "captured" : "not requested"}</code>
                  </span>
                </div>
                <details className="plan-args">
                  <summary>Arguments</summary>
                  <HighlightedJson value={a.arguments} />
                </details>
              </div>
            );
          })}
        </section>
      )}

      {verification.length > 0 && (
        <section className="plan-section">
          <div className="plan-section-title">Verify</div>
          {verification.map((step, i) => (
            <div key={`ver-${i}`} className="plan-step verify">
              <strong>{step.toolName}</strong>
              <div className="meta">
                {step.summary}
                {step.arguments ? ` · ${summarizeArgs(step.arguments)}` : ""}
              </div>
            </div>
          ))}
        </section>
      )}

      {task.preview && (
        <section className="plan-section">
          <div className="plan-section-title">Construction preview</div>
          <div className="plan-facts">
            <span>Changed <code>{task.preview.generatedBlocks.toLocaleString()} blocks</code></span>
            <span>Batches <code>{task.preview.estimatedBatches}</code></span>
            <span>Rollback <code>{Math.round(task.preview.rollbackCoverage * 100)}%</code></span>
          </div>
          <div className="meta">Materials: {Object.entries(task.preview.materials).map(([type,count]) => `${type.replace(/^minecraft:/, "")} × ${count}`).join(", ")}</div>
          {task.preview.warnings.map((warning, i) => <div key={i} className="meta">Warning: {warning}</div>)}
        </section>
      )}

      {task.plan?.build && (
        <section className="plan-section">
          <div className="plan-section-title">Build steps</div>
          {task.plan.build.steps.map((step) => <div key={step.id} className="plan-step mutate"><strong>{step.id}: {step.summary}</strong><div className="meta">{step.toolName}{step.dependsOn?.length ? ` · after ${step.dependsOn.join(", ")}` : ""}</div></div>)}
        </section>
      )}

      {(task.plan?.successCriteria?.length ?? 0) > 0 && (
        <section className="plan-section">
          <div className="plan-section-title">Success criteria</div>
          {task.plan!.successCriteria!.map((criterion, i) => <div key={`criterion-${i}`} className="meta">â€¢ {criterion}</div>)}
        </section>
      )}

      {(task.plan?.evidence?.length ?? 0) > 0 && (
        <section className="plan-section">
          <div className="plan-section-title">Verification evidence</div>
          {task.plan!.evidence!.map((item, i) => <div key={`evidence-${i}`} className="meta">â€¢ {item}</div>)}
        </section>
      )}

      {(task.plan?.notes?.length ?? 0) > 0 && (
        <div className="meta plan-notes">{task.plan!.notes!.join(" · ")}</div>
      )}

      <div className="row plan-actions">
        {needsApproval && (
          <button className="primary" type="button" disabled={busy} onClick={onApprove}>
            Approve
          </button>
        )}
        {needsApproval && (
          <button type="button" disabled={busy} onClick={onReject}>
            Reject
          </button>
        )}
        {needsApproval && (
          <button type="button" disabled={busy} onClick={onEditReplan}>
            Edit &amp; replan
          </button>
        )}
        {canCancel && (
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

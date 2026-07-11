import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@intelacraft/shared-protocol";
import { buildSystemPrompt } from "../planner/prompts.js";
import { createInspectionTools, createSubmitPlanTool, createCatalogTools } from "../planner/tools.js";
import { clampThinkingLevel } from "../reasoning.js";
import { sanitizeProviderId, writeModelsJson } from "./models-json.js";
import { embedded, type EmbeddedPi } from "./store.js";
import type { PiSession, ProviderProfile } from "../types.js";

export function createPiSession(root: string, provider: ProviderProfile): PiSession {
  const id = `pi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const storagePath = resolve(root, id);
  mkdirSync(storagePath, { recursive: true });
  const piProvider = sanitizeProviderId(provider.id);
  return {
    id,
    providerId: provider.id,
    model: provider.model,
    storagePath,
    createdAt: new Date().toISOString(),
    piProvider,
    mode: "ask",
  };
}

export async function initializePiSession(
  info: PiSession,
  provider: ProviderProfile,
  thinkingLevel: ThinkingLevel = info.thinkingLevel ?? "off",
): Promise<void> {
  disposePiSession(info.id);
  const piProvider = info.piProvider ?? sanitizeProviderId(provider.id);
  info.piProvider = piProvider;

  const auth = AuthStorage.create(resolve(info.storagePath, "auth.json"));
  auth.set(piProvider, { type: "api_key", key: provider.apiKey });
  auth.setRuntimeApiKey(piProvider, provider.apiKey);

  // Look up Pi's built-in catalog for real model capabilities
  const builtinRegistry = ModelRegistry.inMemory(auth);
  builtinRegistry.refresh();
  // Search across all providers since our sanitized ID won't match built-in provider names
  const builtinModel = builtinRegistry.getAll().find((m) =>
    m.id === provider.model &&
    (m.provider === "opencode" || m.provider === "opencode-go" || m.baseUrl === provider.baseUrl.replace(/\/$/, "")),
  ) ?? builtinRegistry.getAll().find((m) => m.id === provider.model);

  // Clamp using built-in metadata when available. `off` is intentional and
  // must never be promoted to a model default: callers use it to disable
  // reasoning for the next turn.
  const clamped = builtinModel
    ? clampThinkingLevel(provider.model, thinkingLevel, builtinModel, provider)
    : clampThinkingLevel(provider.model, thinkingLevel, undefined, provider);
  info.thinkingLevel = clamped;

  writeModelsJson(info.storagePath, piProvider, provider, clamped, builtinModel ?? undefined);

  const modelRegistry = ModelRegistry.create(auth, resolve(info.storagePath, "models.json"));
  modelRegistry.refresh();
  const model = modelRegistry.find(piProvider, provider.model);
  if (!model) {
    throw new Error(
      `Pi could not load model ${provider.model} for provider ${piProvider}. Check baseUrl/model.`,
    );
  }

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: { enabled: true, maxRetries: 2 },
  });

  const box: EmbeddedPi = {
    session: null as unknown as AgentSession,
    provider,
    piProvider,
    lastPlan: undefined,
  };
  const submitPlan = createSubmitPlanTool((plan) => {
    box.lastPlan = plan;
  });
  const inspectionTools = createInspectionTools(info.id);
  const catalogTools = createCatalogTools(info.id);

  const loader = new DefaultResourceLoader({
    cwd: info.storagePath,
    agentDir: info.storagePath,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => buildSystemPrompt(),
    appendSystemPromptOverride: () => [],
  });
  await loader.reload();

  const { session } = await createAgentSession({
    cwd: info.storagePath,
    agentDir: info.storagePath,
    model,
    thinkingLevel: clamped,
    authStorage: auth,
    modelRegistry,
    noTools: "builtin",
    tools: ["submit_plan", ...inspectionTools.map((tool) => tool.name), ...catalogTools.map((tool) => tool.name)],
    customTools: [submitPlan, ...inspectionTools, ...catalogTools],
    resourceLoader: loader,
    sessionManager: SessionManager.create(info.storagePath),
    settingsManager,
  });

  box.session = session;
  embedded.set(info.id, box);
}

/** Update provider credentials/model on an existing Pi session. */
export async function refreshPiSessionProvider(
  info: PiSession,
  provider: ProviderProfile,
  thinkingLevel?: ThinkingLevel,
): Promise<void> {
  const emb = embedded.get(info.id);
  const level = thinkingLevel ?? info.thinkingLevel ?? "off";
  if (!emb) {
    await initializePiSession(info, provider, level);
    return;
  }
  if (
    emb.provider.baseUrl === provider.baseUrl &&
    emb.provider.model === provider.model &&
    emb.provider.apiKey === provider.apiKey &&
    info.thinkingLevel === level
  ) {
    return;
  }
  await initializePiSession(info, provider, level);
  info.model = provider.model;
  info.providerId = provider.id;
}

export function disposePiSession(id: string): void {
  const emb = embedded.get(id);
  if (emb) {
    try {
      emb.session.dispose();
    } catch {
      /* ignore */
    }
    embedded.delete(id);
  }
}

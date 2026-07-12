import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentPlan, InspectionExecutor, CatalogExecutor, BuildExecutor, BuildSaveExecutor, ProviderProfile } from "../types.js";

export interface EmbeddedPi {
  session: AgentSession;
  provider: ProviderProfile;
  piProvider: string;
  lastPlan?: AgentPlan;
}

export const embedded = new Map<string, EmbeddedPi>();
export const inspectionExecutors = new Map<string, InspectionExecutor>();
export const catalogExecutors = new Map<string, CatalogExecutor>();
export const buildExecutors = new Map<string,BuildExecutor>();
export const buildSaveExecutors=new Map<string,BuildSaveExecutor>();

/** Bind the live controller/BDS bridge used by Pi's read-only inspection tools. */
export function setPiInspectionExecutor(sessionId: string, executor?: InspectionExecutor): void {
  if (executor) inspectionExecutors.set(sessionId, executor);
  else inspectionExecutors.delete(sessionId);
}
export function setPiCatalogExecutor(sessionId: string, executor?: CatalogExecutor): void {
  if (executor) catalogExecutors.set(sessionId, executor); else catalogExecutors.delete(sessionId);
}
export function setPiBuildExecutor(sessionId:string,executor?:BuildExecutor):void{if(executor)buildExecutors.set(sessionId,executor);else buildExecutors.delete(sessionId);}
export function setPiBuildSaveExecutor(sessionId:string,executor?:BuildSaveExecutor):void{if(executor)buildSaveExecutors.set(sessionId,executor);else buildSaveExecutors.delete(sessionId);}

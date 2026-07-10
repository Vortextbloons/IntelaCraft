import { createHash } from "node:crypto";
import { MAX_BUILD_VOLUME, STRONG_BUILD_VOLUME, approvalPayload, regionVolume, stableStringify, type ActionRequestMessage, type PermissionMode, type RegionBounds, type RiskClass } from "@intelacraft/shared-protocol";

export interface PolicyConfig { protectedRegions: Array<{ dimension: string; region: RegionBounds }>; builderRegions: Array<{ dimension: string; region: RegionBounds }>; }
export function payloadHash(action: ActionRequestMessage): string { return createHash("sha256").update(stableStringify(approvalPayload(action))).digest("hex"); }
export function regionsOverlap(a: RegionBounds,b: RegionBounds): boolean { return a.min.x<=b.max.x&&a.max.x>=b.min.x&&a.min.y<=b.max.y&&a.max.y>=b.min.y&&a.min.z<=b.max.z&&a.max.z>=b.min.z; }
export function contains(a: RegionBounds,b: RegionBounds): boolean { return a.min.x<=b.min.x&&a.min.y<=b.min.y&&a.min.z<=b.min.z&&a.max.x>=b.max.x&&a.max.y>=b.max.y&&a.max.z>=b.max.z; }
export function classify(action: Pick<ActionRequestMessage,"toolName"|"arguments">, config: PolicyConfig): { risk: RiskClass; reason: string } {
  if (action.toolName.startsWith("inspect.")) return {risk:"read",reason:"inspection"};
  if (action.toolName==="control.cancel") return {risk:"normal",reason:"cancellation"};
  if (action.toolName==="control.emergency_disable") return {risk:"strong",reason:"emergency control"};
  const args=action.arguments as {dimension?:string;region?:RegionBounds;blockType?:string};
  if (!args.region || regionVolume(args.region)>MAX_BUILD_VOLUME) return {risk:"prohibited",reason:"outside build limits"};
  if (config.protectedRegions.some(p=>p.dimension===args.dimension&&regionsOverlap(p.region,args.region!))) return {risk:"prohibited",reason:"protected region"};
  if (args.blockType==="minecraft:air"||regionVolume(args.region)>STRONG_BUILD_VOLUME) return {risk:"strong",reason:"destructive or large build"};
  return {risk:"normal",reason:"bounded build"};
}
export function approvalRequired(mode: PermissionMode,risk:RiskClass,action:ActionRequestMessage,config:PolicyConfig): boolean {
  if(risk==="read") return false;
  if(risk==="strong") return true;
  if(mode==="trusted_administrator") return false;
  if(mode==="allow_low_risk" && regionVolume((action.arguments as any).region)<=256) return false;
  return true;
}
export function enforceMode(mode:PermissionMode, action:ActionRequestMessage, config:PolicyConfig): string|null {
  if(action.risk==="prohibited") return "Prohibited action";
  if(action.risk!=="read"&&mode==="observe_only") return "Observe Only denies mutations";
  if(action.risk!=="read"&&mode==="builder_region") { const a=action.arguments as any; if(!config.builderRegions.some(r=>r.dimension===a.dimension&&contains(r.region,a.region))) return "Build is outside assigned builder regions"; }
  return null;
}

import type { DimensionId } from "./constants.js";
import type { BlockStates, Vec3i } from "./types.js";
export const BUILD_TYPES=["house","tower","bridge","wall","room","castle","custom"] as const;
export const BUILD_FEATURES=["foundation","windows","door","stairs","balcony","chimney","porch","interior_lighting","basic_furniture"] as const;
export const BUILD_DIRECTIONS=["north","south","east","west"] as const;
export const BUILD_STYLES=["default","medieval","modern","rustic"] as const;
export type BuildType=typeof BUILD_TYPES[number]; export type BuildFeature=typeof BUILD_FEATURES[number]; export type BuildDirection=typeof BUILD_DIRECTIONS[number];
export interface BuildSpec { version:1; name:string; type:BuildType; location:{dimension:DimensionId;anchor:Vec3i;facing:BuildDirection}; size:{width:number;depth:number;height:number;floors:number}; style:string; palette:{foundation:string;primary:string;secondary?:string;roof?:string;trim?:string;glass?:string}; features:BuildFeature[]; terrainPolicy:"preserve"|"adapt"|"flatten"|"raise_foundation"; interiorPolicy:"none"|"basic"|"furnished"; symmetry:"none"|"partial"|"full"; }
export interface BuildSpecIssue { severity:"warning"|"error"; path?:string; code:string; message:string }
export interface BuildSpecValidation { valid:boolean; issues:BuildSpecIssue[]; spec?:BuildSpec }
export interface ExpectedWorldState { version:1; dimension:DimensionId; bounds:import("./types.js").RegionBounds; blocks:Array<{position:Vec3i;blockType:string;states?:BlockStates}>; requiredAir:Vec3i[]; materials:Record<string,number> }
export interface BuildVerification { expectedBlocks:number; correctBlocks:number; missing:Array<{position:Vec3i;blockType:string;states?:BlockStates}>; incorrect:Array<{position:Vec3i;expected:string;actual:string;expectedStates?:BlockStates;actualStates?:BlockStates}>; unexpected:Array<{position:Vec3i;blockType:string;states?:BlockStates}>; completionPercent:number }
export interface BuildLibraryEntry { id:string; name:string; description?:string; taskId?:string; createdAt:string; updatedAt:string; spec:BuildSpec; dimension:DimensionId; bounds:import("./types.js").RegionBounds; blockCount:number; materials:Record<string,number>; status:"completed"|"verified"|"verification_warning"|"failed"; tags:string[]; favorite:boolean; deletedAt?:string }

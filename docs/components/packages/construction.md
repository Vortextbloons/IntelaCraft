# @intelacraft/construction

Semantic geometric build tools that translate high-level construction intents (walls, floors, rooms, stairs) into deterministic `BlockPlacement[]` arrays. These placements are then executed via `world.fill_blocks` or `world.place_blocks` on the BDS addon.

## Package Info

- **Location:** `packages/construction/`
- **Dependencies:** `@intelacraft/shared-protocol` (for `Vec3i`, `RegionBounds`, `DimensionId`, `normalizeRegion`)
- **External deps:** 0

## Core Types

```typescript
interface BlockPlacement { position: Vec3i; blockType: string; }

interface GeneratedBuild {
  dimension: DimensionId;
  blocks: BlockPlacement[];
  bounds: RegionBounds;
}

type SemanticToolName =
  | "build.wall"    | "build.floor"  | "build.pillar"
  | "build.doorway" | "build.window" | "build.roof"
  | "build.stairs"  | "build.room"   | "build.path";
```

## Semantic Build Functions

### `buildWall(args)`

Deterministic inclusive wall between two horizontal endpoints.

```typescript
interface BuildWallArgs {
  dimension: DimensionId;
  from: Vec3i;           // start corner
  to: Vec3i;             // end corner (must share X or Z with `from`)
  height: number;        // positive integer
  blockType: string;
  thickness?: number;    // default 1
}
```

**Validation:**
- `height` must be a positive integer
- `thickness` must be a positive integer
- Endpoints must align on X or Z (no diagonal walls)

### `buildFloor(args)`

Fills a horizontal rectangular area with blocks.

```typescript
interface BuildFloorArgs {
  dimension: DimensionId;
  from: Vec3i;
  to: Vec3i;
  blockType: string;
  thickness?: number;    // default 1 (layers below from.y)
}
```

### `buildPillar(args)`

Vertical column of blocks at a single position.

```typescript
interface BuildPillarArgs {
  dimension: DimensionId;
  position: Vec3i;
  height: number;        // positive integer
  blockType: string;
}
```

### `generateSemantic(tool, args)`

Unified dispatch function that routes to the correct builder based on tool name.

```typescript
function generateSemantic(
  tool: SemanticToolName,
  args: Record<string, unknown>
): GeneratedBuild;
```

Supported tools and their behavior:

| Tool | Implementation |
|------|---------------|
| `build.wall` | Delegates to `buildWall` |
| `build.floor` | Delegates to `buildFloor` |
| `build.path` | Delegates to `buildFloor` (alias) |
| `build.pillar` | Delegates to `buildPillar` |
| `build.room` | Combines `buildFloor` + 4 `buildWall` calls for the perimeter, deduplicates overlapping blocks |
| `build.stairs` | Diagonal ascending blocks from `from` to `from + height` |
| `build.roof` | Continuous gable roof with a ridge along the longer footprint axis |
| `build.doorway` | Wall with a rectangular opening (full-height opening) |
| `build.window` | Wall with a rectangular opening offset 1 block up from the floor |

## Preview and Validation

### `previewPlacements(build, context?)`

Analyzes a `GeneratedBuild` without executing it, producing conflict and cost estimates.

```typescript
interface BuildPreview {
  bounds: RegionBounds;
  generatedBlocks: number;
  blocksAdded: number;
  blocksReplaced: number;
  blocksRemoved: number;
  protectedConflicts: RegionBounds[];
  collisions: Array<{ position?: Vec3i; type: string }>;
  rollbackCoverage: number;       // 0–1, fraction covered by MAX_ROLLBACK_BLOCKS
  estimatedBatches: number;
  warnings: string[];
  materials: Record<string, number>;  // block type → count
}
```

**Context options:**
- `existing` — `Map<string, string>` of current block positions to types (for add/replace/remove counts)
- `protectedRegions` — array of `{ dimension, region }` to check for conflicts
- `batchSize` — blocks per batch (default 512)

### `validateBuildPlan(plan, limits?)`

Validates a structured `BuildPlan` object, checking step IDs, dependencies, circular references, geometry, volume limits, and protected region conflicts.

```typescript
interface BuildPlan {
  summary: string;
  anchor?: { dimension: DimensionId; position: Vec3i; facing?: string };
  bounds?: RegionBounds;
  palette: Array<{ role: string; blockType: string }>;
  steps: BuildStep[];
  verification: Array<{ toolName: string; arguments: Record<string, unknown>; summary?: string }>;
  estimates: { blocksChanged: number; operations: number };
  warnings: string[];
}

interface BuildStep {
  id: string;
  summary: string;
  toolName: SemanticToolName;
  arguments: Record<string, unknown>;
  dependsOn?: string[];
  risk?: string;
}

interface PlanValidationIssue {
  severity: "warning" | "error";
  code: string;
  stepId?: string;
  message: string;
}
```

**Validation checks:**
- `DUPLICATE_STEP_ID` — step IDs must be unique
- `UNKNOWN_DEPENDENCY` — dependencies reference existing steps
- `CIRCULAR_DEPENDENCY` — no cycles in the dependency graph
- `GEOMETRY_INVALID` — geometry function threw an error
- `VOLUME_LIMIT` — generated blocks exceed configured maximum (default 8192)
- `PROTECTED_REGION` — build intersects protected regions

## Utility Functions

### `materialTotals(blocks)`

Counts blocks by type, returning `Record<string, number>`.

```typescript
materialTotals([
  { position: { x: 0, y: 0, z: 0 }, blockType: "minecraft:stone" },
  { position: { x: 1, y: 0, z: 0 }, blockType: "minecraft:stone" },
  { position: { x: 0, y: 1, z: 0 }, blockType: "minecraft:oak_planks" },
]);
// → { "minecraft:stone": 2, "minecraft:oak_planks": 1 }
```

## Integration

## BuildSpec compiler

`compileBuildSpec(spec)` validates a version 1 `BuildSpec` and deterministically produces an `ExpectedWorldState`. The initial compiler supports oriented rectangular footprints, optional foundations, exterior walls, intermediate floors, gable roofs, facing-aware doors, canonical block ordering, required interior air, material totals, and impossible-dimension rejection. Existing semantic builders remain available during migration.

The style registry currently includes `default`, `medieval`, `modern`, and `rustic`, controlling window spacing, floor proportions, roof overhang, porch depth, and balcony depth. Unknown styles deterministically fall back to `default`. Whole-structure compilation now materializes windows, internal stairs, balconies, chimneys, porches, interior lighting, and basic furniture when requested, while retaining the shared 8,192-block compile cap.

`compileBuildSpec(spec, { terrain })` accepts bounded surface columns captured before compilation. `preserve` leaves terrain unchanged, `adapt` adds foundation supports from sampled surfaces to the anchor, `flatten` creates a level foundation plane, and `raise_foundation` moves the anchor above the highest sampled column. Identical specs and terrain columns produce identical expected state.

Bridge and wall types use dedicated compilers rather than the generic enclosed-structure shell. Compatibility validation rejects unsupported feature/type combinations before geometry generation.

`optimizePlacements()` deduplicates placements, skips blocks already matching a supplied snapshot, compacts adjacent X-axis runs into `world.fill_blocks`, batches remaining details into bounded `world.place_blocks` actions, and always enables rollback capture. `createBuildPhases()` emits the fixed nine-phase dependency chain and optimizes each phase independently so operations never cross phase boundaries.

`verifyBuild()` decodes a complete palette-indexed `VoxelSnapshot`, verifies its dimension and bounds coverage, and compares it with `ExpectedWorldState`. It reports missing, incorrect, and unexpected blocks plus completion percentage. `createRepairOperations()` creates one minimal corrective operation set, rejects repairs above `MAX_ROLLBACK_BLOCKS`, and does not bypass controller approval or policy.

The controller uses these results after phased execution. Verification is read-only; a non-100-percent result remains partial until a separately approved repair is proposed.

The construction package is consumed by the Pi extension's planning system. When the AI agent generates a plan using semantic tool names (`build.wall`, `build.room`, etc.), the controller can:

1. Call `generateSemantic()` to produce block placements
2. Call `previewPlacements()` to assess cost and conflicts
3. Convert the placements into `world.fill_blocks` or `world.place_blocks` actions for execution

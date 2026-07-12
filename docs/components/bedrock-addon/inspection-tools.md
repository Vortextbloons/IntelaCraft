# Inspection Tools

All 14 read-only tools that query Minecraft world state. Each tool currently executes synchronously within a single server tick.

## Overview

Inspection tools are split across domain-cohesive sub-modules under `src/tools/inspect/`. A central dispatcher in `index.ts` routes each tool to the appropriate handler. They never modify the world — they only read data via the Minecraft Script API.

### Module Layout

| Module | Tools |
|--------|-------|
| `src/tools/inspect/helpers.ts` | Shared types (`ToolResult`, `ToolSuccess`, `ToolFailure`) and utilities (`getDimension()`, `surfaceAt()`) |
| `src/tools/inspect/server.ts` | `inspect.server_status`, `inspect.players`, `inspect.player` |
| `src/tools/inspect/world.ts` | `inspect.block`, `inspect.region`, `inspect.voxel_snapshot`, `inspect.world_state`, `inspect.entities` |
| `src/tools/inspect/terrain.ts` | `inspect.heightmap`, `inspect.surface`, `inspect.build_collision`, `inspect.find_empty_area` |
| `src/tools/inspect/meta.ts` | `inspect.scoreboard`, `inspect.tags` |
| `src/tools/inspect/index.ts` | Dispatcher — switches on `action.toolName`, delegates to the sub-modules above |

### ToolResult Type

Defined in `src/tools/inspect/helpers.ts`:

```typescript
type ToolResult = ToolSuccess | ToolFailure;

interface ToolSuccess {
  ok: true;
  result: unknown;
  completedWork: number;
  totalEstimatedWork: number;
  message: string;
}

interface ToolFailure {
  ok: false;
  code: string;
  message: string;
  details?: unknown;
}
```

### Dispatcher

`executeInspectTool(action)` in `src/tools/inspect/index.ts` uses a `switch` statement on `action.toolName` to route to the appropriate handler in the sub-modules listed above. Unrecognized tool names return `{ ok: false, code: "UNKNOWN_TOOL", ... }`. All handlers are wrapped in a `try/catch` that returns `{ ok: false, code: "TOOL_ERROR", ... }`.

---

## Tool Reference

### 1. inspect.server_status

**File**: `src/tools/inspect/server.ts`
**Inspects**: Overall server health — player count and names.

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `includeDimensions` | `boolean` | No | Include dimension list in response |

**Minecraft API**: `world.getPlayers()`

**Returns**:

```json
{
  "playerCount": 3,
  "players": ["Alice", "Bob", "Charlie"],
  "dimensions": ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]
}
```

The `dimensions` field is only present when `includeDimensions` is `true`.

**Example**: *"How many players are online?"*

---

### 2. inspect.players

**File**: `src/tools/inspect/server.ts`
**Inspects**: Detailed player list with location, dimension, and permission info.

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `nameFilter` | `string` | No | Case-insensitive substring match on player name |

**Minecraft API**: `world.getPlayers()`, `player.dimension.id`, `player.location`, `player.playerPermissionLevel`

**Returns**:

```json
{
  "count": 2,
  "players": [
    {
      "name": "Alice",
      "id": "a1b2c3d4-...",
      "dimension": "minecraft:overworld",
      "location": { "x": 100, "y": 64, "z": -200 },
      "permissionLevel": 1,
      "isOperator": false
    }
  ]
}
```

Locations are floored to integers. `permissionLevel` uses the `PlayerPermissionLevel` enum. `isOperator` is `true` when `permissionLevel === PlayerPermissionLevel.Operator`.

**Example**: *"List all players with their positions"*

---

### 3. inspect.player

**File**: `src/tools/inspect/server.ts`
**Inspects**: Detailed info for a single online player — health, inventory, equipment, effects, tags, and XP.

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `name` | `string` | Yes | Player name (must be online) |

**Minecraft API**: `world.getPlayers()`, player components (`health`, `absorption`, `inventory`, `equippable`), `player.getEffects()`, `player.getTags()`

**Returns**:

```json
{
  "name": "Alice",
  "id": "a1b2c3d4-...",
  "alive": true,
  "dimension": "minecraft:overworld",
  "location": { "x": 100, "y": 64, "z": -200 },
  "gameMode": "survival",
  "health": { "current": 20, "max": 20 },
  "absorption": null,
  "xp": { "level": 5, "total": 1280, "atCurrentLevel": 30 },
  "effects": [
    { "id": "minecraft:regeneration", "amplifier": 1, "duration": 200 }
  ],
  "inventory": [
    { "slot": 0, "typeId": "minecraft:diamond_sword", "amount": 1 }
  ],
  "armor": {
    "head": { "typeId": "minecraft:diamond_helmet", "amount": 1 },
    "chest": null,
    "legs": null,
    "feet": null
  },
  "isOperator": false,
  "tags": ["has_home"]
}
```

**Error**: Returns `PLAYER_NOT_FOUND` if no online player matches the name.

**Example**: *"Show me Alice's inventory and health"*

---

### 4. inspect.block

**File**: `src/tools/inspect/world.ts`
**Inspects**: A single block at a specific position.

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `dimension` | `DimensionId` | Yes | Target dimension |
| `position` | `{ x: number; y: number; z: number }` | Yes | Block coordinates |

**Minecraft API**: `world.getDimension(id).getBlock(position)`

**Returns**:

```json
{
  "dimension": "minecraft:overworld",
  "position": { "x": 100, "y": 64, "z": -200 },
  "typeId": "minecraft:diamond_block",
  "isAir": false,
  "isLiquid": false,
  "isWaterlogged": false
}
```

**Error**: Returns `BLOCK_UNAVAILABLE` if the block is unloaded or out of world bounds.

**Example**: *"What block is at 100, 64, -200 in the overworld?"*

---

### 5. inspect.region

**File**: `src/tools/inspect/world.ts`
**Inspects**: A block type histogram for a 3D region.

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `dimension` | `DimensionId` | Yes | Target dimension |
| `region` | `RegionBounds` | Yes | `{ min: {x,y,z}, max: {x,y,z} }` |

**Minecraft API**: Triple nested `for` loop over coordinates, `dimension.getBlock()` per position.

**Safety**: Volume must be ≤ `MAX_REGION_VOLUME` (32768). Returns `REGION_TOO_LARGE` if exceeded.

**Returns**:

```json
{
  "dimension": "minecraft:overworld",
  "region": { "min": { "x": 0, "y": 60, "z": 0 }, "max": { "x": 3, "y": 63, "z": 3 } },
  "volume": 64,
  "blocksRead": 60,
  "unloaded": 4,
  "typeCounts": {
    "minecraft:stone": 30,
    "minecraft:dirt": 20,
    "minecraft:air": 10
  }
}
```

Unloaded blocks are counted in the `unloaded` field and excluded from `typeCounts`.

**Example**: *"What blocks are in the region 0,60,0 to 3,63,3?"*

---

### 6. inspect.world_state

**File**: `src/tools/inspect/world.ts`
**Inspects**: Time of day, weather, and game rules in a single call.

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `dimension` | `DimensionId` | No | Defaults to `"minecraft:overworld"` |
| `rules` | `string[]` | No | Specific game rules to read (defaults to 8 common rules) |

**Minecraft API**: `world.getTimeOfDay()`, `world.getAbsoluteTime()`, `world.getDay()`, `dimension.getWeather()`, `world.gameRules`

**Default game rules queried** (when `rules` is omitted):

1. `doDayLightCycle`
2. `doMobSpawning`
3. `doWeatherCycle`
4. `keepInventory`
5. `mobGriefing`
6. `pvp`
7. `showCoordinates`
8. `tntExplodes`

**Returns**:

```json
{
  "time": {
    "dimension": "minecraft:overworld",
    "timeOfDay": 13000,
    "absoluteTime": 65000,
    "day": 5
  },
  "weather": {
    "dimension": "minecraft:overworld",
    "weather": "clear"
  },
  "rules": {
    "doDayLightCycle": true,
    "doMobSpawning": true,
    "keepInventory": false,
    "showCoordinates": true
  }
}
```

`timeOfDay` ranges from 0 to 24000 (Minecraft day cycle ticks). Possible weather values: `"clear"`, `"rain"`, `"thunder"`. Rules not found in the world return `null`.

**Example**: *"What time is it and what are the game rules?"*

---

### 7. inspect.entities

**File**: `src/tools/inspect/world.ts`
**Inspects**: Entity list in a dimension with type, name, and location.

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `dimension` | `DimensionId` | Yes | Target dimension |
| `typeFilter` | `string` | No | Case-insensitive substring match on `typeId` |
| `limit` | `number` | No | Max entities to return (default 64, max 128) |

**Minecraft API**: `dimension.getEntities()`

**Returns**:

```json
{
  "dimension": "minecraft:overworld",
  "count": 3,
  "truncated": false,
  "entities": [
    {
      "id": "e1f2a3b4-...",
      "typeId": "minecraft:zombie",
      "nameTag": "Bob the Zombie",
      "location": { "x": 100, "y": 64, "z": -200 }
    }
  ]
}
```

`truncated` is `true` when the total entity count exceeds the limit. Locations are floored.

**Example**: *"Find all zombies near spawn"*

---

### 8. inspect.scoreboard

**File**: `src/tools/inspect/meta.ts`
**Inspects**: Scoreboard objectives with participants and scores.

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `objective` | `string` | No | Specific objective ID (omitted = all objectives) |

**Minecraft API**: `world.scoreboard.getObjectives()`, `objective.getParticipants()`, `objective.getScore()`

**Returns**:

```json
{
  "objectives": [
    {
      "id": "kills",
      "displayName": "Kills",
      "participantCount": 5,
      "scores": [
        { "displayName": "Alice", "score": 10 },
        { "displayName": "Bob", "score": 3 }
      ]
    }
  ]
}
```

Each objective caps at 64 participants in the response.

**Error**: Returns `OBJECTIVE_NOT_FOUND` if a specific objective ID is requested but not found.

**Example**: *"Show me the kills scoreboard"*

---

### 9. inspect.tags

**File**: `src/tools/inspect/meta.ts`
**Inspects**: Tags on a player or entity by name or ID.

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `target` | `string` | Yes | Player name, player ID, entity ID, or entity nameTag |
| `player` | `boolean` | No | If `false`, skip player search and go straight to entities |

**Minecraft API**: `world.getPlayers()`, `player.getTags()`, `dimension.getEntities()`, `entity.getTags()`

**Search order**:
1. Players (by `name` or `id`) — unless `player === false`
2. Entities in overworld, nether, then the_end (by `id` or `nameTag`)

**Returns (player)**:

```json
{
  "kind": "player",
  "name": "Alice",
  "id": "a1b2c3d4-...",
  "tags": ["tagged", "admin"]
}
```

**Returns (entity)**:

```json
{
  "kind": "entity",
  "id": "e1f2a3b4-...",
  "typeId": "minecraft:villager",
  "nameTag": "Farmer Joe",
  "tags": ["has_house"]
}
```

**Error**: Returns `TARGET_NOT_FOUND` if no player or entity matches.

**Example**: *"What tags does Alice have?"*

---

### 10. inspect.heightmap

**File**: `src/tools/inspect/terrain.ts`
**Inspects**: Terrain height samples across a region at a given resolution.

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `dimension` | `DimensionId` | Yes | Target dimension |
| `region` | `RegionBounds` | Yes | `{ min: {x,y,z}, max: {x,y,z} }` |
| `resolution` | `1 \| 2 \| 4` | No | Sample every Nth block (default: 1) |

**Minecraft API**: Iterates columns, uses `surfaceAt()` to find the top non-air block from `min.y` to `max.y`.

**Returns**:

```json
{
  "dimension": "minecraft:overworld",
  "region": { "min": { "x": 0, "y": -64, "z": 0 }, "max": { "x": 10, "y": 319, "z": 10 } },
  "resolution": 2,
  "min": 62,
  "max": 78,
  "average": 69.5,
  "slope": 16,
  "columns": [
    { "x": 0, "z": 0, "height": 64 },
    { "x": 2, "z": 0, "height": 66 }
  ]
}
```

**Example**: *"What does the terrain look like around 0,0?"*

---

### 11. inspect.surface

**File**: `src/tools/inspect/terrain.ts`
**Inspects**: Top solid block types for terrain columns (like heightmap but includes surface material).

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `dimension` | `DimensionId` | Yes | Target dimension |
| `region` | `RegionBounds` | Yes | `{ min: {x,y,z}, max: {x,y,z} }` |
| `resolution` | `1 \| 2 \| 4` | No | Sample every Nth block (default: 1) |

**Returns**:

```json
{
  "dimension": "minecraft:overworld",
  "region": { "min": { "x": 0, "y": -64, "z": 0 }, "max": { "x": 10, "y": 319, "z": 10 } },
  "resolution": 2,
  "min": 62,
  "max": 78,
  "average": 69.5,
  "slope": 16,
  "columns": [
    { "x": 0, "z": 0, "height": 64, "surfaceType": "minecraft:grass_block" },
    { "x": 2, "z": 0, "height": 66, "surfaceType": "minecraft:stone" }
  ]
}
```

**Example**: *"What materials are on the surface near spawn?"*

---

### 12. inspect.build_collision

**File**: `src/tools/inspect/terrain.ts`
**Inspects**: Non-air blocks and entities in a proposed build volume.

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `dimension` | `DimensionId` | Yes | Target dimension |
| `region` | `RegionBounds` | Yes | Proposed build bounding box |

**Minecraft API**: Triple nested loop over coordinates checking `dimension.getBlock()`, plus `dimension.getEntities()` for entities in the region.

**Returns**:

```json
{
  "dimension": "minecraft:overworld",
  "region": { "min": { "x": 0, "y": 64, "z": 0 }, "max": { "x": 10, "y": 70, "z": 10 } },
  "nonAirBlocks": 42,
  "collisions": [
    { "position": { "x": 3, "y": 65, "z": 5 }, "type": "block", "blockType": "minecraft:oak_log" },
    { "type": "entity", "id": "e1f2a3b4-...", "typeId": "minecraft:zombie" }
  ],
  "worldHeightValid": true
}
```

**Example**: *"Are there any blocks where I want to build?"*

---

### 13. inspect.find_empty_area

**File**: `src/tools/inspect/terrain.ts`
**Inspects**: Finds nearby rectangular areas that are mostly empty and suitable for building.

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `dimension` | `DimensionId` | Yes | Target dimension |
| `origin` | `Vec3i` | Yes | Center point to search around |
| `requiredSize` | `Vec3i` | Yes | Minimum dimensions needed (x, y, z must be ≥ 1) |
| `radius` | `number` | Yes | Search radius in blocks (0–128) |
| `maxSlope` | `number` | No | Maximum allowed slope between corner heights |

**Minecraft API**: Steps through candidate positions within the radius, runs `inspect.build_collision` on each, ranks by obstruction count + slope + distance.

**Returns**:

```json
{
  "dimension": "minecraft:overworld",
  "requiredSize": { "x": 10, "y": 6, "z": 10 },
  "maxSlope": 3,
  "candidates": [
    {
      "region": { "min": { "x": 5, "y": 64, "z": 10 }, "max": { "x": 14, "y": 69, "z": 19 } },
      "obstructions": 0,
      "distance": 15,
      "slope": 1,
      "surfaceSuitable": true,
      "score": 16
    }
  ]
}
```

Candidates are sorted by score (lower = better). Up to 8 candidates are returned.

**Example**: *"Find a flat spot near 0,64,0 to build a house"*

---

## Summary Table

| Tool | Reads | Dimensions | Key Limits |
|------|-------|------------|------------|
| `inspect.server_status` | Player count/names | Optional list | — |
| `inspect.players` | Player details | All | Optional nameFilter |
| `inspect.player` | Single player full state | One | PLAYER_NOT_FOUND |
| `inspect.block` | Single block state | One | BLOCK_UNAVAILABLE on unloaded |
| `inspect.region` | Block type histogram | One | MAX_REGION_VOLUME = 32768 |
| `inspect.world_state` | Time, weather, game rules | One (default overworld) | Default 8 rules |
| `inspect.entities` | Entity list | One | limit default 64, max 128 |
| `inspect.scoreboard` | Objectives + scores | — | 64 participants per objective |
| `inspect.tags` | Tags on target | All (fallback) | Player-first search |
| `inspect.heightmap` | Terrain height samples | One | resolution 1/2/4 |
| `inspect.surface` | Surface block types | One | resolution 1/2/4 |
| `inspect.voxel_snapshot` | Palette-indexed block snapshot | One | MAX_REGION_VOLUME = 32768 |
| `inspect.build_collision` | Blocks + entities in volume | One | Scans entire region |
| `inspect.find_empty_area` | Ranked empty build areas | One | radius 0–128, max 8 candidates |

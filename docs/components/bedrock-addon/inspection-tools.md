# Inspection Tools

All 10 read-only tools that query Minecraft world state. Each tool executes synchronously within a single server tick.

## Overview

Inspection tools are dispatched by `executeInspectTool()` in `src/tools/inspect/index.ts`. They never modify the world — they only read data via the Minecraft Script API.

### ToolResult Type

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

`executeInspectTool(action)` uses a `switch` statement on `action.toolName` to route to the appropriate handler. Unrecognized tool names return `{ ok: false, code: "UNKNOWN_TOOL", ... }`. All handlers are wrapped in a `try/catch` that returns `{ ok: false, code: "TOOL_ERROR", ... }`.

---

## Tool Reference

### 1. inspect.server_status

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

### 3. inspect.block

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

### 4. inspect.region

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

### 5. inspect.time

**Inspects**: Time of day, absolute time, and day number.

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `dimension` | `DimensionId` | No | Defaults to `"minecraft:overworld"` |

**Minecraft API**: `world.getTimeOfDay()`, `world.getAbsoluteTime()`, `world.getDay()`

**Returns**:

```json
{
  "dimension": "minecraft:overworld",
  "timeOfDay": 13000,
  "absoluteTime": 65000,
  "day": 5
}
```

`timeOfDay` ranges from 0 to 24000 (Minecraft day cycle ticks).

**Example**: *"What time is it in the overworld?"*

---

### 6. inspect.weather

**Inspects**: Current weather state in a dimension.

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `dimension` | `DimensionId` | No | Defaults to `"minecraft:overworld"` |

**Minecraft API**: `dimension.getWeather()`

**Returns**:

```json
{
  "dimension": "minecraft:overworld",
  "weather": "clear"
}
```

Possible weather values: `"clear"`, `"rain"`, `"thunder"`.

**Example**: *"Is it raining?"*

---

### 7. inspect.game_rules

**Inspects**: Current game rule values.

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `names` | `string[]` | No | Specific rules to read (defaults to 8 common rules) |

**Minecraft API**: `world.gameRules`

**Default rules queried** (when `names` is omitted):

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
  "rules": {
    "doDayLightCycle": true,
    "doMobSpawning": true,
    "keepInventory": false,
    "showCoordinates": true
  }
}
```

Rules not found in the world return `null`.

**Example**: *"What are the current game rules?"*

---

### 8. inspect.entities

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

### 9. inspect.scoreboard

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

### 10. inspect.tags

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

## Summary Table

| Tool | Reads | Dimensions | Key Limits |
|------|-------|------------|------------|
| `inspect.server_status` | Player count/names | Optional list | — |
| `inspect.players` | Player details | All | Optional nameFilter |
| `inspect.block` | Single block state | One | BLOCK_UNAVAILABLE on unloaded |
| `inspect.region` | Block type histogram | One | MAX_REGION_VOLUME = 32768 |
| `inspect.time` | Time of day | One (default overworld) | — |
| `inspect.weather` | Weather state | One (default overworld) | — |
| `inspect.game_rules` | Game rule values | — | Default 8 rules |
| `inspect.entities` | Entity list | One | limit default 64, max 128 |
| `inspect.scoreboard` | Objectives + scores | — | 64 participants per objective |
| `inspect.tags` | Tags on target | All (fallback) | Player-first search |

# Risk Classification & Approval Policy

All logic lives in `src/policy.ts`.

## Risk Classification

The `classify(action, config)` function assigns a risk level to every action. It takes an object with `toolName` and `arguments`, plus a `PolicyConfig` with protected regions, builder regions, and admin commands.

| Tool Pattern | Risk Level | Notes |
|-------------|------------|-------|
| `inspect.*` | `read` | Always safe, never requires approval |
| `control.cancel` | `normal` | Cancels a pending action |
| `control.emergency_disable` | `strong` | Halts all mutations on a session |
| `admin.run_command` | varies | Looks up `commandId` in config; `prohibited` if not found |
| `world.fill_blocks` | varies | See below |
| `world.place_blocks` | varies | See below |

### world.fill_blocks Classification

1. No region specified **or** volume > `MAX_BUILD_VOLUME` (32,768) → **`prohibited`**
2. Overlaps a protected region → **`prohibited`**
3. Block is `minecraft:air` **or** volume > `STRONG_BUILD_VOLUME` (4,096) → **`strong`**
4. Otherwise → **`normal`**

### world.place_blocks Classification

1. No blocks or count > `MAX_BUILD_VOLUME` (32,768) → **`prohibited`**
2. Any block position overlaps a protected region → **`prohibited`**
3. Count > `STRONG_BUILD_VOLUME` (4,096) **or** any block is `minecraft:air` → **`strong`**
4. Otherwise → **`normal`**

## Approval Requirements

The `approvalRequired(mode, risk, action, config)` function determines if user approval is needed. It takes the permission mode, risk class, full action message, and policy config.

| Permission Mode | read | normal | strong | prohibited |
|----------------|------|--------|--------|------------|
| `observe_only` | auto | blocked | blocked | blocked |
| `allow_low_risk` | auto | auto (`world.fill_blocks` with `region` volume ≤ 256) | **requires approval** | blocked |
| `confirm_every_change` | auto | **requires approval** | **requires approval** | blocked |
| `builder_region` | auto | **requires approval** + region check | **requires approval** + region check | blocked |
| `trusted_administrator` | auto | auto | auto | blocked |

- **auto** = action proceeds without user confirmation
- **blocked** = action is rejected outright
- **requires approval** = action is queued, user must approve via webview

Note: In `allow_low_risk` mode, auto-approval for `world.fill_blocks` requires both that the tool name matches **and** the action has a `region` field with volume ≤ 256 blocks. `world.place_blocks` in this mode always requires approval because its arguments use a `blocks` array (no `region` field).

## Permission Mode Enforcement

The `enforceMode(mode, action, config)` function applies mode-specific restrictions. It takes the permission mode, full action message, and policy config.

- **`observe_only`**: Blocks all non-read mutations entirely
- **`builder_region`**: Restricts builds to configured builder regions, blocks all admin commands
- Other modes: pass through (classification handles the rest)

## Approval Binding

When a task requires approval, an `ApprovalRecord` is created with a **SHA-256 hash** of the immutable action payload.

### Payload Fields (in order)

`actionId`, `idempotencyKey`, `toolName`, `arguments`, `actor`, `permissionMode`, `risk`, `expiresAt`

The full payload is displayed to the user in the webview. Only the hash is stored. This prevents tampering between display and approval.

Stable serialization uses `stableStringify` for deterministic JSON ordering.

## Protected Regions

Configurable list of regions per dimension. Used to block builds in sensitive areas.

```json
{
  "overworld": [
    { "min": [0, 60, 0], "max": [100, 80, 100] }
  ]
}
```

- **AABB overlap testing** against fill regions via `regionsOverlap()` and `contains()`
- Checked at **two layers**: controller (`policy.ts`) and addon (`mutate.ts`)
- Overlap with any protected region → action classified as `prohibited`

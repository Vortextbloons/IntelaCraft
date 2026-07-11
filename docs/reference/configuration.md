# IntelaCraft Configuration Reference

## Environment Variables

All IntelaCraft-specific variables are prefixed with `INTELACRAFT_`. Set these in your `.env` file or system environment.

### Core

| Variable | Description | Default | Type | Example |
|----------|-------------|---------|------|---------|
| `INTELACRAFT_BDS_TOKEN` | Shared bearer token for authenticating BDS ↔ controller communication | *required* | string | `sk-my-secret-token-123` |
| `PORT` | HTTP port the controller listens on | `8787` | number | `8787` |
| `INTELACRAFT_HEARTBEAT_STALE_MS` | Milliseconds before a heartbeat is considered stale | `15000` | number | `20000` |

### Audit

| Variable | Description | Default | Type | Example |
|----------|-------------|---------|------|---------|
| `INTELACRAFT_AUDIT_PATH` | Path to the JSONL audit log file | `./data/audit.jsonl` | file path | `/var/log/intelacraft/audit.jsonl` |
| `INTELACRAFT_AUDIT_RETENTION_DAYS` | Days to retain audit records before auto-purge | `30` | number | `90` |

### Regions

| Variable | Description | Default | Type | Example |
|----------|-------------|---------|------|---------|
| `INTELACRAFT_PROTECTED_REGIONS` | JSON array of regions where no mutations are allowed | `[]` | JSON string | `"[{\"from\":{\"x\":0,\"y\":0,\"z\":0},\"to\":{\"x\":100,\"y\":100,\"z\":100}}]"` |
| `INTELACRAFT_BUILDER_REGIONS` | JSON array of regions where builders can operate | `[]` | JSON string | `"[{\"from\":{\"x\":0,\"y\":60,\"z\":0},\"to\":{\"x\":200,\"y\":80,\"z\":200}}]"` |

### AI Provider

| Variable | Description | Default | Type | Example |
|----------|-------------|---------|------|---------|
| `INTELACRAFT_PROVIDER_BASE_URL` | API endpoint for the AI model provider | `https://api.openai.com/v1` | URL | `https://api.anthropic.com` |
| `INTELACRAFT_PROVIDER_API_KEY` | API key for the AI model provider | *required* | string | `sk-ant-...` |
| `INTELACRAFT_PROVIDER_MODEL` | Model identifier to use for planning | `gpt-4o` | string | `claude-sonnet-4-20250514` |
| `INTELACRAFT_PROVIDERS_PATH` | Path to provider profiles JSON file | `./data/providers.json` | file path | `/etc/intelacraft/providers.json` |

### Pi Agent

| Variable | Description | Default | Type | Example |
|----------|-------------|---------|------|---------|
| `INTELACRAFT_PI_STORAGE_PATH` | Directory for Pi session data | `./data/pi` | file path | `/var/lib/intelacraft/pi` |
| `INTELACRAFT_TASKS_PATH` | Path to persisted tasks JSON file | `./data/tasks.json` | file path | `/var/lib/intelacraft/tasks.json` |

### MCP (Optional)

| Variable | Description | Default | Type | Example |
|----------|-------------|---------|------|---------|
| `INTELACRAFT_MCP_URL` | URL of the MCP server for advisory context | *none* (disabled) | URL | `http://localhost:3001` |
| `INTELACRAFT_MCP_TOKEN` | Auth token for MCP server | *none* | string | `mcp-token-123` |

### Permissions & Safety

| Variable | Description | Default | Type | Example |
|----------|-------------|---------|------|---------|
| `INTELACRAFT_PERMISSION_MODE` | Global permission mode for mutations | `confirm_every_change` | enum | `allow_low_risk` |
| `INTELACRAFT_ADMIN_COMMANDS` | JSON object mapping command IDs to allowed commands | `{}` | JSON string | `"{\"time_day\":{\"command\":\"time set day\",\"risk\":\"normal\",\"label\":\"Set time to day\"}}"` |

### BDS Integration

| Variable | Description | Default | Type | Example |
|----------|-------------|---------|------|---------|
| `BDS_PATH` | Path to the BDS installation directory | *none* (required for deploy) | file path | `/opt/bedrock-server` |

---

## BDS Addon Configuration

These values are configured in the BDS `config/default/variables.json` and `config/default/secrets.json` files (not controller env vars).

### variables.json

| Key | Description | Example |
|-----|-------------|---------|
| `intelacraft:controller_url` | URL of the controller API | `http://127.0.0.1:8787` |
| `intelacraft:server_id` | Unique identifier for this BDS instance | `survival-1` |
| `intelacraft:admin_commands` | JSON object of admin command allowlist | See below |

### secrets.json

| Key | Description | Example |
|-----|-------------|---------|
| `intelacraft:bds_token` | Bearer token header value (full `Bearer <token>` string) | `Bearer sk-my-secret-token-123` |

---

## BDS Configuration Files

The controller writes three JSON files into the BDS configuration directory on `npm run deploy`. These configure the behavior pack to communicate with the controller.

### variables.json

Runtime configuration injected into the behavior pack.

```json
{
  "intelacraft:controller_url": "http://127.0.0.1:8787",
  "intelacraft:server_id": "bds-default",
  "intelacraft:admin_commands": "{\"time_day\":{\"command\":\"time set day\",\"risk\":\"normal\",\"label\":\"Set time to day\"}}"
}
```

| Field | Type | Description |
|-------|------|-------------|
| intelacraft:controller_url | string | Full URL of the controller API |
| intelacraft:server_id | string | Unique identifier for this BDS instance |
| intelacraft:admin_commands | string (JSON) | Admin command allowlist mapping command IDs to command definitions |

### secrets.json

Secrets that should not be committed to version control.

```json
{
  "intelacraft:bds_token": "Bearer your-shared-token"
}
```

**Note:** The value must be the full `Authorization` header value, including the `Bearer ` prefix.

### permissions.json

Permission configuration controlling what modules are allowed.

```json
{
  "allowed_modules": ["@minecraft/server", "@minecraft/server-net", "@minecraft/server-admin"]
}
```

---

## Permission Modes

The permission mode controls how the agent handles mutations (block placements, entity spawns, command execution).

### observe_only

Blocks all mutations. The agent can only inspect the world and report findings. Useful for auditing or monitoring without risk.

```
All mutations → BLOCKED
```

### confirm_every_change

Default mode. Every mutation requires explicit user approval before execution. Safest option for production servers.

```
All mutations → REQUIRES APPROVAL
```

### allow_low_risk

Auto-approves mutations classified as `read` or `normal` risk. Mutations classified as `strong` still require approval. Balanced for active development.

```
read, normal → AUTO-APPROVED
strong → REQUIRES APPROVAL
prohibited → BLOCKED
```

### builder_region

Restricts build operations to designated builder regions. Mutations outside builder regions are blocked. Useful for multi-user servers where builders have defined work areas.

```
Mutations in builder regions → REQUIRES APPROVAL
Mutations outside builder regions → BLOCKED
Protected regions → ALWAYS BLOCKED
```

### trusted_administrator

Trusts all mutations without requiring approval. Only use in controlled environments where the agent has full authority.

```
All mutations → AUTO-APPROVED
Protected regions → STILL BLOCKED
```

---

## Risk Classes

Every mutation is classified into one of four risk classes. The permission mode determines how each class is handled.

| Class | Description | Examples |
|-------|-------------|----------|
| **read** | Non-destructive inspection or queries | `inspect.block`, `inspect.players`, `inspect.region` |
| **normal** | Reversible or low-impact changes | `world.fill_blocks` within builder region, `control.cancel` |
| **strong** | Significant world modifications | Large `world.fill_blocks`, multiple block changes, entity spawns |
| **prohibited** | Operations that are never allowed | Destructive commands outside allowlist, irreversible server changes |

### Risk Classification Rules

- `world.fill_blocks`: Risk increases with volume. ≤4096 blocks = normal (unless air), >4096 = strong, >32768 = prohibited
- `admin.run_command`: Risk depends on the command. Commands in the admin allowlist = normal. All others = prohibited.
- `control.emergency_disable`: Always strong (requires approval unless in trusted_administrator mode)
- `control.cancel`: Always normal (low-impact, reversible)
- All inspection tools: Always read (safe, non-destructive)

### Region Protection

Protected regions are **always blocked** regardless of risk class or permission mode. A mutation that overlaps even partially with a protected region is rejected.

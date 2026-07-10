# IntelaCraft Operations Runbook

## Start / stop

```powershell
npm run setup
npm run build
npm run dev
```

Open the webview at `http://127.0.0.1:8787/` (after build). Enter the same bearer token as `INTELACRAFT_BDS_TOKEN`.

Health check: `npm run health` or `GET /v1/health`.

## Deploy Bedrock packs

Configure `apps/bedrock-addon/.env` with `DEPLOY_PATH`, then `npm run deploy`. Restart BDS after pack changes. Ensure script networking and admin modules are enabled and variables/secrets match `.env`.

## Before large or destructive builds

Take a normal BDS world backup. IntelaCraft rollback capture is bounded and not a substitute for backups. Prefer strong confirmation for air fills and builds above 4,096 blocks.

## Emergency disable

From the webview **Emergency disable** control, or:

```powershell
# POST /v1/emergency-disable with Authorization: Bearer <token>
```

Clears only when explicitly re-enabled. The behavior pack also checks emergency state at batch boundaries.

## Activity history

Audit file: `INTELACRAFT_AUDIT_PATH` (default `./data/audit.jsonl`). Query via `GET /v1/activity`. Purge via `DELETE /v1/activity` (administrator action). Retention days: `INTELACRAFT_AUDIT_RETENTION_DAYS`.

## Admin commands

Configure `INTELACRAFT_ADMIN_COMMANDS` as JSON:

```json
{"time_day":{"command":"time set day","risk":"normal","label":"Set time to day"}}
```

Mirror the same map in BDS variable `intelacraft:admin_commands`. Only `commandId` values from this allowlist can run.

## Incident response

1. Enable emergency disable.
2. Cancel active builds (`control.cancel` / webview Cancel).
3. Inspect `/v1/activity` and the audit file for correlated `taskId` / `actionId` / `operationId`.
4. Restore from BDS backup if world state is wrong.
5. Rotate `INTELACRAFT_BDS_TOKEN` and BDS secret if compromise is suspected.

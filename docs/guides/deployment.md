# Deployment Guide

## Local Development

Start controller:
```powershell
npm run dev
```

Controller serves webview at `/` and API at `/v1/*`.

## BDS Setup

1. Set `BDS_PATH` in `.env` to your BDS installation
2. Configure BDS:
   ```powershell
   npm run configure-bds
   ```
   Writes BDS config files: `variables.json`, `secrets.json`, `permissions.json`
3. Deploy packs:
   ```powershell
   npm run deploy
   ```

## Pack Deployment

`scripts/deploy.mjs` handles deployment:
- If `BDS_PATH` is set in `.env`, runs `configure-bds` to write BDS config files (`variables.json`, `secrets.json`, `permissions.json`) and deploy packs.
- If `DEPLOY_PATH` is set in `apps/bedrock-addon/.env`, builds the addon and copies packs to the dev path.
- Dev mode: Copies to `development_behavior_packs/` and `development_resource_packs/`

## Environment Variables

**Required:**
- `INTELACRAFT_BDS_TOKEN` - Authentication token for BDS communication

**Optional:**
- `BDS_PATH` - Path to BDS installation
- `PORT` - Controller port (default: 8787)

See `docs/reference/configuration.md` for full list.

## Production Considerations

- Localhost-only binding (`127.0.0.1:8787`)
- No Docker support (runs as local Node.js process)
- In-memory stores (no persistence across restarts except audit/activity)
- JSONL audit log (append-only)

## Systemd / Background Service

To run the controller as a background service on Linux:

1. Create a systemd unit file at `/etc/systemd/system/intelacraft.service`:

```ini
[Unit]
Description=IntelaCraft Controller
After=network.target

[Service]
Type=simple
User=minecraft
WorkingDirectory=/opt/intelacraft
ExecStart=/usr/bin/node services/controller/dist/index.js
Restart=on-failure
RestartSec=5
EnvironmentFile=/opt/intelacraft/.env

[Install]
WantedBy=multi-user.target
```

2. Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable intelacraft
sudo systemctl start intelacraft
```

3. Check status:

```bash
sudo systemctl status intelacraft
sudo journalctl -u intelacraft -f
```

On Windows, use NSSM or run under a Task Scheduler task with `node` as the executable.

## Resource Requirements

### Minimum

- **CPU**: 1 core, 1 GHz
- **Memory**: 512 MB (controller + BDS share the machine)
- **Disk**: 100 MB for IntelaCraft + BDS world data
- **Network**: Loopback only (no external ports needed)

### Recommended

- **CPU**: 2+ cores
- **Memory**: 2 GB (1 GB controller, 1 GB BDS)
- **Disk**: 1 GB+ (depends on world size and audit retention)
- **Network**: Stable connection to AI provider API

### Scaling Notes

- Controller memory grows with activity history. Restart to clear in-memory state.
- Audit log grows linearly. Configure `INTELACRAFT_AUDIT_RETENTION_DAYS` for auto-purge.
- Pi session storage grows with conversation history. Old sessions can be cleaned manually.
- Single-instance only. No horizontal scaling support.

## Update Procedure

### Step 1: Stop the Controller

```bash
# Linux
sudo systemctl stop intelacraft

# Windows (if running as service)
# Stop via Task Scheduler or task manager
```

### Step 2: Backup Data

```bash
cp -r data/ data-backup-$(date +%Y%m%d)/
cp .env .env.backup
```

### Step 3: Update Code

```bash
git pull origin main
```

### Step 4: Rebuild

```bash
npm install    # Update dependencies
npm run build  # Rebuild all packages
```

### Step 5: Deploy Packs (if addon changed)

```powershell
npm run deploy
```

### Step 6: Restart

```bash
# Linux
sudo systemctl start intelacraft

# Windows
npm run dev
```

### Step 7: Verify

```bash
npm run health
```

## Data Persistence

The following files persist across controller restarts:

| File | Location | Description |
|------|----------|-------------|
| `providers.json` | `INTELACRAFT_PROVIDERS_PATH` (default: `./data/providers.json`) | AI provider configurations (API keys, models, active provider) |
| `audit.jsonl` | `INTELACRAFT_AUDIT_PATH` (default: `./data/audit.jsonl`) | Append-only log of all executed actions |
| Activity records | In-memory (lost on restart) | Recent activity history |
| Pi sessions | `INTELACRAFT_PI_STORAGE_PATH` (default: `./data/pi-sessions/`) | AI agent conversation history and plans |
| `.env` | Project root | Environment configuration |
| `data/` directory | Project root | All persistent data files |

### What Does NOT Persist

- **Action queue**: Pending actions are lost on restart
- **Task state**: In-progress tasks are lost on restart
- **SSE connections**: All active streams disconnect
- **Pi session state**: Running sessions must be restarted from their last saved point

## Health Monitoring

Check status:
```powershell
npm run health
```

Or use endpoint:
```
GET /v1/health
```

BDS sends heartbeat every 6 seconds.

## Incident Response

Emergency disable via webview or:
```powershell
curl -X POST http://127.0.0.1:8787/v1/emergency-disable
```

See `docs/ops/runbook.md` for full procedures.

## PowerShell Launcher

`dev.ps1` wraps all npm scripts:
```powershell
.\dev.ps1 setup
.\dev.ps1
.\dev.ps1 health
.\dev.ps1 test
```
# Build & Deploy

Build system, deployment modes, BDS configuration, and pack manifests for the IntelaCraft bedrock addon.

## Build System

### esbuild (`scripts/build.js`)

Bundles `src/main.ts` into `behavior_pack/scripts/main.js`.

```javascript
esbuild.buildSync({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "esm",
  target: "es2020",
  outfile: "behavior_pack/scripts/main.js",
  external: [
    "@minecraft/server",
    "@minecraft/server-ui",
    "@minecraft/server-net",
    "@minecraft/server-admin",
  ],
  alias: {
    "@intelacraft/shared-protocol": "<repo>/packages/shared-protocol/src/index.ts",
  },
});
```

**Key details**:
- `@minecraft/*` modules are **externalized** — they are provided by the BDS runtime, not bundled
- `@intelacraft/shared-protocol` is **aliased** to the local monorepo source for in-repo builds
- Output is ESM format targeting ES2020

**Command**: `npm run build` (runs `node scripts/build.js`)

---

## Deployment Modes

### Dev Deployment

Copies packs directly into the BDS `development_*_packs` folders for live reload.

```
scripts/deploy.js dev
```

**Process**:
1. Runs build (unless `SKIP_BUILD` is set)
2. Reads `DEPLOY_PATH` from `apps/bedrock-addon/.env`
3. Removes and recreates `development_behavior_packs/IntelaCraft_bp/`
4. Copies `behavior_pack/` contents to destination
5. Removes and recreates `development_resource_packs/IntelaCraft_rp/`
6. Copies `resource_pack/` contents to destination

**Required `.env` variable**:

```
DEPLOY_PATH=/path/to/bds
```

**Command**: `npm run deploy:dev`

---

### Prod Deployment

Creates `.mcpack` files (zipped packs) and combines them into a `.mcaddon` for distribution.

```
scripts/deploy.js prod
```

**Process**:
1. Runs build (unless `SKIP_BUILD` is set)
2. Reads `DOWNLOAD_PATH` from `apps/bedrock-addon/.env`
3. Zips `behavior_pack/` → `IntelaCraft_BP.mcpack`
4. Zips `resource_pack/` → `IntelaCraft_RP.mcpack`
5. Combines both into `IntelaCraft.mcaddon`
6. If `DEV_PACK=1`, names the output `IntelaCraft-dev.mcaddon`

**Required `.env` variable**:

```
DOWNLOAD_PATH=/path/to/output
```

**Command**: `npm run deploy:prod`

---

### Interactive Bundler (`scripts/bundle.js`)

Interactive packager that prompts for dev/release mode and patches manifests accordingly.

```
npm run bundle
```

**Process**:
1. Prompts: *"Is this a dev pack? (y/N)"*
2. If dev: appends `-dev` suffix to manifest `header.name` fields
3. Runs `npm run build`
4. Runs `deploy.js prod` with `SKIP_BUILD=1`
5. Restores original manifests after packaging

---

## BDS Configuration

### Configuration Script

`scripts/configure-bds.mjs` writes configuration files to BDS `config/default/`.

### variables.json

```json
{
  "intelacraft:controller_url": "http://127.0.0.1:8787",
  "intelacraft:server_id": "bds-default",
  "intelacraft:admin_commands": "{\"time_day\":{\"command\":\"time set day\",\"risk\":\"normal\",\"label\":\"Set time to day\"}}"
}
```

### secrets.json

```json
{
  "intelacraft:bds_token": "Bearer dev-change-me"
}
```

**Important**: The token must be the **full Authorization header value** (e.g. `"Bearer <token>"`). The addon cannot concatenate `SecretString` values in script.

### permissions.json

```json
{
  "allowed_modules": [
    "@minecraft/server",
    "@minecraft/server-ui",
    "@minecraft/server-net",
    "@minecraft/server-admin"
  ]
}
```

All four modules must be listed for the addon to function.

### Merge Behavior

The configuration script **merges** with existing BDS config files — it does not wipe other keys. This allows coexistence with other addons.

---

## Pack Manifests

### Behavior Pack (`behavior_pack/manifest.json`)

```json
{
  "format_version": 2,
  "header": {
    "name": "IntelaCraft",
    "uuid": "f6606124-59dd-4de1-aa92-a43a4f8fc46c",
    "version": [1, 0, 0],
    "min_engine_version": [1, 21, 60]
  },
  "modules": [
    {
      "type": "data",
      "uuid": "bf0b9d75-d200-4702-86f2-7a6b3b777448",
      "version": [1, 0, 0]
    },
    {
      "type": "script",
      "uuid": "11f742cc-8e1e-4201-8c1d-eac198d99fbd",
      "version": [1, 0, 0],
      "language": "javascript",
      "entry": "scripts/main.js"
    }
  ],
  "dependencies": [
    { "module_name": "@minecraft/server",    "version": "2.9.0-beta" },
    { "module_name": "@minecraft/server-ui",  "version": "2.2.0-beta" },
    { "module_name": "@minecraft/server-net",  "version": "1.0.0-beta" },
    { "module_name": "@minecraft/server-admin", "version": "1.0.0-beta" }
  ]
}
```

- **format_version**: 2
- **min_engine_version**: 1.21.60
- **Modules**: `data` (behavior pack data) + `script` (JavaScript entry point)
- **Script entry**: `scripts/main.js` (bundled output)

### Resource Pack (`resource_pack/manifest.json`)

```json
{
  "format_version": 2,
  "header": {
    "name": "IntelaCraft RP",
    "uuid": "9eb10a28-5085-4b04-8e76-70302a1ff48e",
    "version": [1, 0, 0],
    "min_engine_version": [1, 21, 60]
  },
  "modules": [
    {
      "type": "resources",
      "uuid": "b977f792-7d91-4b86-94ff-7ad1aebe33fd",
      "version": [1, 0, 0]
    }
  ],
  "dependencies": [
    {
      "uuid": "f6606124-59dd-4de1-aa92-a43a4f8fc46c",
      "version": "1.0.0"
    }
  ]
}
```

- **Dependency**: Links to the behavior pack UUID (`f6606124-...`)
- **Module type**: `resources` (required for resource packs)

---

## npm Scripts Summary

| Command | Script | Description |
|---------|--------|-------------|
| `npm run build` | `scripts/build.js` | Bundle TypeScript via esbuild |
| `npm run deploy:dev` | `scripts/deploy.js dev` | Deploy to BDS dev folders |
| `npm run deploy:prod` | `scripts/deploy.js prod` | Create .mcaddon for distribution |
| `npm run bundle` | `scripts/bundle.js` | Interactive .mcaddon packager |
| `npm run typecheck` | `tsc --noEmit` | Type-check without emitting |

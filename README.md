# IntelaCraft

IntelaCraft is an AI-assisted control system for Minecraft Bedrock Dedicated Server. It is planned as a multi-component project; the Bedrock add-on is the first implemented component.

See the [product and technical specification](docs/SPEC.md) for the intended architecture, security model, requirements, and delivery phases.

## Repository layout

```text
apps/
  bedrock-addon/       Current behavior pack, resource pack, and build tools
  webview/             Reserved for the future control interface
services/
  controller/          Reserved for the future controller service
packages/              Reserved for shared protocol, tools, and Pi/MCP integrations
docs/
  SPEC.md              Product and technical specification
```

Empty future components are documented here but are not scaffolded until development begins.

## Bedrock add-on development

Run commands from `apps/bedrock-addon`:

```powershell
cd apps/bedrock-addon
npm install
npm run typecheck
npm run build
```

Deployment uses a local `.env` file in that directory:

```text
DEPLOY_PATH=<Minecraft data directory>
DOWNLOAD_PATH=<release output directory>
```

Available scripts:

- `npm run deploy:dev` builds and copies both packs to the configured development folders.
- `npm run deploy:prod` builds a distributable `.mcaddon`.
- `npm run bundle` interactively chooses development or production pack naming.

# IntelaCraft Product and Technical Specification

**Status:** Draft 1  
**Target:** Minecraft Bedrock Dedicated Server (BDS)  
**Product type:** AI-assisted server control add-on  

## 1. Purpose

IntelaCraft lets an authorized user describe work to perform on a live Minecraft Bedrock server, inspect the AI-generated plan, approve meaningful changes, and monitor safe execution. The system combines a BDS behavior pack, an isolated Pi Coding Agent runtime, direct world-control tools, the user's existing Bedrock Script API MCP, an external controller, and a web interface.

The first complete release must provide a dependable, auditable path from a natural-language request to bounded and validated world changes. An AI prompt is never a security boundary; every operation is validated at the controller and behavior-pack layers.

## 2. Goals and Non-Goals

### 2.1 Goals

- Connect one IntelaCraft instance to one selected BDS server.
- Use a user-selected AI model through an isolated Pi runtime.
- Let the agent inspect players and world state before acting.
- Execute typed, bounded world operations through direct tools.
- Require approval according to configurable risk policies.
- Show plans, approval requests, progress, results, and failures.
- Support cancellation, emergency disable, logging, and practical rollback data.
- Use the Bedrock Script API MCP as an advisory knowledge source.

### 2.2 Non-Goals for the Initial Release

- Autonomous access to servers the user has not explicitly configured.
- Unrestricted shell, filesystem, or arbitrary BDS command access.
- Simultaneous control of multiple BDS servers from one active session.
- A public marketplace for prompts, tools, or models.
- Guaranteed rollback of every Minecraft side effect.
- Replacing normal server administration, backups, or access control.
- Training or fine-tuning AI models.

## 3. Users and Core Use Cases

The primary user is a BDS owner or trusted administrator. Optional future roles include builder, moderator, and observer.

Core use cases:

1. Ask questions about current players, entities, blocks, regions, scores, weather, time, and game rules.
2. Request a structure or terrain modification within an explicitly bounded region.
3. Perform approved administrative actions such as teleporting a player or changing a game rule.
4. Watch a long operation progress in safe batches and cancel it.
5. Review an audit trail showing who requested, approved, and executed each action.

## 4. System Architecture

```text
IntelaCraft Webview
        |
External Controller ---- Isolated Pi Coding Agent
        |                    |             |
        |                    |             +-- Bedrock Script API MCP (advisory)
        |                    +---------------- Direct World Tools
        |
Authenticated transport
        |
BDS Behavior Pack (trusted executor)
        |
Minecraft World
```

### 4.1 Trust Boundaries

- The webview is untrusted for secrets and authorization decisions.
- Model output and Pi tool requests are untrusted input.
- The controller authenticates clients, applies policy, records approvals, validates schemas and limits, and routes requests.
- The behavior pack independently validates every requested operation and is the final authority for world changes.
- The MCP supplies documentation and guidance only; it does not execute world changes.


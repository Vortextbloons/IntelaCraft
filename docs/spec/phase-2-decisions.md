# Phase 2 Decisions

- Maximum bounded build: 32,768 blocks; maximum batch: 512 blocks per tick.
- Builds above 4,096 blocks and air fills require strong confirmation.
- Rollback capture is capped at 8,192 original block records and reports coverage metadata.
- Protected and builder regions are inclusive boxes configured through controller environment state.
- Approval SHA-256 hashes bind action ID, idempotency key, tool, arguments, actor, mode, risk, and expiry. Approval freshness is five minutes.
- Emergency disable rejects new controller mutations and is checked independently by the add-on at batch boundaries.

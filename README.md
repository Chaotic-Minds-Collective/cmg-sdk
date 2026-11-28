# CMG SDK

Shared TypeScript contracts and runtime clients for the Chaotic Minds Gaming (CMG) Core API, website, Discord bot, and game adapters.

## Principles
- The contract modules (`src/contracts.ts`, `src/events.ts`, `src/index.ts`) stay dependency-free: no database connection, no secrets, no import-time I/O.
- Runtime modules act only when called. `src/client.ts` issues authenticated Core API requests, `src/reward-worker.ts` claims, renews and acknowledges reward leases around a caller-supplied handler, and `src/plugin-agent.ts` reconciles Core's desired plugin state through a caller-supplied runtime adapter.
- The SDK opens no database connection and holds no credentials of its own; callers supply the service token.
- Stable, versioned API and event shapes.
- Game adapters expose capabilities explicitly; unsupported operations must not be guessed.
- External identifiers remain strings and are namespaced by provider/game.

## Entry points
- `@chaotic-minds-gaming/sdk` — contracts, event types and helpers.
- `@chaotic-minds-gaming/sdk/events` — event contracts.
- `@chaotic-minds-gaming/sdk/core` — `CoreApiClient`.
- `@chaotic-minds-gaming/sdk/rewards` — `processRewardBatch` and reward delivery types.

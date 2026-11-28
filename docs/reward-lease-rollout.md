# Fenced reward-lease rollout (Core contract 0.4.0)

Coordinate this SDK with the Core reward-lease renewal API before enabling reward fulfillment. Core ships the additive reward lease-token migration (`025_reward_lease_fencing.sql`), the renewal permission (`031_reward_lease_renewal.sql`) and the claim/renew/ack routes; apply those migrations and deploy Core before enabling fulfillment. This SDK change does not enable a worker or grant items by itself.

## Worker contract

- Every claim returns an opaque `leaseToken` and a lease expiry.
- The worker can request a 15–300 second lease and renew it while a delivery handler is still running.
- Acknowledgements must echo the exact current lease token. A token changes when the same service reclaims a job.
- The worker fails closed on missing, invalid, or expired leases and does not acknowledge after lease renewal is lost.
- Delivery handlers receive an `AbortSignal` and must stop work when it is aborted.
- Game handlers must durably deduplicate grants using `idempotencyKey`. Fencing an API acknowledgement does not make an external game-side grant exactly-once: a grant can succeed before its acknowledgement fails.
- If the game grant may have succeeded but Core acknowledgement cannot be confirmed, do not blindly repeat the grant. Reconcile the game-side receipt/inventory state before retrying.

The worker and Core API are available as the SDK subpaths `@chaotic-minds-gaming/sdk/core` and `@chaotic-minds-gaming/sdk/rewards`.

## Rollout order

1. Apply Core's reward lease-token and renewal migrations and deploy Core with the claim/renew/ack routes.
2. Publish/use this SDK version.
3. Implement the game-specific delivery handler with durable idempotency and game-thread dispatch.
4. Validate the complete flow against an isolated server and a test player.
5. Enable fulfillment only after duplicate-grant, lease-expiry, worker-restart, acknowledgement-loss, and player-disconnect scenarios pass.

No production migrations, live operations, or game grants are performed by this SDK package.

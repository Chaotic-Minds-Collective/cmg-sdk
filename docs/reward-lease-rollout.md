# Fenced reward-lease rollout (Core contract 0.4.0)

Coordinate this SDK with the Core audit-repair draft before enabling reward fulfillment. Core must apply its additive reward lease-token migration and deploy its claim/ack routes first. This change does not enable a worker or grant items.

Every claim returns an opaque `leaseToken`. Acknowledgements must echo that exact token; the token changes when the same service reclaims a job. The worker fails closed on missing, invalid or expired leases. Old claim responses cannot authorize a grant. Ordinary catalogue/identity clients are unaffected.

Game handlers must still durably deduplicate grants using `idempotencyKey`. Fencing an API acknowledgement does not make an external game-side grant exactly-once. A grant can succeed before its acknowledgement fails. Do not blindly repeat such a grant.

Validate both draft PRs together against an isolated test environment before merging/enabling fulfillment. No production migrations or live operations have been performed.

import type { CoreApiClient } from "./client.js";
import type { RewardDelivery } from "./contracts.js";

export interface RewardDeliveryContext {
  /** Abort work immediately when Core lease renewal fails or the lease expires. */
  signal: AbortSignal;
}

export interface RewardDeliveryHandler {
  (reward: RewardDelivery, context: RewardDeliveryContext): Promise<Record<string, unknown> | void>;
}

export interface RewardBatchResult {
  claimed: number;
  delivered: number;
  failed: number;
  acknowledgementFailures: number;
  leaseRenewalFailures: number;
}

export class RewardLeaseRenewalError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "RewardLeaseRenewalError";
  }
}

type RewardWorkerClient = Pick<CoreApiClient, "claimRewards" | "acknowledgeReward" | "renewRewardLease">;

function validLease(reward: RewardDelivery): boolean {
  const expiresAt = typeof reward.leaseExpiresAt === "string" ? Date.parse(reward.leaseExpiresAt) : Number.NaN;
  return typeof reward.leaseToken === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reward.leaseToken)
    && Number.isFinite(expiresAt)
    && expiresAt > Date.now()
    && typeof reward.idempotencyKey === "string"
    && reward.idempotencyKey.length >= 8
    && typeof reward.targetExternalId === "string"
    && reward.targetExternalId.trim().length > 0
    && !!reward.deliveryPayload
    && typeof reward.deliveryPayload === "object"
    && !Array.isArray(reward.deliveryPayload);
}

async function deliverWithLeaseRenewal(
  client: RewardWorkerClient,
  serverId: string,
  reward: RewardDelivery,
  deliver: RewardDeliveryHandler,
  leaseSeconds: number,
  renewalIntervalMs: number
): Promise<Record<string, unknown> | void> {
  const controller = new AbortController();
  let leaseExpiresAt = Date.parse(reward.leaseExpiresAt);
  let renewalError: RewardLeaseRenewalError | null = null;
  let renewalTimer: ReturnType<typeof setTimeout> | undefined;
  let renewalInFlight: Promise<void> | undefined;
  let stopped = false;

  const scheduleRenewal = () => {
    if (!stopped && !renewalError) {
      renewalTimer = setTimeout(() => {
        renewalInFlight = (async () => {
          try {
            const result = await client.renewRewardLease(serverId, reward.id, {
              leaseToken: reward.leaseToken,
              leaseSeconds,
            });
            const data = result?.data;
            const nextExpiry = typeof data?.leaseExpiresAt === "string" ? Date.parse(data.leaseExpiresAt) : Number.NaN;
            if (data?.renewed !== true || data.rewardId !== reward.id || !Number.isFinite(nextExpiry) || nextExpiry <= Date.now()) {
              throw new Error("Core did not confirm a valid renewed reward lease.");
            }
            leaseExpiresAt = nextExpiry;
          } catch (error) {
            renewalError = new RewardLeaseRenewalError("Core reward lease renewal failed; delivery must stop.", { cause: error });
            controller.abort(renewalError);
          } finally {
            renewalInFlight = undefined;
            scheduleRenewal();
          }
        })();
      }, renewalIntervalMs);
    }
  };

  scheduleRenewal();

  let receipt: Record<string, unknown> | void;
  let deliveryError: unknown;
  let deliveryFailed = false;
  try {
    receipt = await deliver(reward, { signal: controller.signal });
  } catch (error) {
    deliveryFailed = true;
    deliveryError = error;
  } finally {
    stopped = true;
    if (renewalTimer) clearTimeout(renewalTimer);
    // A renewal may already be in flight when the handler finishes. Wait for
    // it before deciding whether this receipt is safe to acknowledge.
    if (renewalInFlight) await renewalInFlight;
  }

  // Check only after the in-flight renewal settles: it may fail after the
  // delivery handler returns but before this worker can safely acknowledge.
  if (renewalError) throw renewalError;
  if (deliveryFailed) throw deliveryError;
  if (leaseExpiresAt <= Date.now()) {
    throw new RewardLeaseRenewalError("The reward lease expired before the game grant completed.");
  }
  return receipt;
}

/**
 * Core provides at-least-once jobs with fenced leases. Game handlers MUST
 * durably deduplicate by idempotencyKey because the game grant can succeed
 * before its Core acknowledgement is lost.
 */
export async function processRewardBatch(
  client: RewardWorkerClient,
  serverId: string,
  deliver: RewardDeliveryHandler,
  {
    limit = 10,
    leaseSeconds = 120,
    renewalIntervalMs = 60_000,
    onError = () => {},
  }: {
    limit?: number;
    leaseSeconds?: number;
    renewalIntervalMs?: number;
    onError?: (error: unknown, reward: RewardDelivery) => void;
  } = {}
): Promise<RewardBatchResult> {
  if (typeof client.renewRewardLease !== "function") {
    throw new TypeError("CoreApiClient must support reward lease renewal before claiming work");
  }
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 15 || leaseSeconds > 300) {
    throw new TypeError("leaseSeconds must be an integer between 15 and 300");
  }
  if (!Number.isInteger(renewalIntervalMs) || renewalIntervalMs < 1 || renewalIntervalMs >= leaseSeconds * 1000) {
    throw new TypeError("renewalIntervalMs must be positive and shorter than the reward lease");
  }

  const claimed = await client.claimRewards(serverId, { limit, leaseSeconds });
  const result: RewardBatchResult = {
    claimed: claimed.data.length,
    delivered: 0,
    failed: 0,
    acknowledgementFailures: 0,
    leaseRenewalFailures: 0,
  };

  for (const reward of claimed.data) {
    if (!validLease(reward)) {
      result.failed += 1;
      onError(new Error("A valid, unexpired fenced reward lease and idempotent target payload are required before delivery."), reward);
      continue;
    }

    try {
      const receipt = await deliverWithLeaseRenewal(
        client, serverId, reward, deliver, leaseSeconds, renewalIntervalMs
      );
      try {
        await client.acknowledgeReward(serverId, reward.id, {
          leaseToken: reward.leaseToken,
          outcome: "delivered",
          response: receipt ?? {},
        });
        result.delivered += 1;
      } catch (error) {
        result.acknowledgementFailures += 1;
        onError(error, reward);
      }
    } catch (error) {
      if (error instanceof RewardLeaseRenewalError) {
        result.leaseRenewalFailures += 1;
        onError(error, reward);
        continue;
      }
      result.failed += 1;
      try {
        await client.acknowledgeReward(serverId, reward.id, {
          leaseToken: reward.leaseToken,
          outcome: "failed",
          error: error instanceof Error ? error.message.slice(0, 1000) : "Game reward delivery failed.",
        });
      } catch (ackError) {
        result.acknowledgementFailures += 1;
        onError(ackError, reward);
      }
      onError(error, reward);
    }
  }

  return result;
}

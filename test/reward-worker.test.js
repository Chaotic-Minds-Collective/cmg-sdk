import test from "node:test";
import assert from "node:assert/strict";
import { processRewardBatch } from "../dist/reward-worker.js";

const renewLease = async (_serverId, rewardId) => ({
  data: { renewed: true, rewardId, leaseExpiresAt: new Date(Date.now() + 120_000).toISOString() },
});

const reward = (id) => ({
  id,
  entitlementId: "entitlement-1",
  game: "atlas",
  targetExternalId: "76561198000000001",
  deliveryPayload: { itemKey: "medical-kit", quantity: 1 },
  attempts: 1,
  idempotencyKey: `reward-${id}-stable-key`,
  leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
  leaseToken: "ae2134a1-4bd4-4eb8-9ebc-456c38be9caa",
});

test("delivers claimed rewards and acknowledges with the provider receipt", async () => {
  let ack;
  let claim;
  const client = {
    claimRewards: async (_serverId, request) => { claim = request; return { data: [reward("r1")] }; },
    renewRewardLease: renewLease,
    acknowledgeReward: async (_serverId, rewardId, body) => {
      ack = { rewardId, body };
      return { data: { accepted: true, duplicate: false, rewardId, outcome: "delivered" } };
    },
  };
  const result = await processRewardBatch(client, "server-1", async (item) => {
    assert.equal(item.idempotencyKey, "reward-r1-stable-key");
    return { gameReceipt: "grant-1" };
  });
  assert.deepEqual(result, { claimed: 1, delivered: 1, failed: 0, acknowledgementFailures: 0, leaseRenewalFailures: 0 });
  assert.deepEqual(claim, { limit: 10, leaseSeconds: 120 });
  assert.equal(ack.body.outcome, "delivered");
  assert.equal(ack.body.leaseToken, reward("r1").leaseToken);
  assert.equal(ack.body.response.gameReceipt, "grant-1");
});

test("reports game delivery failures back to Core for retry", async () => {
  let ack;
  const client = {
    claimRewards: async () => ({ data: [reward("r2")] }),
    renewRewardLease: renewLease,
    acknowledgeReward: async (_serverId, rewardId, body) => {
      ack = { rewardId, body };
      return { data: { accepted: true, duplicate: false, rewardId, outcome: "failed" } };
    },
  };
  const result = await processRewardBatch(client, "server-1", async () => {
    throw new Error("Player is not currently online.");
  });
  assert.deepEqual(result, { claimed: 1, delivered: 0, failed: 1, acknowledgementFailures: 0, leaseRenewalFailures: 0 });
  assert.equal(ack.body.outcome, "failed");
  assert.equal(ack.body.error, "Player is not currently online.");
});

test("records acknowledgement failures without pretending delivery was confirmed", async () => {
  const client = {
    claimRewards: async () => ({ data: [reward("r3")] }),
    renewRewardLease: renewLease,
    acknowledgeReward: async () => { throw new Error("Core unavailable"); },
  };
  const result = await processRewardBatch(client, "server-1", async () => ({ gameReceipt: "grant-3" }));
  assert.deepEqual(result, { claimed: 1, delivered: 0, failed: 0, acknowledgementFailures: 1, leaseRenewalFailures: 0 });
});

test("renews a long-running reward lease before invoking the final acknowledgement", async () => {
  let renewals = 0;
  let acked = false;
  const client = {
    claimRewards: async () => ({ data: [reward("r4")] }),
    renewRewardLease: async (_serverId, rewardId, body) => {
      renewals += 1;
      assert.equal(rewardId, "r4");
      assert.equal(body.leaseToken, reward("r4").leaseToken);
      return { data: { renewed: true, rewardId, leaseExpiresAt: new Date(Date.now() + 120_000).toISOString() } };
    },
    acknowledgeReward: async (_serverId, rewardId) => {
      acked = true;
      return { data: { accepted: true, duplicate: false, rewardId, outcome: "delivered" } };
    },
  };
  const result = await processRewardBatch(client, "server-1", async (_item, { signal }) => {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 25);
      signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    });
    return { gameReceipt: "grant-4" };
  }, { leaseSeconds: 15, renewalIntervalMs: 5 });
  assert.ok(renewals >= 1);
  assert.equal(acked, true);
  assert.equal(result.delivered, 1);
  assert.equal(result.leaseRenewalFailures, 0);
});

test("stops delivery and does not acknowledge after lease renewal is rejected", async () => {
  let ackCalls = 0;
  const client = {
    claimRewards: async () => ({ data: [reward("r5")] }),
    renewRewardLease: async () => { throw new Error("lease lost"); },
    acknowledgeReward: async () => { ackCalls += 1; },
  };
  const result = await processRewardBatch(client, "server-1", async (_item, { signal }) => {
    await new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  }, { leaseSeconds: 15, renewalIntervalMs: 5 });
  assert.equal(ackCalls, 0);
  assert.equal(result.leaseRenewalFailures, 1);
});

for (const kind of ["missing token", "invalid token", "expired lease", "invalid expiry", "non-string expiry", "missing idempotency key", "missing target", "invalid payload"]) {
  test(`does not grant or acknowledge a reward with ${kind}`, async () => {
    const item = reward("unsafe");
    if (kind === "missing token") delete item.leaseToken;
    if (kind === "invalid token") item.leaseToken = "invalid";
    if (kind === "expired lease") item.leaseExpiresAt = new Date(0).toISOString();
    if (kind === "invalid expiry") item.leaseExpiresAt = "invalid";
    if (kind === "non-string expiry") item.leaseExpiresAt = ["2099-01-01T00:00:00.000Z"];
    if (kind === "missing idempotency key") item.idempotencyKey = "";
    if (kind === "missing target") item.targetExternalId = " ";
    if (kind === "invalid payload") item.deliveryPayload = [];
    let grants = 0;
    let acknowledgements = 0;
    const client = {
      claimRewards: async () => ({ data: [item] }),
      renewRewardLease: renewLease,
      acknowledgeReward: async () => { acknowledgements += 1; },
    };
    const result = await processRewardBatch(client, "server-1", async () => { grants += 1; });
    assert.equal(grants, 0);
    assert.equal(acknowledgements, 0);
    assert.equal(result.failed, 1);
  });
}

test("does not acknowledge when an in-flight renewal fails after the delivery handler returns", async () => {
  let ackCalls = 0;
  let startRenewal;
  let finishHandler;
  let rejectRenewal;
  const renewalStarted = new Promise((resolve) => { startRenewal = resolve; });
  const handlerFinished = new Promise((resolve) => { finishHandler = resolve; });
  const renewalPending = new Promise((_resolve, reject) => { rejectRenewal = reject; });

  const client = {
    claimRewards: async () => ({ data: [reward("r6")] }),
    renewRewardLease: async () => {
      startRenewal();
      return renewalPending;
    },
    acknowledgeReward: async () => { ackCalls += 1; },
  };

  const processing = processRewardBatch(client, "server-1", async () => {
    await renewalStarted;
    finishHandler();
    return { gameReceipt: "grant-6" };
  }, { leaseSeconds: 15, renewalIntervalMs: 5 });

  await handlerFinished;
  rejectRenewal(new Error("lease lost after handler completion"));

  const result = await processing;
  assert.equal(ackCalls, 0);
  assert.deepEqual(result, {
    claimed: 1,
    delivered: 0,
    failed: 0,
    acknowledgementFailures: 0,
    leaseRenewalFailures: 1,
  });
});

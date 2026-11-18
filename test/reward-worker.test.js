import test from "node:test";
import assert from "node:assert/strict";
import { processRewardBatch } from "../dist/reward-worker.js";

const reward = (id) => ({
  id,
  entitlementId: "entitlement-1",
  game: "7dtd",
  targetExternalId: "steam-player-1",
  deliveryPayload: { item: "medical-kit", quantity: 1 },
  attempts: 1,
  idempotencyKey: `reward-${id}`,
  leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
  leaseToken: "ae2134a1-4bd4-4eb8-9ebc-456c38be9caa",
});

test("delivers claimed rewards and acknowledges with the provider receipt", async () => {
  let ack;
  const client = {
    claimRewards: async () => ({ data: [reward("r1")] }),
    acknowledgeReward: async (_serverId, rewardId, body) => {
      ack = { rewardId, body };
      return { data: { accepted: true, duplicate: false, rewardId, outcome: "delivered" } };
    },
  };
  const result = await processRewardBatch(client, "server-1", async (item) => {
    assert.equal(item.idempotencyKey, "reward-r1");
    return { gameReceipt: "grant-1" };
  });
  assert.deepEqual(result, { claimed: 1, delivered: 1, failed: 0, acknowledgementFailures: 0 });
  assert.equal(ack.body.outcome, "delivered");
  assert.equal(ack.body.leaseToken, reward("r1").leaseToken);
  assert.equal(ack.body.response.gameReceipt, "grant-1");
});

test("reports game delivery failures back to Core for retry", async () => {
  let ack;
  const client = {
    claimRewards: async () => ({ data: [reward("r2")] }),
    acknowledgeReward: async (_serverId, rewardId, body) => {
      ack = { rewardId, body };
      return { data: { accepted: true, duplicate: false, rewardId, outcome: "failed" } };
    },
  };
  const result = await processRewardBatch(client, "server-1", async () => {
    throw new Error("Player is not currently online.");
  });
  assert.deepEqual(result, { claimed: 1, delivered: 0, failed: 1, acknowledgementFailures: 0 });
  assert.equal(ack.body.outcome, "failed");
  assert.equal(ack.body.error, "Player is not currently online.");
});

test("records acknowledgement failures without pretending delivery was confirmed", async () => {
  const client = {
    claimRewards: async () => ({ data: [reward("r3")] }),
    acknowledgeReward: async () => { throw new Error("Core unavailable"); },
  };
  const result = await processRewardBatch(client, "server-1", async () => ({ gameReceipt: "grant-3" }));
  assert.deepEqual(result, { claimed: 1, delivered: 0, failed: 0, acknowledgementFailures: 1 });
});

for (const kind of ["missing token", "invalid token", "expired lease", "invalid expiry", "non-string expiry"]) {
  test(`does not grant or acknowledge a reward with ${kind}`, async () => {
    const item = reward("unsafe");
    if (kind === "missing token") delete item.leaseToken;
    if (kind === "invalid token") item.leaseToken = "invalid";
    if (kind === "expired lease") item.leaseExpiresAt = new Date(0).toISOString();
    if (kind === "invalid expiry") item.leaseExpiresAt = "invalid";
    if (kind === "non-string expiry") item.leaseExpiresAt = ["2099-01-01T00:00:00.000Z"];
    let grants = 0;
    let acknowledgements = 0;
    const client = {
      claimRewards: async () => ({ data: [item] }),
      acknowledgeReward: async () => { acknowledgements += 1; },
    };
    const result = await processRewardBatch(client, "server-1", async () => { grants += 1; });
    assert.equal(grants, 0);
    assert.equal(acknowledgements, 0);
    assert.equal(result.failed, 1);
  });
}

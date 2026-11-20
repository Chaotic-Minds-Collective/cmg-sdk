import test from "node:test";
import assert from "node:assert/strict";
import { CoreApiClient, CoreApiError } from "../dist/client.js";

test("rejects insecure remote Core URLs", () => {
  assert.throws(() => new CoreApiClient({ baseUrl: "http://core.example.test" }), /HTTPS/);
});

test("allows localhost development URL", () => {
  assert.doesNotThrow(() => new CoreApiClient({ baseUrl: "http://127.0.0.1:3001" }));
});

test("requires a token for authenticated operations", async () => {
  const client = new CoreApiClient({ baseUrl: "https://core.example.test" });
  await assert.rejects(client.getCurrentPlayer(), (error) => error instanceof CoreApiError && error.code === "TOKEN_REQUIRED");
});

test("sends a typed server heartbeat with bearer authentication", async () => {
  let captured;
  const client = new CoreApiClient({
    baseUrl: "https://core.example.test",
    token: "synthetic-service-token",
    fetchImpl: async (url, init) => {
      captured = { url: String(url), init };
      return new Response(JSON.stringify({ data: { accepted: true, serverId: "server-1", receivedAt: "2026-11-12T00:00:00.000Z" } }), { status: 202 });
    },
  });

  const result = await client.sendHeartbeat("server-1", {
    game: "7dtd",
    serverVersion: "2.5",
    adapterVersion: "0.1.0",
    online: true,
  });
  assert.equal(result.data.accepted, true);
  assert.equal(captured.init.headers.get("Authorization"), "Bearer synthetic-service-token");
  assert.equal(captured.init.redirect, "error");
});

test("sends idempotency keys for order creation", async () => {
  let captured;
  const client = new CoreApiClient({
    baseUrl: "https://core.example.test",
    token: "synthetic-player-token",
    fetchImpl: async (_url, init) => {
      captured = init;
      return new Response(JSON.stringify({ data: { orderId: "order-1", status: "pending" } }), { status: 201 });
    },
  });
  await client.createOrder({ currency: "USD", items: [] }, "checkout-123456");
  assert.equal(captured.headers.get("Idempotency-Key"), "checkout-123456");
});

test("claims pending game rewards with the server-scoped service credential", async () => {
  let captured;
  const client = new CoreApiClient({
    baseUrl: "https://core.example.test",
    token: "synthetic-reward-worker-token",
    fetchImpl: async (url, init) => {
      captured = { url: String(url), init };
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    },
  });
  await client.claimRewards("server-1", { limit: 5 });
  assert.match(captured.url, /\/integrations\/servers\/server-1\/rewards\/claim$/);
  assert.equal(JSON.parse(captured.init.body).limit, 5);
});

test("acknowledges a game reward delivery", async () => {
  let captured;
  const client = new CoreApiClient({
    baseUrl: "https://core.example.test",
    token: "synthetic-reward-worker-token",
    fetchImpl: async (url, init) => {
      captured = { url: String(url), init };
      return new Response(JSON.stringify({ data: { accepted: true, duplicate: false, rewardId: "reward-1", outcome: "delivered" } }), { status: 202 });
    },
  });
  await client.acknowledgeReward("server-1", "reward-1", {
    outcome: "delivered",
    response: { providerReceipt: "grant-123" },
  });
  assert.match(captured.url, /\/rewards\/reward-1\/ack$/);
  assert.equal(JSON.parse(captured.init.body).outcome, "delivered");
});


test("resolves only verified external player identities through the server-scoped Core API", async () => {
  let captured;
  const client = new CoreApiClient({
    baseUrl: "https://core.example.test",
    token: "synthetic-game-event-token",
    fetchImpl: async (url, init) => {
      captured = { url: String(url), init };
      return new Response(JSON.stringify({ data: { linked: true, principalId: "player-1", username: "danielle", displayName: "Player" } }), { status: 200 });
    },
  });
  const result = await client.resolvePlayerIdentity("server-1", { provider: "steam", externalId: "76561198000000000" });
  assert.equal(result.data.linked, true);
  assert.equal(result.data.principalId, "player-1");
  assert.match(captured.url, /\/players\/resolve$/);
  assert.equal(JSON.parse(captured.init.body).provider, "steam");
});


test("claims, renews, and acknowledges ATLAS color-token applications through the server-scoped API", async () => {
  const captured = [];
  const client = new CoreApiClient({
    baseUrl: "https://core.example.test",
    token: "synthetic-color-token-worker-token",
    fetchImpl: async (url, init) => {
      captured.push({ url: String(url), init });
      const path = String(url);
      if (path.endsWith("/claim")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      if (path.endsWith("/renew")) return new Response(JSON.stringify({ data: { renewed: true, applicationId: "application-1", leaseExpiresAt: "2026-11-20T18:00:00.000Z" } }), { status: 200 });
      return new Response(JSON.stringify({ data: { accepted: true, duplicate: false, applicationId: "application-1", status: "applied" } }), { status: 202 });
    },
  });

  const claimed = await client.claimAtlasColorTokenApplications("server-1", { limit: 4 });
  assert.deepEqual(claimed.data, []);
  const renewed = await client.renewAtlasColorTokenApplicationLease("server-1", "application-1", {
    leaseToken: "00000000-0000-4000-8000-000000000000",
    leaseSeconds: 180,
  });
  assert.equal(renewed.data.renewed, true);
  const acknowledged = await client.acknowledgeAtlasColorTokenApplication("server-1", "application-1", {
    leaseToken: "00000000-0000-4000-8000-000000000000",
    outcome: "applied",
  });
  assert.equal(acknowledged.data.status, "applied");
  assert.match(captured[0].url, /\/atlas\/color-token-applications\/claim$/);
  assert.match(captured[1].url, /\/atlas\/color-token-applications\/application-1\/renew$/);
  assert.equal(JSON.parse(captured[1].init.body).leaseSeconds, 180);
  assert.match(captured[2].url, /\/atlas\/color-token-applications\/application-1\/ack$/);
  assert.equal(captured[0].init.headers.get("Authorization"), "Bearer synthetic-color-token-worker-token");
});

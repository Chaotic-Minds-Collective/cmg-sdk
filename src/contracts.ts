export const CORE_API_CONTRACT_VERSION = "0.4.0" as const;

export type GameKey = "atlas" | "7dtd" | "ark";
export type PluginGame = GameKey | "platform";
export type ScopeType = "platform" | "game" | "cluster" | "server" | "guild";
export type PluginLifecycleStatus =
  | "DISCOVERED"
  | "VALIDATED"
  | "ENABLED"
  | "HEALTHY"
  | "DEGRADED"
  | "DISABLED"
  | "REMOVED";

export interface ApiSuccess<T> {
  data: T;
  requestId?: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId?: string;
}

export interface PlayerProfile {
  id: string;
  username: string;
  displayName: string | null;
  status: "active" | "suspended" | "disabled" | "deletion_pending";
  createdAt: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  productType: string;
  currency: string;
  amountMinor: string;
}

export interface Entitlement {
  id: string;
  status: string;
  grantedAt: string;
  expiresAt: string | null;
  sku: string;
  name: string;
  productType: string;
}

export interface CreateOrderRequest {
  currency: string;
  items: Array<{ productId: string; quantity: number }>;
}

export interface CreateOrderResponse {
  orderId: string;
  status: string;
  currency?: string;
  totalMinor?: string;
  reused?: boolean;
}

export interface GameServerStatus {
  id: string;
  name: string;
  gameKey: GameKey;
  clusterName: string;
  configuredStatus: string;
  isListed: boolean;
  publicHostname: string | null;
  gamePort: number | null;
  queryPort: number | null;
  maxPlayers: number | null;
  mapName: string | null;
  online: boolean;
  playerCount: number | null;
  serverVersion: string | null;
  adapterVersion: string | null;
  lastHeartbeat: string | null;
}

export interface ServerHeartbeat {
  game: GameKey;
  serverVersion: string;
  adapterVersion: string;
  online: boolean;
  playerCount?: number;
  observedAt?: string;
}

export type NormalizedGameEventType =
  | "player.joined"
  | "player.left"
  | "player.connected"
  | "player.disconnected"
  | "player.chat"
  | "player.died"
  | "player.killed"
  | "character.created"
  | "character.transferred"
  | "tribe.created"
  | "tribe.member.joined"
  | "tribe.member.left"
  | "tribe.updated"
  | "chat.global"
  | "chat.tribe"
  | "ship.sunk"
  | "ship.retrieved"
  | "structure.destroyed"
  | "tame.created"
  | "tame.died"
  | "server.started"
  | "server.stopped"
  | "server.state.changed";

export interface NormalizedGameEvent {
  game: GameKey;
  eventId: string;
  eventType: NormalizedGameEventType;
  occurredAt: string;
  scope?: { clusterId: string; gridId: string; serverId: string };
  correlationId?: string | null;
  payload: Record<string, unknown>;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  game: PluginGame;
  apiVersion: string;
  dependencies: string[];
  capabilities: string[];
  permissions: string[];
  compatibility: {
    gameBuilds: string[];
    serverApi: string[];
    operatingSystems: string[];
  };
  configSchema?: Record<string, unknown>;
}

export interface PluginSummary {
  id: string;
  name: string;
  game: PluginGame;
  latestVersion: string;
  status: PluginLifecycleStatus;
  capabilities: string[];
}

export interface PluginInstallation {
  id: string;
  pluginId: string;
  name: string;
  game: PluginGame;
  version: string;
  lifecycleStatus: PluginLifecycleStatus;
  desiredState: "enabled" | "disabled";
  healthMessage: string | null;
  lastHealthAt: string | null;
  updatedAt: string;
}

export interface PluginHealthReport {
  lifecycleStatus: Exclude<PluginLifecycleStatus, "DISCOVERED">;
  healthMessage?: string | null;
}

export interface SetPluginDesiredStateRequest {
  desiredState: "enabled" | "disabled";
}

export interface RewardDelivery {
  id: string;
  entitlementId: string;
  game: GameKey;
  targetExternalId: string;
  deliveryPayload: Record<string, unknown>;
  attempts: number;
  idempotencyKey: string;
  leaseExpiresAt: string;
  leaseToken: string;
}

export interface ClaimRewardsRequest {
  limit?: number;
  leaseSeconds?: number;
}

export interface AtlasColorTokenApplication {
  applicationId: string;
  entitlementId: string;
  tokenKind: "ship" | "tame" | "armor";
  ownerExternalId: string;
  assetId: string;
  selectedColor: unknown;
  serverId: string;
  clusterId: string;
  gridId: string;
  attempts: number;
  leaseExpiresAt: string;
  leaseToken: string;
}

export interface ClaimAtlasColorTokenApplicationsRequest {
  limit?: number;
}

export interface RenewAtlasColorTokenApplicationLeaseRequest {
  leaseToken: string;
  leaseSeconds?: number;
}

export interface RenewAtlasColorTokenApplicationLeaseResponse {
  renewed: boolean;
  applicationId: string;
  leaseExpiresAt: string;
}

export interface AcknowledgeAtlasColorTokenApplicationRequest {
  leaseToken: string;
  outcome: "applied" | "failed";
  errorCode?: string;
}

export interface AcknowledgeAtlasColorTokenApplicationResponse {
  accepted: boolean;
  duplicate: boolean;
  applicationId: string;
  status: "applied" | "failed";
}

export interface RenewRewardLeaseRequest {
  leaseToken: string;
  leaseSeconds?: number;
}

export interface RenewRewardLeaseResponse {
  renewed: boolean;
  rewardId: string;
  leaseExpiresAt: string;
}

export interface AcknowledgeRewardRequest {
  leaseToken: string;
  outcome: "delivered" | "failed";
  response?: Record<string, unknown>;
  error?: string;
}

export interface AcknowledgeRewardResponse {
  accepted: boolean;
  duplicate: boolean;
  rewardId: string;
  outcome?: "delivered" | "failed";
}

export interface ResolvePlayerIdentityRequest {
  provider: string;
  externalId: string;
}

export type ResolvePlayerIdentityResponse =
  | { linked: false }
  | { linked: true; principalId: string; username: string; displayName: string | null };

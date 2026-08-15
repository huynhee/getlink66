import crypto from "node:crypto";
import MarketplaceBehaviorEvent from "../models/MarketplaceBehaviorEvent.js";
import MarketplaceInterestProfile from "../models/MarketplaceInterestProfile.js";
import MarketplaceModel from "../models/MarketplaceModel.js";
import { normalizeAssetType } from "../data/marketplaceCatalogs.js";
import { invalidateMarketplaceHomeRecommendations } from "./marketplaceRecommendationService.js";

const EVENT_TTL_MS = 90 * 86_400_000;
const PROFILE_TTL_MS = 180 * 86_400_000;
const HALF_LIFE_MS = 30 * 86_400_000;
const EVENT_WEIGHTS = {
  impression: 0.15,
  detail_view: 1,
  click: 3,
  download: 8,
};

function signatureSecret() {
  return String(process.env.COOKIE_SIGNATURE_SECRET || process.env.JWT_SECRET || "development-marketplace-secret");
}

function hash(value) {
  return crypto.createHmac("sha256", signatureSecret()).update(String(value || "")).digest("hex");
}

export function marketplaceActorKey({ userId = "", sessionId = "" } = {}) {
  if (userId) return `user:${String(userId)}`;
  const normalized = String(sessionId || "").trim().slice(0, 160);
  return normalized ? `anon:${hash(normalized).slice(0, 40)}` : "";
}

export function marketplaceActorKeyFromRequest(req) {
  return marketplaceActorKey({
    userId: req.user?._id,
    sessionId: req.get?.("x-marketplace-session-id") || req.body?.sessionId || "",
  });
}

function values(value) {
  return [...new Set((Array.isArray(value) ? value : [value])
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean))];
}

function profileKeys(model) {
  return [
    ...values(model.categorySourceId).map((value) => `category:${value}`),
    ...values(model.parentCategorySourceId).map((value) => `parent:${value}`),
    ...values(model.renderer).map((value) => `renderer:${value}`),
    ...values(model.styles).map((value) => `style:${value}`),
    ...values(model.renderers).map((value) => `render:${value}`),
    ...values(model.forms).map((value) => `form:${value}`),
    ...values(model.colors).map((value) => `color:${value}`),
    ...values(model.materials).map((value) => `material:${value}`),
  ];
}

async function updateInterestProfile({ actorKey, userId, model, eventType, occurredAt }) {
  if (!actorKey || !model?._id) return;
  const existing = await MarketplaceInterestProfile.findOne({ actorKey }).lean();
  const elapsed = existing?.lastEventAt
    ? Math.max(0, occurredAt.getTime() - new Date(existing.lastEventAt).getTime())
    : 0;
  const decay = elapsed ? Math.pow(0.5, elapsed / HALF_LIFE_MS) : 1;
  const weights = {};
  for (const [key, value] of Object.entries(existing?.weights || {})) {
    const next = Number(value || 0) * decay;
    if (next >= 0.01) weights[key] = next;
  }
  const eventWeight = Number(EVENT_WEIGHTS[eventType] || 0);
  for (const key of profileKeys(model)) weights[key] = Number(weights[key] || 0) + eventWeight;
  const recentAssetIds = [
    String(model._id),
    ...(existing?.recentAssetIds || []).map(String).filter((id) => String(id) !== String(model._id)),
  ].slice(0, 60);
  await MarketplaceInterestProfile.findOneAndUpdate(
    { actorKey },
    {
      $set: {
        actorKey,
        ...(userId ? { userId } : {}),
        weights,
        recentAssetIds,
        lastEventAt: occurredAt,
        expiresAt: new Date(occurredAt.getTime() + PROFILE_TTL_MS),
      },
      $inc: { eventCount: 1 },
    },
    { upsert: true, new: true },
  );
}

export async function recordMarketplaceBehavior({
  actorKey,
  userId = null,
  modelId,
  assetType,
  eventType,
  queryId = "",
  position = 0,
  source = "other",
  eventId = "",
  occurredAt = new Date(),
} = {}) {
  if (!actorKey || !modelId || !EVENT_WEIGHTS[eventType]) return { accepted: false, reason: "invalid" };
  const model = await MarketplaceModel.findById(modelId).lean();
  if (!model || normalizeAssetType(model.assetType) !== normalizeAssetType(assetType)) {
    return { accepted: false, reason: "not_found" };
  }
  const bucketMs = eventType === "detail_view" ? 30 * 60_000 : 5 * 60_000;
  const dedupeKey = eventId || [
    actorKey,
    modelId,
    eventType,
    queryId,
    Math.floor(occurredAt.getTime() / bucketMs),
  ].join(":");
  const eventKey = hash(dedupeKey);
  const existingEvent = await MarketplaceBehaviorEvent.findOne({ eventKey }).select("_id").lean();
  if (existingEvent) return { accepted: true, duplicate: true };
  try {
    await MarketplaceBehaviorEvent.create({
      eventKey,
      actorKey,
      ...(userId ? { userId } : {}),
      modelId,
      assetType: normalizeAssetType(assetType),
      eventType,
      queryId: String(queryId || "").slice(0, 80),
      position: Math.max(0, Math.min(1_000, Number(position || 0))),
      source: ["search", "home", "detail", "download"].includes(source) ? source : "other",
      occurredAt,
      expiresAt: new Date(occurredAt.getTime() + EVENT_TTL_MS),
    });
  } catch (error) {
    if (Number(error?.code) === 11000 || /duplicate/i.test(String(error?.message || ""))) {
      return { accepted: true, duplicate: true };
    }
    throw error;
  }
  const metricField = {
    click: "behaviorMetrics.clicks",
    detail_view: "behaviorMetrics.detailViews",
    download: "behaviorMetrics.downloads",
  }[eventType];
  if (metricField) {
    await MarketplaceModel.findByIdAndUpdate(modelId, {
      $inc: { [metricField]: 1 },
      $set: { "behaviorMetrics.updatedAt": occurredAt },
    }).catch(() => {});
  }
  await updateInterestProfile({ actorKey, userId, model, eventType, occurredAt });
  invalidateMarketplaceHomeRecommendations(userId || actorKey);
  return { accepted: true, duplicate: false };
}

export async function recordMarketplaceDownloadBehavior(session) {
  if (!session?.modelId || !session?.userId) return;
  await recordMarketplaceBehavior({
    actorKey: marketplaceActorKey({ userId: session.userId }),
    userId: session.userId,
    modelId: session.modelId,
    assetType: session.assetType || "model",
    eventType: "download",
    source: "download",
    eventId: `download:${session._id}`,
  });
}

import { normalizeAssetType } from "../data/marketplaceCatalogs.js";

export const MARKETPLACE_MODEL_RANKING_POLICY = "model_mixed_access_v4";

export function hasMarketplaceAccessFilter(value) {
  return ["free", "pro", "member"].includes(String(value || "").trim().toLowerCase());
}

export function marketplaceRankingMetadata({ assetType = "model", accessType = "" } = {}) {
  const filtered = hasMarketplaceAccessFilter(accessType);
  const isModel = normalizeAssetType(assetType) === "model";
  return {
    policy: MARKETPLACE_MODEL_RANKING_POLICY,
    proFirst: false,
    bypassed: filtered || !isModel,
    ...(filtered ? { reason: "access_filter" } : (!isModel ? { reason: "asset_type" } : {})),
  };
}

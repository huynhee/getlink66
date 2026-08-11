import { normalizeAssetType } from "../data/marketplaceCatalogs.js";

export const MARKETPLACE_MODEL_RANKING_POLICY = "model_pro_first_v3";

export function hasMarketplaceAccessFilter(value) {
  return ["free", "pro", "member"].includes(String(value || "").trim().toLowerCase());
}

export function shouldPrioritizeMarketplaceModelPro(assetType, accessType = "") {
  return normalizeAssetType(assetType) === "model" && !hasMarketplaceAccessFilter(accessType);
}

export function marketplaceRankingMetadata({ applied, accessType = "" } = {}) {
  return {
    policy: MARKETPLACE_MODEL_RANKING_POLICY,
    ...(applied ? { proFirst: true } : {}),
    bypassed: !applied,
    ...(applied
      ? {}
      : { reason: hasMarketplaceAccessFilter(accessType) ? "access_filter" : "asset_type" }),
  };
}

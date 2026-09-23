import { normalizeAssetType } from "../data/marketplaceCatalogs.js";

export const MARKETPLACE_MODEL_RANKING_POLICY = "model_pro_first_v3";

export function hasMarketplaceAccessFilter(value) {
  return ["free", "pro", "member"].includes(String(value || "").trim().toLowerCase());
}

export function shouldPrioritizeMarketplaceModelPro(assetType, accessType = "", sort = "") {
  return normalizeAssetType(assetType) === "model"
    && !hasMarketplaceAccessFilter(accessType)
    && sort !== "newest";
}

export function marketplaceRankingMetadata({ applied, assetType = "model", accessType = "", sort = "" } = {}) {
  return {
    policy: MARKETPLACE_MODEL_RANKING_POLICY,
    ...(applied ? { proFirst: true } : {}),
    bypassed: !applied,
    ...(applied
      ? {}
      : { reason: hasMarketplaceAccessFilter(accessType)
        ? "access_filter"
        : (normalizeAssetType(assetType) === "model" && sort === "newest" ? "sort_order" : "asset_type") }),
  };
}

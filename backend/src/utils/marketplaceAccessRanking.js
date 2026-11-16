import { normalizeAssetType } from "../data/marketplaceCatalogs.js";

export const MARKETPLACE_MODEL_RANKING_POLICY = "model_browse_pro_first_v3";

export function hasMarketplaceAccessFilter(value) {
  return ["free", "pro", "member"].includes(String(value || "").trim().toLowerCase());
}

export function shouldPrioritizeMarketplaceModelPro({ assetType = "model", accessType = "", search = "" } = {}) {
  return normalizeAssetType(assetType) === "model"
    && !String(search || "").trim()
    && !hasMarketplaceAccessFilter(accessType);
}

export function marketplaceRankingMetadata({ assetType = "model", accessType = "", search = "" } = {}) {
  const applied = shouldPrioritizeMarketplaceModelPro({ assetType, accessType, search });
  return {
    policy: applied ? MARKETPLACE_MODEL_RANKING_POLICY : "access_neutral_v3",
    proFirst: applied,
    bypassed: !applied,
    ...(!applied ? { reason: hasMarketplaceAccessFilter(accessType) ? "access_filter" : "access_neutral" } : {}),
  };
}

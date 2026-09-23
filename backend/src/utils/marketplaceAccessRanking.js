import { normalizeAssetType } from "../data/marketplaceCatalogs.js";

export const MARKETPLACE_MODEL_RANKING_POLICY = "model_mixed_access_v4";

export function hasMarketplaceAccessFilter(value) {
  return ["free", "pro", "member"].includes(String(value || "").trim().toLowerCase());
}

export function marketplaceRankingMetadata({ assetType = "model", accessType = "", reservedProPages = 0 } = {}) {
  const filtered = hasMarketplaceAccessFilter(accessType);
  const isModel = normalizeAssetType(assetType) === "model";
  return {
    policy: reservedProPages ? "model_newest_first_ten_pro_v1" : MARKETPLACE_MODEL_RANKING_POLICY,
    proFirst: Boolean(reservedProPages),
    ...(reservedProPages ? { reservedProPages } : {}),
    bypassed: filtered || !isModel,
    ...(filtered ? { reason: "access_filter" } : (!isModel ? { reason: "asset_type" } : {})),
  };
}

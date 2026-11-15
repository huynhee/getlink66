export const MARKETPLACE_MODEL_RANKING_POLICY = "access_neutral_v3";

export function hasMarketplaceAccessFilter(value) {
  return ["free", "pro", "member"].includes(String(value || "").trim().toLowerCase());
}

export function marketplaceRankingMetadata({ accessType = "" } = {}) {
  return {
    policy: MARKETPLACE_MODEL_RANKING_POLICY,
    proFirst: false,
    // Retain the old response keys to indicate the Pro-first boost is bypassed.
    bypassed: true,
    reason: hasMarketplaceAccessFilter(accessType) ? "access_filter" : "access_neutral",
  };
}

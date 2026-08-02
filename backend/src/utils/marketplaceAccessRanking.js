import { normalizeAssetType } from "../data/marketplaceCatalogs.js";
import { normalizeMarketplaceSearchText } from "./marketplaceSearch.js";

export const MARKETPLACE_MODEL_RANKING_POLICY = "model_pro_priority_v1";

export function marketplaceModelFreeInterval() {
  const value = Number(process.env.MARKETPLACE_MODEL_FREE_SEARCH_INTERVAL || 10);
  if (!Number.isFinite(value)) return 10;
  return Math.min(50, Math.max(2, Math.trunc(value)));
}

export function hasMarketplaceAccessFilter(value) {
  return ["free", "pro", "member"].includes(String(value || "").trim().toLowerCase());
}

export function shouldPrioritizeMarketplacePro(assetType, accessType = "") {
  return normalizeAssetType(assetType) === "model" && !hasMarketplaceAccessFilter(accessType);
}

export function marketplaceRankingMetadata({ applied, accessType = "" } = {}) {
  return {
    policy: MARKETPLACE_MODEL_RANKING_POLICY,
    freeInterval: marketplaceModelFreeInterval(),
    bypassed: !applied,
    ...(applied
      ? {}
      : { reason: hasMarketplaceAccessFilter(accessType) ? "access_filter" : "asset_type" }),
  };
}

export function isExactMarketplaceTitleOrSlug(model, query) {
  const normalizedQuery = normalizeMarketplaceSearchText(query);
  if (!normalizedQuery) return false;
  const normalizedTitle = normalizeMarketplaceSearchText(model?.title || model?.titleSort);
  const normalizedSlug = normalizeMarketplaceSearchText(model?.slug);
  return normalizedTitle === normalizedQuery || normalizedSlug === normalizedQuery;
}

export function marketplaceAccessSlots({
  memberTotal = 0,
  freeTotal = 0,
  offset = 0,
  limit = 60,
  interval = marketplaceModelFreeInterval(),
} = {}) {
  const safeMemberTotal = Math.max(0, Number(memberTotal || 0));
  const safeFreeTotal = Math.max(0, Number(freeTotal || 0));
  const safeOffset = Math.max(0, Number(offset || 0));
  const safeLimit = Math.max(0, Number(limit || 0));
  const memberRunLimit = Math.max(1, Number(interval || 10) - 1);
  const end = Math.min(safeMemberTotal + safeFreeTotal, safeOffset + safeLimit);
  const slots = [];
  let memberIndex = 0;
  let freeIndex = 0;
  let memberRun = 0;
  let position = 0;

  while (position < end) {
    let accessType;
    let index;
    const hasMember = memberIndex < safeMemberTotal;
    const hasFree = freeIndex < safeFreeTotal;

    if (hasMember && hasFree) {
      if (memberRun < memberRunLimit) {
        accessType = "member";
        index = memberIndex;
        memberIndex += 1;
        memberRun += 1;
      } else {
        accessType = "free";
        index = freeIndex;
        freeIndex += 1;
        memberRun = 0;
      }
    } else if (hasMember) {
      accessType = "member";
      index = memberIndex;
      memberIndex += 1;
    } else if (hasFree) {
      accessType = "free";
      index = freeIndex;
      freeIndex += 1;
    } else {
      break;
    }

    if (position >= safeOffset) slots.push({ accessType, index });
    position += 1;
  }

  return slots;
}

export function mixMarketplaceAccessRankedModels(models = [], {
  interval = marketplaceModelFreeInterval(),
  pinnedPredicate = null,
} = {}) {
  const ranked = Array.isArray(models) ? models : [];
  const pinned = [];
  const members = [];
  const free = [];

  ranked.forEach((model, index) => {
    if (typeof pinnedPredicate === "function" && pinnedPredicate(model, index)) {
      pinned.push(model);
    } else if (model?.accessType === "free") {
      free.push(model);
    } else {
      members.push(model);
    }
  });

  const slots = marketplaceAccessSlots({
    memberTotal: members.length,
    freeTotal: free.length,
    limit: members.length + free.length,
    interval,
  });
  return [
    ...pinned,
    ...slots.map((slot) => (
      slot.accessType === "free" ? free[slot.index] : members[slot.index]
    )).filter(Boolean),
  ];
}

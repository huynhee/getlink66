export const MARKETPLACE_SORT_VALUES = Object.freeze([
  "relevance",
  "featured",
  "newest",
  "popular",
]);

const MARKETPLACE_SORT_SET = new Set(MARKETPLACE_SORT_VALUES);
const MARKETPLACE_LEGACY_SORT_ALIASES = Object.freeze({
  source_id_desc: "newest",
  oldest: "newest",
  title_asc: "newest",
  title_desc: "newest",
});

export function normalizeMarketplaceTitle(value = "") {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u0111\u0110]/g, "d")
    .replace(/[đĐ]/g, "d")
    .toLocaleLowerCase("en")
    .replace(/\s+/g, " ")
    .trim();
}

export function marketplaceSourceIdNumber(value = "") {
  const chunks = String(value || "").match(/\d+/g);
  if (!chunks?.length) return 0;
  const numeric = Number(chunks.join(""));
  return Number.isSafeInteger(numeric) ? numeric : 0;
}

export function marketplaceSortSelection(rawSort, hasSearch = false) {
  const rawRequested = String(rawSort || "").trim().toLowerCase();
  const requested = MARKETPLACE_LEGACY_SORT_ALIASES[rawRequested] || rawRequested;
  const validRequested = MARKETPLACE_SORT_SET.has(requested) ? requested : "";
  let effective = validRequested || (hasSearch ? "relevance" : "newest");
  if (!hasSearch && effective === "relevance") effective = "featured";
  return {
    requested: validRequested || null,
    effective,
  };
}

export function marketplaceSortSpec(effectiveSort = "newest") {
  if (effectiveSort === "popular") {
    return { downloadCount: -1, sourceAssetIdSort: -1, createdAt: -1, _id: -1 };
  }
  if (effectiveSort === "featured") {
    return {
      downloadCount: -1,
      sourceAssetIdSort: -1,
      createdAt: -1,
      _id: -1,
    };
  }
  return { sourceAssetIdSort: -1, createdAt: -1, _id: -1 };
}

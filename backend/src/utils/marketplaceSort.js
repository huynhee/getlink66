export const MARKETPLACE_SORT_VALUES = Object.freeze([
  "relevance",
  "source_id_desc",
  "newest",
  "popular",
  "oldest",
  "title_asc",
  "title_desc",
]);

const MARKETPLACE_SORT_SET = new Set(MARKETPLACE_SORT_VALUES);

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
  const requested = String(rawSort || "").trim().toLowerCase();
  const validRequested = MARKETPLACE_SORT_SET.has(requested) ? requested : "";
  let effective = validRequested || (hasSearch ? "relevance" : "newest");
  if (!hasSearch && effective === "relevance") effective = "newest";
  return {
    requested: validRequested || null,
    effective,
  };
}

export function marketplaceSortSpec(effectiveSort = "newest") {
  if (effectiveSort === "source_id_desc") {
    return { sourceAssetIdSort: -1, createdAt: -1, _id: -1 };
  }
  if (effectiveSort === "popular") {
    return { downloadCount: -1, createdAt: -1, _id: -1 };
  }
  if (effectiveSort === "oldest") {
    return { createdAt: 1, _id: 1 };
  }
  if (effectiveSort === "title_asc") {
    return { titleSort: 1, _id: 1 };
  }
  if (effectiveSort === "title_desc") {
    return { titleSort: -1, _id: -1 };
  }
  return { createdAt: -1, _id: -1 };
}

import SiteSetting from "../models/SiteSetting.js";

const DEFAULT_PRICES = Object.freeze({ model: 5, scene: 25 });
const CACHE_TTL_MS = 30_000;
let priceCache = null;
let priceCacheExpiresAt = 0;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function invalidateMarketplacePricingCache() {
  priceCache = null;
  priceCacheExpiresAt = 0;
}

export async function marketplaceCreditPrices({ force = false } = {}) {
  if (!force && priceCache && priceCacheExpiresAt > Date.now()) return { ...priceCache };
  let settings = null;
  try {
    settings = await SiteSetting.findOne({ key: "homepage" })
      .select("marketplaceModelCreditPrice marketplaceSceneCreditPrice")
      .lean();
  } catch {
    settings = null;
  }
  priceCache = {
    model: positiveInteger(settings?.marketplaceModelCreditPrice, DEFAULT_PRICES.model),
    scene: positiveInteger(settings?.marketplaceSceneCreditPrice, DEFAULT_PRICES.scene),
  };
  priceCacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return { ...priceCache };
}

export async function marketplaceCreditPrice(assetType) {
  const prices = await marketplaceCreditPrices();
  return String(assetType || "").toLowerCase() === "scene" ? prices.scene : prices.model;
}

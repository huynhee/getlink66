const DEFAULT_TIMEOUT_MS = 8_000;
const RRF_K = 60;
const RRF_SCORE_SCALE = 2_500;

function normalize(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u0111\u0110]/g, "d")
    .trim()
    .toLowerCase();
}

function values(value) {
  return [...new Set((Array.isArray(value) ? value : [value]).map(normalize).filter(Boolean))];
}

function identityValues(model) {
  return values([model?._id, model?.source?.assetId, model?.source?.modelId, model?.slug]);
}

function overlap(left, right) {
  const a = new Set(values(left));
  const b = new Set(values(right));
  if (!a.size || !b.size) return 0;
  let shared = 0;
  a.forEach((item) => {
    if (b.has(item)) shared += 1;
  });
  return shared / new Set([...a, ...b]).size;
}

function sameRef(left, right) {
  const a = normalize(left?._id || left);
  const b = normalize(right?._id || right);
  return Boolean(a && b && a === b);
}

function recencyScore(date, now = Date.now()) {
  const timestamp = new Date(date || 0).getTime();
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 0;
  const ageDays = Math.max(0, (now - timestamp) / 86_400_000);
  return Math.exp(-ageDays / 365);
}

export function marketplaceContentScore(source, candidate, now = Date.now()) {
  let score = 0;
  if (sameRef(source.categorySourceId || source.categoryId, candidate.categorySourceId || candidate.categoryId)) score += 32;
  if (sameRef(source.parentCategorySourceId || source.parentCategoryId, candidate.parentCategorySourceId || candidate.parentCategoryId)) score += 14;
  score += overlap(normalize(source.title).split(/[^a-z0-9]+/), normalize(candidate.title).split(/[^a-z0-9]+/)) * 15;
  if (normalize(source.renderer) && normalize(source.renderer) === normalize(candidate.renderer)) score += 8;
  score += overlap(source.renderers, candidate.renderers) * 12;
  score += overlap(source.styles, candidate.styles) * 10;
  score += overlap(source.materials, candidate.materials) * 8;
  score += overlap(source.forms, candidate.forms) * 6;
  score += overlap(source.colors, candidate.colors) * 5;
  score += overlap(source.platforms, candidate.platforms) * 9;
  score += Math.log2(Number(candidate.downloadCount || 0) + 1) * 0.8;
  score += recencyScore(candidate.createdAt, now) * 2;
  return score;
}

function modelSimilarity(left, right) {
  const titleSimilarity = overlap(normalize(left.title).split(/[^a-z0-9]+/), normalize(right.title).split(/[^a-z0-9]+/));
  return Math.max(
    titleSimilarity,
    overlap(left.materials, right.materials) * 0.65 + overlap(left.forms, right.forms) * 0.35,
  );
}

export function reciprocalRankFusion(rankings, k = RRF_K) {
  const scores = new Map();
  rankings.forEach(({ items = [], weight = 1 }) => {
    items.forEach((item, index) => {
      const id = normalize(item?.id || item?.modelId || item);
      if (!id) return;
      scores.set(id, (scores.get(id) || 0) + Number(weight || 1) / (k + index + 1));
    });
  });
  return scores;
}

function rankValue(model, rankScores) {
  return identityValues(model).reduce((best, id) => Math.max(best, rankScores.get(id) || 0), 0);
}

function diversify(ranked, limit) {
  const selected = [];
  const remaining = ranked.slice(0, Math.max(limit * 4, limit));
  const maxScore = Math.max(...remaining.map((item) => item.score), 1);
  while (selected.length < limit && remaining.length) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    remaining.forEach((item, index) => {
      const relevance = item.score / maxScore;
      const duplication = selected.length
        ? Math.max(...selected.map((chosen) => modelSimilarity(item.model, chosen.model)))
        : 0;
      const value = relevance * 0.86 - duplication * 0.14;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = index;
      }
    });
    selected.push(remaining.splice(bestIndex, 1)[0]);
  }
  return selected;
}

export function rankMarketplaceRecommendations(source, candidates, options = {}) {
  const semanticMatches = Array.isArray(options.semanticMatches) ? options.semanticMatches : [];
  const limit = Math.max(1, Number(options.limit || 60));
  const localRanking = candidates
    .map((model) => ({ model, contentScore: marketplaceContentScore(source, model) }))
    .sort((left, right) => right.contentScore - left.contentScore || normalize(left.model._id).localeCompare(normalize(right.model._id)));
  const fusion = reciprocalRankFusion([
    { items: localRanking.map(({ model }) => identityValues(model)[0]), weight: semanticMatches.length ? 1 : 2 },
    { items: semanticMatches, weight: semanticMatches.length ? 2 : 0 },
  ]);
  const ranked = localRanking
    .map(({ model, contentScore }) => ({
      model,
      score: contentScore + rankValue(model, fusion) * RRF_SCORE_SCALE,
    }))
    .sort((left, right) => right.score - left.score || normalize(left.model._id).localeCompare(normalize(right.model._id)));
  return diversify(ranked, limit).map(({ model }) => model);
}

function providerConfig() {
  return {
    baseUrl: String(process.env.MARKETPLACE_DISCOVERY_URL || "").trim().replace(/\/+$/, ""),
    apiKey: String(process.env.MARKETPLACE_DISCOVERY_API_KEY || "").trim(),
    timeoutMs: Math.max(1_000, Number(process.env.MARKETPLACE_DISCOVERY_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)),
  };
}

export function marketplaceDiscoveryConfigured() {
  return Boolean(providerConfig().baseUrl);
}

async function providerMutation(path, payload) {
  const config = providerConfig();
  if (!config.baseUrl) return { configured: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Discovery provider returned HTTP ${response.status}`);
    return { configured: true };
  } finally {
    clearTimeout(timer);
  }
}

export function syncMarketplaceDiscoveryAsset(model) {
  const assetType = model?.assetType === "scene" ? "scene" : "model";
  const assetId = String(model?.source?.assetId || model?._id || "");
  const isPublic = Boolean(model?.isPublished && model?.metadataStatus === "complete" && model?.fileStatus === "ready");
  if (!isPublic) {
    return providerMutation(String(process.env.MARKETPLACE_DISCOVERY_DELETE_PATH || "/assets/delete"), {
      assetType,
      assetId,
    });
  }
  const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || process.env.APP_URL || "").trim().replace(/\/+$/, "");
  const segment = assetType === "scene" ? "scenes" : "models";
  return providerMutation(String(process.env.MARKETPLACE_DISCOVERY_UPSERT_PATH || "/assets/upsert"), {
    assetType,
    assetId,
    databaseId: String(model?._id || ""),
    title: model?.title || "",
    slug: model?.slug || "",
    category: model?.categorySourceId || "",
    renderer: model?.renderer || "",
    styles: model?.styles || [],
    renderers: model?.renderers || [],
    platforms: model?.platforms || [],
    coverUrl: publicBaseUrl && model?._id ? `${publicBaseUrl}/api/marketplace/${segment}/${model._id}/cover` : "",
  });
}

async function providerRequest(path, payload) {
  const config = providerConfig();
  if (!config.baseUrl) return { matches: [], provider: "local_hybrid" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Discovery provider returned HTTP ${response.status}`);
    const data = await response.json();
    const matches = (Array.isArray(data.matches) ? data.matches : [])
      .map((match) => ({ modelId: normalize(match.modelId || match.id), score: Number(match.score || 0) }))
      .filter((match) => match.modelId);
    return { matches, provider: String(data.provider || "siglip2_qdrant") };
  } catch {
    return { matches: [], provider: "local_hybrid" };
  } finally {
    clearTimeout(timer);
  }
}

export function semanticRecommendations(model, limit = 180) {
  return providerRequest("/recommendations", {
    assetType: model?.assetType || "model",
    modelId: String(model?.source?.assetId || model?.source?.modelId || model?._id || ""),
    limit,
    metadata: {
      title: model?.title || "",
      category: model?.categorySourceId || "",
      renderer: model?.renderer || "",
      styles: model?.styles || [],
      renderers: model?.renderers || [],
      forms: model?.forms || [],
      colors: model?.colors || [],
      materials: model?.materials || [],
      platforms: model?.platforms || [],
    },
  });
}

export function semanticTextSearch(query, limit = 1_000, assetType = "model") {
  return providerRequest("/search", { query: String(query || "").trim(), limit, assetType });
}

export function discoveryIdentityQuery(matches = []) {
  const ids = matches.map((match) => normalize(match.modelId || match.id)).filter(Boolean);
  if (!ids.length) return null;
  const databaseIds = ids.filter((id) => /^[a-f0-9]{24}$/i.test(id));
  return {
    $or: [
      { "source.modelId": { $in: ids } },
      { "source.assetId": { $in: ids } },
      { slug: { $in: ids } },
      ...(databaseIds.length ? [{ _id: { $in: databaseIds } }] : []),
    ],
  };
}

export function sortByDiscoveryMatches(models, matches = []) {
  const rank = new Map(matches.map((match, index) => [normalize(match.modelId || match.id), index]));
  return [...models].sort((left, right) => {
    const leftRank = Math.min(...identityValues(left).map((id) => rank.get(id) ?? Number.MAX_SAFE_INTEGER));
    const rightRank = Math.min(...identityValues(right).map((id) => rank.get(id) ?? Number.MAX_SAFE_INTEGER));
    return leftRank - rightRank;
  });
}

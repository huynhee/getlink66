function providerConfig() {
  return {
    url: String(process.env.MARKETPLACE_IMAGE_SEARCH_URL || "").trim(),
    apiKey: String(process.env.MARKETPLACE_IMAGE_SEARCH_API_KEY || "").trim(),
    timeoutMs: Math.min(
      60_000,
      Math.max(1_000, Number(process.env.MARKETPLACE_IMAGE_SEARCH_TIMEOUT_MS || 20_000)),
    ),
  };
}

function providerError(message, status = 502) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function marketplaceImageSearchAvailable() {
  return Boolean(providerConfig().url);
}

export function normalizeImageSearchMatches(payload, limit = 60) {
  const source = Array.isArray(payload?.matches)
    ? payload.matches
    : Array.isArray(payload?.results)
      ? payload.results
      : Array.isArray(payload?.modelIds)
        ? payload.modelIds
        : null;
  if (!source) throw providerError("Image search provider returned an invalid response.");

  const normalized = [];
  const seen = new Set();
  for (let index = 0; index < source.length; index += 1) {
    const item = source[index];
    const modelId = String(
      typeof item === "string" || typeof item === "number"
        ? item
        : item?.modelId ?? item?.sourceModelId ?? item?.id ?? "",
    ).trim();
    if (!modelId || modelId.length > 160 || seen.has(modelId)) continue;
    seen.add(modelId);
    const rawScore = typeof item === "object" ? Number(item?.score ?? item?.similarity) : NaN;
    normalized.push({
      modelId,
      score: Number.isFinite(rawScore) ? rawScore : Math.max(0, 1 - index / Math.max(1, source.length)),
    });
    if (normalized.length >= limit) break;
  }
  return normalized;
}

export async function searchMarketplaceImage({ imageData, imageHash, limit = 60 } = {}) {
  const config = providerConfig();
  if (!config.url) {
    throw providerError("Image similarity engine is not configured.", 503);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({ imageData, imageHash, limit }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw providerError(`Image search provider failed with status ${response.status}.`);
    }
    let payload;
    try {
      payload = JSON.parse(text || "{}");
    } catch {
      throw providerError("Image search provider returned invalid JSON.");
    }
    return {
      provider: "external_http",
      matches: normalizeImageSearchMatches(payload, limit),
    };
  } catch (error) {
    if (error?.status) throw error;
    if (error?.name === "AbortError") {
      throw providerError("Image search provider timed out.", 504);
    }
    throw providerError("Image search provider is unavailable.", 503);
  } finally {
    clearTimeout(timeout);
  }
}

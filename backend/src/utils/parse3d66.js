const MODEL_ID_PATTERN = /^[A-Z0-9_-]{8,64}$/i;
const DEFAULT_ACCOUNT_ID = "177536980";

function accountMarker() {
  const explicitMarker = String(process.env.THREED66_ACCOUNT_MARKER || "").replace(/\D/g, "");
  if (explicitMarker) return explicitMarker;

  const accountId = String(process.env.THREED66_ACCOUNT_ID || DEFAULT_ACCOUNT_ID).replace(/\D/g, "");
  const markerSource = accountId.length > 1 ? accountId.slice(0, -1) : accountId;
  const marker = markerSource.split("").reverse().join("").replace(/^0+/, "");
  return marker || "89635771";
}

function splitModelId(value = "") {
  const modelId = String(value || "").trim().toUpperCase();
  const match = modelId.match(/^([A-Z]{3})(\d{6,})$/);
  if (!match) return null;
  return { modelId, prefix: match[1], digits: match[2] };
}

function possibleTrackingMarkerLengths(digits = "") {
  const marker = accountMarker();
  if (digits.startsWith(marker) && digits.length - marker.length >= 5) {
    return [marker.length];
  }

  const lengths = [accountMarker().length, 8, 9]
    .filter((length) => Number.isInteger(length) && length > 0 && digits.length - length >= 5);
  return [...new Set(lengths)];
}

export function isModelId(value = "") {
  const text = String(value || "").trim();
  return MODEL_ID_PATTERN.test(text) && /[A-Z]/i.test(text) && /\d{6,}/.test(text);
}

export function extractModelIdInput(value = "") {
  const text = String(value || "").trim();
  if (!text) {
    throw Object.assign(new Error("Model ID is required"), { status: 400 });
  }

  if (/^https?:\/\//i.test(text) || /3d66\.com/i.test(text)) {
    throw Object.assign(
        new Error("Chỉ nhận mã model 3D, không nhận link. Vui lòng nhập mã như AGI896357716115729."),
      { status: 400 },
    );
  }

  if (!isModelId(text)) {
    throw Object.assign(
      new Error("Mã model 3D không hợp lệ. Vui lòng nhập mã như AGI896357716115729."),
      { status: 400 },
    );
  }

  return normalizeAccountModelId(text);
}

export function modelIdTo3D66Url(productId) {
  const modelId = extractModelIdInput(productId);
  const candidates = publicModelIdCandidates(productId);
  const baseUrl = new URL(process.env.THREED66_MODEL_ID_BASE_URL || modelIdBaseUrl(modelId));
  baseUrl.search = "";
  baseUrl.searchParams.set("kw", modelId);
  baseUrl.searchParams.set("sof", modelId);
  baseUrl.searchParams.set("alichlgref", "https://user.3d66.com/");
  const hashParams = new URLSearchParams({ input: "model-id" });
  if (candidates.length > 1) {
    hashParams.set("candidates", candidates.join(","));
  }
  baseUrl.hash = hashParams.toString();
  return baseUrl.toString();
}

export function normalizePublicModelId(value = "") {
  const parsed = splitModelId(value);
  if (!parsed) return String(value || "").trim().toUpperCase();

  const marker = accountMarker();
  if (!parsed.digits.startsWith(marker)) return parsed.modelId;

  const suffix = parsed.digits.slice(marker.length);
  return suffix ? `${parsed.prefix}${suffix}` : parsed.modelId;
}

export function normalizeAccountModelId(value = "") {
  const parsed = splitModelId(value);
  if (!parsed) return String(value || "").trim().toUpperCase();

  const marker = accountMarker();
  if (parsed.digits.startsWith(marker)) return parsed.modelId;

  const markerLengths = possibleTrackingMarkerLengths(parsed.digits);
  for (const markerLength of markerLengths) {
    const suffix = parsed.digits.slice(markerLength);
    if (suffix) return `${parsed.prefix}${marker}${suffix}`;
  }

  return `${parsed.prefix}${marker}${parsed.digits}`;
}

export function publicModelIdCandidates(value = "") {
  const parsed = splitModelId(value);
  const marker = accountMarker();
  if (!parsed) return [normalizeAccountModelId(value)].filter(isModelId);

  const candidates = [];
  const markerLengths = possibleTrackingMarkerLengths(parsed.digits);

  if (parsed.digits.startsWith(marker)) {
    const suffix = parsed.digits.slice(marker.length);
    candidates.push(parsed.modelId);
    if (suffix) {
      candidates.push(`${parsed.prefix}${suffix}`);
      if (suffix.length > 6) {
        candidates.push(`${parsed.prefix}${marker}${suffix.slice(0, -1)}`);
        candidates.push(`${parsed.prefix}${suffix.slice(0, -1)}`);
      }
    }
  } else if (markerLengths.length) {
    for (const markerLength of markerLengths) {
      const suffix = parsed.digits.slice(markerLength);
      if (!suffix) continue;
      candidates.push(`${parsed.prefix}${marker}${suffix}`);
      candidates.push(`${parsed.prefix}${suffix}`);
      if (suffix.length > 6) {
        candidates.push(`${parsed.prefix}${marker}${suffix.slice(0, -1)}`);
        candidates.push(`${parsed.prefix}${suffix.slice(0, -1)}`);
      }
    }
  } else {
    candidates.push(`${parsed.prefix}${marker}${parsed.digits}`);
    candidates.push(parsed.modelId);
  }

  return [...new Set(candidates.filter(isModelId))];
}

function modelIdBaseUrl(modelId) {
  if (/^[AH]CG/i.test(modelId) || /^[AH]GF/i.test(modelId)) {
    return `https://xiaoguotu.3d66.com/items/${encodeURIComponent(modelId)}.html`;
  }
  if (/^AJI/i.test(modelId)) {
    return `https://tietu.3d66.com/reshtmla/tietu/items/id/model.html`;
  }
  if (/^ACI/i.test(modelId)) {
    return `https://cad.3d66.com/reshtmla/cad/items/id/model.html`;
  }
  return "https://3d.3d66.com/reshtmla/model/items/id/model.html";
}

export function extractProductId(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw Object.assign(new Error("Invalid URL"), { status: 400 });
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw Object.assign(new Error("Only HTTP(S) URLs are supported"), { status: 400 });
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== "3d66.com" && !hostname.endsWith(".3d66.com")) {
    throw Object.assign(new Error("Only valid 3D model links are supported"), { status: 400 });
  }

  const pathParts = parsed.pathname.split("/").filter(Boolean);
  const lastPart = pathParts[pathParts.length - 1] || "";
  const numericMatches = [...parsed.pathname.matchAll(/(\d{4,})/g)].map((match) => match[1]);
  const numericId = numericMatches.sort((a, b) => b.length - a.length)[0] || "";
  const slugMatch = lastPart.match(/[a-zA-Z0-9_-]+/);
  const productId = parsed.searchParams.get("sof") || parsed.searchParams.get("id") || numericId || slugMatch?.[0];

  if (!productId) {
    throw Object.assign(new Error("Cannot extract product id from URL"), { status: 400 });
  }

  return productId;
}

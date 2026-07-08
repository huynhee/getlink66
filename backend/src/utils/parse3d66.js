const MODEL_ID_PATTERN = /^[A-Z0-9_-]{8,64}$/i;

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
      new Error("Chỉ nhận mã model 3D66, không nhận link. Vui lòng nhập mã như AGI896357716115729."),
      { status: 400 },
    );
  }

  if (!isModelId(text)) {
    throw Object.assign(
      new Error("Mã model 3D66 không hợp lệ. Vui lòng nhập mã như AGI896357716115729."),
      { status: 400 },
    );
  }

  return text.toUpperCase();
}

export function modelIdTo3D66Url(productId) {
  const modelId = extractModelIdInput(productId);
  const baseUrl = new URL(process.env.THREED66_MODEL_ID_BASE_URL || modelIdBaseUrl(modelId));
  baseUrl.search = "";
  baseUrl.searchParams.set("kw", modelId);
  baseUrl.searchParams.set("sof", modelId);
  baseUrl.searchParams.set("alichlgref", "https://user.3d66.com/");
  return baseUrl.toString();
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
    throw Object.assign(new Error("Only 3d66.com links are supported"), { status: 400 });
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

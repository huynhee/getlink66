const DEFAULT_REQUIRED_MARKER = "89635771";

function validationError(reason, status = 422) {
  return Object.assign(new Error("3D66 clean link validation failed. Download stopped."), {
    status,
    code: "THREED66_CLEAN_LINK_REQUIRED",
    details: { stage: "clean-link-validation", reason },
  });
}

export function required3D66AccountMarker(env = process.env) {
  const configured = env.THREED66_REQUIRED_ACCOUNT_MARKER;
  const marker = configured === undefined ? DEFAULT_REQUIRED_MARKER : String(configured).trim();
  if (!/^\d{6,12}$/.test(marker)) throw validationError("invalid_required_marker", 503);
  return marker;
}

function modelIdentityParts(value = "") {
  const match = String(value || "").trim().toUpperCase().match(/^([A-Z]{3})(\d{6,})$/);
  return match ? { family: match[1].slice(1), digits: match[2] } : null;
}

export function modelIdsShareAssetIdentity(left = "", right = "") {
  const normalizedLeft = String(left || "").trim().toUpperCase();
  const normalizedRight = String(right || "").trim().toUpperCase();
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;
  const leftParts = modelIdentityParts(normalizedLeft);
  const rightParts = modelIdentityParts(normalizedRight);
  if (!leftParts || !rightParts || leftParts.family !== rightParts.family) return false;
  let commonDigits = 0;
  while (commonDigits < leftParts.digits.length && commonDigits < rightParts.digits.length
    && leftParts.digits.at(-1 - commonDigits) === rightParts.digits.at(-1 - commonDigits)) {
    commonDigits += 1;
  }
  return commonDigits >= 5;
}

export function assert3D66CleanModelUrl(value, { expectedProductId = "" } = {}) {
  let url;
  try { url = new URL(value); }
  catch { throw validationError("missing_or_invalid_url"); }
  if (url.protocol !== "https:" || url.port || url.username || url.password
    || !(url.hostname === "3d66.com" || url.hostname.endsWith(".3d66.com"))
    || !/(?:\/reshtml[a-z]*\/|\/items\/)/i.test(url.pathname) || !/\.html$/i.test(url.pathname)) {
    throw validationError("invalid_model_url");
  }
  const ids = url.searchParams.getAll("sof");
  if (ids.length !== 1) throw validationError("missing_or_duplicate_sof");
  const productId = ids[0];
  assert3D66AccountProductId(productId);
  if (url.searchParams.getAll("id").some((id) => id !== productId)) {
    throw validationError("conflicting_model_id");
  }
  const signatures = url.searchParams.getAll("sign");
  if (signatures.length !== 1 || !signatures[0] || signatures[0].length > 256 || /\s/.test(signatures[0])) {
    throw validationError("missing_or_duplicate_signature");
  }
  if (expectedProductId && !modelIdsShareAssetIdentity(productId, expectedProductId)) {
    throw validationError("asset_identity_mismatch");
  }
  return productId;
}

export function assert3D66AccountProductId(productId) {
  const parsed = modelIdentityParts(productId);
  const marker = required3D66AccountMarker();
  if (!/^[A-Z]{3}\d+$/i.test(productId) || !parsed?.digits.startsWith(marker)
    || parsed.digits.length - marker.length < 5) {
    throw validationError("account_marker_mismatch");
  }
}

export function assert3D66DownloadFields(productId, sourceUrl) {
  const resolvedId = assert3D66CleanModelUrl(sourceUrl);
  if (String(productId || "").toUpperCase() !== resolvedId.toUpperCase()) {
    throw validationError("download_payload_mismatch");
  }
}

export function assert3D66BrowserDownloadRequest({ url, method, body, contentType, sourceUrl }) {
  const target = new URL(url);
  if (!(target.hostname === "3d66.com" || target.hostname.endsWith(".3d66.com"))
    || !/^\/api\/v1\/download\/(?:handle|pop)\/?$/.test(target.pathname)) return;
  let fields;
  try {
    if (method === "GET") fields = target.searchParams;
    else if (/application\/json/i.test(contentType || "")) {
      const json = JSON.parse(body);
      fields = new URLSearchParams({ sof: json.sof || "", ll_id: json.ll_id || "", ...(json.resUrl ? { resUrl: json.resUrl } : {}) });
    } else fields = new URLSearchParams(body || "");
  } catch { throw validationError("invalid_download_body"); }
  const key = target.pathname.replace(/\/$/, "").endsWith("/pop") ? "sof" : "ll_id";
  const ids = fields.getAll(key);
  if (ids.length !== 1 || !ids[0]) throw validationError("missing_or_duplicate_download_id");
  assert3D66DownloadFields(ids[0], sourceUrl);
  for (const id of [...fields.getAll("sof"), ...fields.getAll("ll_id")].filter(Boolean)) {
    if (id.toUpperCase() !== ids[0].toUpperCase()) throw validationError("download_payload_mismatch");
  }
  const sources = fields.getAll("resUrl");
  if (sources.length > 1) throw validationError("duplicate_download_source");
  if (sources.length) assert3D66DownloadFields(ids[0], sources[0]);
}

export function assert3D66StoredDownload(record = {}) {
  if (process.env.THREED66_MOCK !== "false") return;
  assert3D66CleanModelUrl(record.resolvedSourceUrl, { expectedProductId: record.productId });
}

export function is3D66CleanLinkError(error) {
  return error?.code === "THREED66_CLEAN_LINK_REQUIRED";
}

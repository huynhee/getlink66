import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import Getlink from "../models/Getlink.js";
import ProductCache from "../models/ProductCache.js";
import User from "../models/User.js";
import {
  fetch3D66Preview,
  fetchFrom3D66,
  inspect3D66DownloadChoice,
  inspect3D66DownloadFormats,
  inspect3D66Page,
  request3D66File,
} from "../utils/3d66Service.js";
import { with3D66Cookie } from "../utils/3d66CookiePool.js";
import {
  queue3D66Getlink,
  queue3D66Preview,
  queue3D66Refresh,
} from "../utils/3d66Queue.js";
import { deductCredit } from "../utils/creditService.js";
import {
  extractModelIdInput,
  extractProductId,
  modelIdTo3D66Url,
} from "../utils/parse3d66.js";
import { normalizeDownloadCreditCost } from "../utils/pricingService.js";
import { isSafeId, rejectUnknownKeys } from "../utils/validators.js";
import {
  signDownloadToken,
  verifyDownloadToken,
} from "../utils/downloadToken.js";
import { securityEvent } from "../utils/logger.js";
import { writeSystemLog } from "../utils/systemLog.js";

const productLocks = new Map();
const historyRefreshLocks = new Map();
const MAX_PRODUCT_LOCKS = 500;
const PARTIAL_DOWNLOAD_SESSION_MS = 10 * 60 * 1000;
const MAX_PREVIEW_IMAGE_BYTES = 15 * 1024 * 1024;
const DOWNLOAD_FORMAT_OPTIONS_VERSION = 2;
const downloadCounters = {
  global: 0,
  user: new Map(),
  ip: new Map(),
};

// Per-user-per-product in-flight set: chong race condition double-charge credit
// JS event loop la single-threaded → Set.has()/add()/delete() la atomic giua cac await.
const userProductLocks = new Set();

function userProductLockKey(userId, productId) {
  return `${String(userId)}:${String(productId)}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redownloadWindowMs() {
  return redownloadWindowDays() * 24 * 60 * 60 * 1000;
}

function redownloadWindowDays() {
  const days = Number(process.env.GETLINK_REDOWNLOAD_DAYS || 3);
  return Number.isFinite(days) && days > 0 ? days : 3;
}

function redownloadLimit() {
  const limit = Number(process.env.GETLINK_REDOWNLOAD_LIMIT || 5);
  return Number.isFinite(limit) && limit > 0 ? limit : 5;
}

async function hasEnoughCredit(userId, creditCost) {
  const user = await User.findById(userId);
  return {
    ok: Number(user?.credit || 0) >= Number(creditCost || 0),
    credit: Number(user?.credit || 0),
  };
}

function downloadLimit(name, fallback) {
  const limit = Number(process.env[name] || fallback);
  return Number.isFinite(limit) && limit > 0 ? limit : fallback;
}

function mapCount(map, key) {
  return Number(map.get(String(key)) || 0);
}

function decrementMap(map, key) {
  const normalized = String(key);
  const next = Math.max(0, mapCount(map, normalized) - 1);
  if (next <= 0) map.delete(normalized);
  else map.set(normalized, next);
}

function acquireDownloadSlot(req, ownerUserId = "") {
  const userId = String(ownerUserId || req.user?._id || "anonymous");
  const ip = String(req.ip || "unknown");
  const maxGlobal = downloadLimit("MAX_GLOBAL_DOWNLOADS", 20);
  const maxUser = downloadLimit("MAX_DOWNLOADS_PER_USER", 2);
  const maxIp = downloadLimit("MAX_DOWNLOADS_PER_IP", 4);

  if (downloadCounters.global >= maxGlobal) {
    return {
      ok: false,
      status: 429,
      message: "He thong dang co nhieu file dang tai. Vui long thu lai sau.",
    };
  }
  if (mapCount(downloadCounters.user, userId) >= maxUser) {
    return {
      ok: false,
      status: 429,
      message: `Tai khoan chi duoc tai toi da ${maxUser} file cung luc.`,
    };
  }
  if (mapCount(downloadCounters.ip, ip) >= maxIp) {
    return {
      ok: false,
      status: 429,
      message: `IP chi duoc tai toi da ${maxIp} file cung luc.`,
    };
  }

  downloadCounters.global += 1;
  downloadCounters.user.set(userId, mapCount(downloadCounters.user, userId) + 1);
  downloadCounters.ip.set(ip, mapCount(downloadCounters.ip, ip) + 1);

  return {
    ok: true,
    release() {
      downloadCounters.global = Math.max(0, downloadCounters.global - 1);
      decrementMap(downloadCounters.user, userId);
      decrementMap(downloadCounters.ip, ip);
    },
  };
}

function redownloadExpiresAt(history) {
  const createdAt = history?.createdAt
    ? new Date(history.createdAt).getTime()
    : 0;
  if (!createdAt) return null;
  return new Date(createdAt + redownloadWindowMs());
}

function canRedownload(history) {
  const expiresAt = redownloadExpiresAt(history);
  return Boolean(
    expiresAt &&
      expiresAt.getTime() > Date.now() &&
      Number(history?.redownloadCount || 0) < redownloadLimit(),
  );
}

function isWithinRedownloadWindow(history) {
  const expiresAt = redownloadExpiresAt(history);
  return Boolean(expiresAt && expiresAt.getTime() > Date.now());
}

function isRecentPartialDownloadSession(history) {
  const lastRedownloadAt = history?.lastRedownloadAt
    ? new Date(history.lastRedownloadAt).getTime()
    : 0;
  return Boolean(
    lastRedownloadAt &&
      lastRedownloadAt > Date.now() - PARTIAL_DOWNLOAD_SESSION_MS,
  );
}

function uniqueProductIds(values = []) {
  return [
    ...new Set(
      values
        .flat()
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  ];
}

function productIdsFromModelUrl(url = "") {
  const ids = [];
  try {
    const parsed = new URL(url);
    ["sof", "id"].forEach((key) => {
      const value = parsed.searchParams.get(key);
      if (value) ids.push(value);
    });
    const hashParams = new URLSearchParams(String(parsed.hash || "").replace(/^#/, ""));
    const candidates = hashParams.get("candidates");
    if (candidates) {
      ids.push(
        ...candidates
          .split(",")
          .map((value) => decodeURIComponent(value).trim())
          .filter(Boolean),
      );
    }
    ids.push(extractProductId(parsed.toString()));
  } catch {
    // The caller may pass an old or partial URL; ignore it and use other ids.
  }
  return uniqueProductIds(ids);
}

function hasExplicitProductId(url = "") {
  try {
    const parsed = new URL(url);
    return Boolean(parsed.searchParams.get("sof") || parsed.searchParams.get("id"));
  } catch {
    return false;
  }
}

function lockedProductId(url = "", inputProductId = "", resolvedProductId = "") {
  const inputId = String(inputProductId || "").trim();
  const resolvedId = String(resolvedProductId || "").trim();
  if (hasExplicitProductId(url)) {
    const requestedIds = productIdsFromModelUrl(url);
    if (resolvedId && requestedIds.includes(resolvedId)) return resolvedId;
    return inputId;
  }
  return String(resolvedId || inputId).trim();
}

function modelPageKey(url = "") {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "";
  }
}

function cacheMatchesModelUrl(cache = {}, sourceUrl = "") {
  const currentKey = modelPageKey(sourceUrl);
  const cacheKey = modelPageKey(cache?.sourceUrl || "");
  if (currentKey && cacheKey) return currentKey === cacheKey;
  return false;
}

function downloadFormatKey(format = {}) {
  const key = String(format?.key || "").trim();
  if (key) {
    const keyFileFormat = key.split("|")[0];
    if (usableDownloadFileFormat(format?.fileFormat || format?.file_format || keyFileFormat)) return key;
  }
  const fileFormat = String(format?.fileFormat || format?.file_format || "").trim();
  const formatVersion = String(format?.formatVersion || format?.format_version || "").trim();
  const rendererType = String(format?.rendererType || format?.renderer_type || "").trim();
  if (!usableDownloadFileFormat(fileFormat)) return "";
  return [fileFormat, formatVersion, rendererType].join("|");
}

function usableDownloadFileFormat(value = "") {
  const text = String(value || "").trim();
  return text && text !== "0" ? text : "";
}

function sanitizeDownloadFormatOptions(options = []) {
  const seen = new Set();
  return (Array.isArray(options) ? options : []).filter((option) => {
    const key = downloadFormatKey(option);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cacheDownloadFormatOptions(cache = {}) {
  if (Number(cache?.formatOptionsVersion || 0) !== DOWNLOAD_FORMAT_OPTIONS_VERSION) return [];
  return sanitizeDownloadFormatOptions(cache?.formatOptions);
}

function freshDownloadFormatOptions(options = [], fallbackCache = null) {
  const sanitized = sanitizeDownloadFormatOptions(options);
  return sanitized.length ? sanitized : cacheDownloadFormatOptions(fallbackCache);
}

function normalizeDownloadFormatRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const key = String(value.key || "").trim();
  const fileFormat = String(value.fileFormat || value.file_format || "").trim();
  const formatVersion = String(value.formatVersion || value.format_version || "").trim();
  const rendererType = String(value.rendererType || value.renderer_type || "").trim();
  const label = String(value.label || "").trim().slice(0, 120);
  const rendererLabel = String(value.rendererLabel || value.renderer_label || "").trim().slice(0, 80);
  const size = String(value.size || "").trim().slice(0, 60);
  const normalized = { key, fileFormat, formatVersion, rendererType, rendererLabel, label, size };
  return downloadFormatKey(normalized) ? normalized : null;
}

function cacheMatchesDownloadFormat(cache = {}, requestedFormat = null) {
  const requestedKey = downloadFormatKey(requestedFormat);
  if (!requestedKey) return true;
  return String(cache?.downloadFormatKey || "") === requestedKey;
}

function cacheFormatPatch(selectedFormat = null) {
  if (!selectedFormat) return {};
  const key = downloadFormatKey(selectedFormat);
  return {
    downloadFormatKey: key,
    fileFormat: String(selectedFormat.fileFormat || ""),
    formatVersion: String(selectedFormat.formatVersion || ""),
    rendererType: String(selectedFormat.rendererType || ""),
    rendererLabel: String(selectedFormat.rendererLabel || ""),
    formatLabel: String(selectedFormat.label || ""),
    formatSize: String(selectedFormat.size || ""),
  };
}

function downloadFormatFromCache(cache = {}) {
  return {
    key: cache.downloadFormatKey || "",
    label: cache.formatLabel || "",
    fileFormat: cache.fileFormat || "",
    formatVersion: cache.formatVersion || "",
    rendererType: cache.rendererType || "",
    rendererLabel: cache.rendererLabel || "",
    size: cache.formatSize || "",
  };
}

function refreshLockKey(history = {}, selectedFormat = null) {
  const formatKey = downloadFormatKey(selectedFormat || history.downloadFormat) || "default";
  const sourceKey = modelPageKey(history.sourceUrl || "") || String(history.sourceUrl || "");
  return [
    String(history.productId || ""),
    formatKey,
    sourceKey,
  ].join(":");
}

async function useFreshCacheForHistory(history, selectedFormat = null) {
  const requestedFormat = selectedFormat || history.downloadFormat || null;
  const cache = await ProductCache.findOne({ productId: history.productId });
  if (
    !isCacheFresh(cache) ||
    !cacheMatchesModelUrl(cache, history.sourceUrl || "") ||
    !cacheMatchesDownloadFormat(cache, requestedFormat)
  ) {
    return null;
  }

  return Getlink.findByIdAndUpdate(
    history._id,
    {
      fileUrl: cache.fileUrl,
      sourceUrl: cache.sourceUrl || history.sourceUrl,
      title: cache.title || history.title,
      imageUrl: cache.imageUrl || history.imageUrl,
      downloadFormat: downloadFormatFromCache(cache),
      creditUsed: history.creditUsed,
    },
    { new: true },
  );
}

function isDuplicate3D66Operation(error = {}) {
  const response = error?.details?.response || {};
  const text = [
    error?.message,
    response.msg,
    response.message,
    JSON.stringify(response),
  ].join(" ");
  return /\u8bf7\u52ff\u91cd\u590d\u64cd\u4f5c|duplicate|repeat\s*operation/i.test(text);
}

function historyMatchesProductIdentity(history, productIds = [], sourceUrl = "") {
  const candidateIds = new Set(uniqueProductIds(productIds));
  if (candidateIds.has(String(history?.productId || ""))) return true;

  if (hasExplicitProductId(sourceUrl)) return false;

  const historySourceIds = productIdsFromModelUrl(history?.sourceUrl || "");
  if (historySourceIds.some((id) => candidateIds.has(id))) return true;

  const currentKey = modelPageKey(sourceUrl);
  const historyKey = modelPageKey(history?.sourceUrl || "");
  return Boolean(currentKey && historyKey && currentKey === historyKey);
}

function historyMatchesDownloadFormat(history = {}, requestedFormat = null) {
  const requestedKey = downloadFormatKey(requestedFormat);
  if (!requestedKey) return true;
  return String(history?.downloadFormat?.key || "") === requestedKey;
}

function findDownloadFormatOption(formatOptions = [], requestedFormat = null) {
  const requestedKey = downloadFormatKey(requestedFormat);
  if (!requestedKey) return null;
  return (
    sanitizeDownloadFormatOptions(formatOptions).find(
      (option) => downloadFormatKey(option) === requestedKey,
    ) || null
  );
}

function readUrlRequest(req, res) {
  const unknownKey = rejectUnknownKeys(req.body, ["url", "modelId", "includePreviewImage", "downloadFormat"]);
  if (unknownKey) {
    res.status(400).json({ message: "Invalid getlink request" });
    return null;
  }

  const input = String(req.body.modelId || req.body.url || "").trim();
  if (!input || input.length > 128) {
    res.status(400).json({ message: "Model ID is required" });
    return null;
  }

  try {
    return modelIdTo3D66Url(extractModelIdInput(input));
  } catch (error) {
    res.status(error.status || 400).json({ message: error.message });
    return null;
  }
}

function normalizeBooleanFlag(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  }
  return false;
}

function shouldWriteSystemError(error) {
  return !error.status || Number(error.status) >= 500;
}

function isClientDownloadAbort(error, signal) {
  return (
    error?.code === "ERR_STREAM_PREMATURE_CLOSE" ||
    /premature close/i.test(error?.message || "") ||
    (signal?.aborted && /terminated|aborted|socket hang up/i.test(error?.message || ""))
  );
}

async function findActiveRedownload(userId, productIds, sourceUrl = "", requestedFormat = null) {
  const candidates = uniqueProductIds([
    productIds,
    productIdsFromModelUrl(sourceUrl),
  ]);
  if (!candidates.length && !sourceUrl) return null;

  const histories = await Getlink.find({ userId })
    .sort({ createdAt: -1 })
    .limit(500);

  return (
    histories.find(
      (history) =>
        canRedownload(history) &&
        historyMatchesProductIdentity(history, candidates, sourceUrl) &&
        historyMatchesDownloadFormat(history, requestedFormat),
    ) || null
  );
}

function isCacheFresh(cache) {
  if (!cache?.fileUrl) return false;
  if (process.env.THREED66_MOCK !== "false") return true;

  try {
    const parsed = new URL(cache.fileUrl);
    const authKey = parsed.searchParams.get("auth_key") || "";
    const expiresAt = Number(authKey.split("-")[0]);
    if (!Number.isFinite(expiresAt) || expiresAt <= 0) return true;
    return expiresAt - Math.floor(Date.now() / 1000) > 300;
  } catch {
    return true;
  }
}

function publicBaseUrl(req) {
  const configured = String(process.env.PUBLIC_BASE_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (configured) return configured;
  // Fallback chi nen dung trong dev. Production phai set PUBLIC_BASE_URL
  // de tranh host header injection (Host: evil.com).
  return `${req.protocol}://${req.get("host")}`;
}

function publicDownloadUrl(req, historyId) {
  const userId = String(req.user?._id || "");
  const token = signDownloadToken(String(historyId), userId);
  return `${publicBaseUrl(req)}/api/getlink/download/${historyId}?t=${token}`;
}

function publicPreviewImageUrl(req, historyId) {
  const userId = String(req.user?._id || "");
  const token = signDownloadToken(String(historyId), userId);
  return `${publicBaseUrl(req)}/api/getlink/preview-image/${historyId}?t=${token}`;
}

function publicHistoryItem(req, item) {
  const doc = item.toObject ? item.toObject() : item;
  const allowed = canRedownload(doc);
  const formatOptions = sanitizeDownloadFormatOptions(doc.formatOptions);
  return {
    ...doc,
    formatOptions,
    hasDownloadFormats: formatOptions.length > 0,
    fileUrl: undefined,
    downloadUrl: allowed ? publicDownloadUrl(req, doc._id) : null,
    previewImageDownloadUrl:
      allowed && doc.imageUrl ? publicPreviewImageUrl(req, doc._id) : null,
    canRedownload: allowed,
    redownloadExpiresAt: redownloadExpiresAt(doc),
    redownloadDays: redownloadWindowDays(),
    redownloadCount: Number(doc.redownloadCount || 0),
    redownloadLimit: redownloadLimit(),
    redownloadRemaining: Math.max(
      0,
      redownloadLimit() - Number(doc.redownloadCount || 0),
    ),
  };
}

function sendFreeRedownload(req, res, history, options = {}) {
  const downloadUrl = publicDownloadUrl(req, history._id);
  const includePreviewImage = Boolean(options.includePreviewImage);
  return res.json({
    url: downloadUrl,
    downloadUrl,
    previewImageDownloadUrl:
      includePreviewImage && history.imageUrl
        ? publicPreviewImageUrl(req, history._id)
        : null,
    productId: history.productId,
    title: history.title,
    imageUrl: history.imageUrl,
    selectedFormat: history.downloadFormat || null,
    credit: req.user.credit,
    cached: true,
    creditUsed: 0,
    freeRedownload: true,
    canRedownload: true,
    redownloadExpiresAt: redownloadExpiresAt(history),
    redownloadCount: Number(history.redownloadCount || 0),
    redownloadLimit: redownloadLimit(),
    redownloadRemaining: Math.max(
      0,
      redownloadLimit() - Number(history.redownloadCount || 0),
    ),
  });
}

function isRefreshableStatus(status) {
  return [401, 403, 404, 410, 419].includes(Number(status));
}

function fileNameFromUrl(fileUrl = "", productId = "model") {
  try {
    const parsed = new URL(fileUrl);
    const name = decodeURIComponent(
      parsed.pathname.split("/").filter(Boolean).pop() || "",
    );
    return name || `${productId}.rar`;
  } catch {
    return `${productId}.rar`;
  }
}

function fileExtensionFromUrl(fileUrl = "") {
  const name = fileNameFromUrl(fileUrl, "");
  const match = name.match(/\.(rar|zip|7z|tar|gz|dwg|skp|max|fbx|obj)$/i);
  return match ? match[0].toLowerCase() : ".rar";
}

function imageExtensionFromUrl(imageUrl = "", contentType = "") {
  const byContentType = String(contentType).toLowerCase();
  if (byContentType.includes("avif")) return ".avif";
  if (byContentType.includes("svg")) return ".svg";
  if (byContentType.includes("heic")) return ".heic";
  if (byContentType.includes("png")) return ".png";
  if (byContentType.includes("webp")) return ".webp";
  if (byContentType.includes("gif")) return ".gif";
  if (byContentType.includes("jpeg") || byContentType.includes("jpg")) return ".jpg";

  try {
    const parsed = new URL(imageUrl);
    const match = parsed.pathname.match(/\.(jpe?g|png|webp|gif|avif|svg|heic)$/i);
    return match ? `.${match[1].toLowerCase().replace("jpeg", "jpg")}` : ".jpg";
  } catch {
    return ".jpg";
  }
}

function sniffImageMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return "";

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  const sixBytes = buffer.subarray(0, 6).toString("ascii");
  if (sixBytes === "GIF87a" || sixBytes === "GIF89a") return "image/gif";
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii").toLowerCase();
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (brand.startsWith("hei")) return "image/heic";
  }

  const head = buffer.subarray(0, Math.min(buffer.length, 512)).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) {
    return "image/svg+xml";
  }

  return "";
}

function previewImageFileName(history, contentType = "") {
  const modelName = fileNameFromUrl(history.fileUrl, history.productId);
  const baseName =
    modelName.replace(/\.[^.]+$/, "").trim() ||
    String(history.productId || "preview");
  return `${baseName}${imageExtensionFromUrl(history.imageUrl, contentType)}`.replace(/"/g, "");
}

function resolvePreviewImageUrl(imageUrl = "", sourceUrl = "") {
  const resolved = new URL(
    String(imageUrl || ""),
    sourceUrl || "https://www.3d66.com/",
  );
  if (!["http:", "https:"].includes(resolved.protocol)) {
    throw httpError(400, "Invalid preview image URL");
  }
  return resolved.toString();
}

function previewImageUrlCandidates(imageUrl = "", sourceUrl = "") {
  const original = resolvePreviewImageUrl(imageUrl, sourceUrl);
  const candidates = [];
  const add = (value) => {
    if (value && !candidates.includes(value)) candidates.push(value);
  };

  try {
    const parsed = new URL(original);
    const noStylePath = parsed.pathname.replace(/![^/?#]+$/i, "");
    if (noStylePath !== parsed.pathname) {
      const noStyleNoQuery = new URL(parsed.toString());
      noStyleNoQuery.pathname = noStylePath;
      noStyleNoQuery.search = "";
      add(noStyleNoQuery.toString());

      const noStyle = new URL(parsed.toString());
      noStyle.pathname = noStylePath;
      add(noStyle.toString());

      const largeStyle = new URL(parsed.toString());
      largeStyle.pathname = `${noStylePath}!large-size-p`;
      add(largeStyle.toString());

      const detailStyle = new URL(parsed.toString());
      detailStyle.pathname = `${noStylePath}!detail-pic-p`;
      add(detailStyle.toString());

      const mediumStyle = new URL(parsed.toString());
      mediumStyle.pathname = `${noStylePath}!medium-size-p`;
      add(mediumStyle.toString());
    }
  } catch {
    // keep original fallback
  }

  add(original);
  return candidates;
}

function dispositionFileName(disposition = "") {
  const utf8 = String(disposition).match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  if (utf8) {
    try {
      return decodeURIComponent(utf8.trim().replace(/^["']|["']$/g, ""));
    } catch {
      return utf8.trim().replace(/^["']|["']$/g, "");
    }
  }

  return (
    String(disposition)
      .match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i)?.slice(1)
      .find(Boolean)
      ?.trim() || ""
  );
}

function hasKnownExtension(name = "") {
  return /\.(rar|zip|7z|tar|gz|dwg|skp|max|fbx|obj)$/i.test(String(name));
}

function contentDispositionFrom3D66(upstreamDisposition = "", history) {
  const upstreamName = dispositionFileName(upstreamDisposition);
  if (!upstreamName) return "";
  if (hasKnownExtension(upstreamName)) return upstreamDisposition;

  const extension = fileExtensionFromUrl(history.fileUrl);
  const fixedName = `${upstreamName}${extension}`.replace(/"/g, "");
  const encoded = encodeURIComponent(fixedName).replace(/['()]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fixedName}"; filename*=UTF-8''${encoded}`;
}

function isFallbackMetadata(metadata = {}, inputProductId = "") {
  const title = String(metadata.title || "").trim();
  const productId = String(metadata.productId || inputProductId || "").trim();
  const creditCost = Number(metadata.creditCost || 0);
  const priceKnown = Boolean(metadata.priceKnown || creditCost > 1);
  const hasBasicMetadata = Boolean(
    productId &&
      title &&
      title !== "3D66 model" &&
      title !== inputProductId &&
      title !== productId,
  );
  if (hasBasicMetadata && creditCost > 0) return false;
  return Boolean(
    !title ||
    title === "3D66 model" ||
    title === inputProductId ||
    creditCost <= 0 ||
    (!priceKnown && creditCost <= 1),
  );
}

async function upsertProductCache(payload, preferredCache = null) {
  const normalizedPayload = {
    ...payload,
    creditCost: normalizeDownloadCreditCost(payload.creditCost, 1),
    priceKnown: Boolean(payload.priceKnown || Number(payload.creditCost || 0) > 1),
  };

  if (
    preferredCache?._id &&
    String(preferredCache.productId || "") ===
      String(normalizedPayload.productId || "")
  ) {
    return ProductCache.findByIdAndUpdate(
      preferredCache._id,
      { $set: normalizedPayload },
      { new: true },
    );
  }

  try {
    return await ProductCache.findOneAndUpdate(
      { productId: normalizedPayload.productId },
      { $set: normalizedPayload },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
    return ProductCache.findOneAndUpdate(
      { productId: normalizedPayload.productId },
      { $set: normalizedPayload },
      { new: true },
    );
  }
}

function selectedDownloadFormat(formatOptions = []) {
  return formatOptions.find((option) => option.isDefault) || formatOptions[0] || null;
}

function formatSelectionPayload(req, payload = {}) {
  const formatOptions = sanitizeDownloadFormatOptions(payload.formatOptions);
  return {
    requiresFormatSelection: true,
    productId: payload.productId || "",
    title: payload.title || payload.productId || "",
    imageUrl: payload.imageUrl || "",
    creditCost: normalizeDownloadCreditCost(payload.creditCost, 1),
    selectedFormat: selectedDownloadFormat(formatOptions),
    formatOptions,
    credit: req.user?.credit,
    freeRedownload: Boolean(payload.freeRedownload),
  };
}

async function resolveDownloadFormatSelection(url, productId, cache = null, fallbackMetadata = {}, options = {}) {
  const preferLive = Boolean(options.preferLive);
  let metadata = fallbackMetadata || {};
  let formatOptions = preferLive ? [] : cacheDownloadFormatOptions(cache);
  let targetCache = cache;
  let browserInspection = null;

  if (formatOptions.length <= 1) {
    const selection = await with3D66Cookie((cookieValue) =>
      queue3D66Getlink(async () => {
        let choiceInspection = null;
        if (preferLive) {
          try {
            choiceInspection = await inspect3D66DownloadChoice(url, cookieValue);
          } catch {
            // If the lightweight pop API is unavailable, keep the browser path.
          }

          const choiceOptions = sanitizeDownloadFormatOptions(choiceInspection?.formatOptions);
          if (choiceOptions.length > 1) {
            return {
              choiceInspection,
              inspection: null,
              browserInspection: null,
              formatOptions: choiceOptions,
              skipBrowser: false,
            };
          }

          if (choiceInspection?.hasFormatChoice === false) {
            return {
              choiceInspection,
              inspection: null,
              browserInspection: null,
              formatOptions: [],
              skipBrowser: true,
            };
          }
        }

        const inspection = await inspect3D66Page(url, cookieValue);
        const inspectedOptions = preferLive
          ? []
          : sanitizeDownloadFormatOptions(inspection?.metadata?.formatOptions);

        if (preferLive || inspectedOptions.length <= 1) {
          const nextBrowserInspection = await inspect3D66DownloadFormats(url, cookieValue);
          return {
            choiceInspection,
            inspection,
            browserInspection: nextBrowserInspection,
            formatOptions: sanitizeDownloadFormatOptions(
              nextBrowserInspection?.formatOptions || nextBrowserInspection?.metadata?.formatOptions,
            ),
            skipBrowser: false,
          };
        }

        return {
          choiceInspection,
          inspection,
          browserInspection: null,
          formatOptions: inspectedOptions,
          skipBrowser: false,
        };
      }),
    );
    const inspection = selection?.inspection;
    browserInspection = selection?.browserInspection;
    if (selection?.choiceInspection?.metadata) {
      metadata = {
        ...metadata,
        ...selection.choiceInspection.metadata,
      };
    }
    if (inspection?.metadata) {
      metadata = {
        ...metadata,
        ...inspection.metadata,
      };
    }
    if (browserInspection?.metadata) {
      metadata = {
        ...metadata,
        ...browserInspection.metadata,
      };
    }
    formatOptions = selection?.skipBrowser
      ? []
      : sanitizeDownloadFormatOptions(selection?.formatOptions);

    if (browserInspection?.fileUrl) {
      targetCache = await upsertProductCache(
        {
          productId: browserInspection.productId || metadata.productId || productId,
          fileUrl: browserInspection.fileUrl,
          sourceUrl: browserInspection.sourceUrl || browserInspection.pageUrl || inspection?.pageUrl || url,
          title: browserInspection.title || metadata.title || cache?.title || fallbackMetadata.title,
          imageUrl: browserInspection.imageUrl || metadata.imageUrl || cache?.imageUrl || fallbackMetadata.imageUrl,
          creditCost: normalizeDownloadCreditCost(
            browserInspection.creditCost || metadata.creditCost || cache?.creditCost || fallbackMetadata.creditCost,
            1,
          ),
          priceKnown: Boolean(
            browserInspection.priceKnown ||
              metadata.priceKnown ||
              cache?.priceKnown ||
              fallbackMetadata.priceKnown ||
              Number(browserInspection.creditCost || metadata.creditCost || cache?.creditCost || fallbackMetadata.creditCost || 0) > 1,
          ),
          formatOptions,
          formatOptionsVersion: DOWNLOAD_FORMAT_OPTIONS_VERSION,
          isPurchased: true,
        },
        cache,
      );
    } else if (formatOptions.length > 1) {
      targetCache = await upsertProductCache(
        {
          productId: metadata.productId || productId,
          sourceUrl: metadata.sourceUrl || inspection?.pageUrl || url,
          title: metadata.title || cache?.title || fallbackMetadata.title,
          imageUrl: metadata.imageUrl || cache?.imageUrl || fallbackMetadata.imageUrl,
          creditCost: normalizeDownloadCreditCost(
            metadata.creditCost || cache?.creditCost || fallbackMetadata.creditCost,
            1,
          ),
          priceKnown: Boolean(
            metadata.priceKnown ||
              cache?.priceKnown ||
              fallbackMetadata.priceKnown ||
              Number(metadata.creditCost || cache?.creditCost || fallbackMetadata.creditCost || 0) > 1,
          ),
          formatOptions,
          formatOptionsVersion: DOWNLOAD_FORMAT_OPTIONS_VERSION,
        },
        cache,
      );
    }
  }

  return {
    cache: targetCache,
    metadata,
    formatOptions,
  };
}

function setProxyHeaders(res, upstream, history) {
  const passthrough = [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "content-encoding",
  ];
  passthrough.forEach((key) => {
    const value = upstream.headers.get(key);
    if (value) res.setHeader(key, value);
  });

  if (!res.getHeader("content-type")) {
    res.setHeader("content-type", "application/octet-stream");
  }

  const upstreamDisposition = upstream.headers.get("content-disposition");
  res.setHeader(
    "content-disposition",
    contentDispositionFrom3D66(upstreamDisposition, history) ||
      `attachment; filename="${fileNameFromUrl(history.fileUrl, history.productId).replace(/"/g, "")}"`,
  );
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-accel-buffering", "no");
}

function looksLikeDownloadFile(upstream) {
  const contentType = String(
    upstream.headers.get("content-type") || "",
  ).toLowerCase();
  const disposition = String(
    upstream.headers.get("content-disposition") || "",
  ).toLowerCase();
  if (disposition.includes("attachment")) return true;
  if (!contentType) return true;
  return (
    !contentType.includes("text/html") &&
    !contentType.includes("application/json")
  );
}

async function resolveProductCache(productId, url, downloadFormat = null) {
  const existing = await ProductCache.findOne({ productId });
  if (
    isCacheFresh(existing) &&
    cacheMatchesModelUrl(existing, url) &&
    cacheMatchesDownloadFormat(existing, downloadFormat)
  ) {
    return existing;
  }

  if (!productLocks.has(productId)) {
    if (productLocks.size >= MAX_PRODUCT_LOCKS) {
      const error = new Error("Too many 3D66 product tasks are running. Please try again shortly.");
      error.status = 429;
      throw error;
    }
    productLocks.set(
      productId,
      (async () => {
        const cached = await ProductCache.findOne({ productId });
        if (
          isCacheFresh(cached) &&
          cacheMatchesModelUrl(cached, url) &&
          cacheMatchesDownloadFormat(cached, downloadFormat)
        ) {
          return cached;
        }

        const download = await with3D66Cookie((cookieValue) =>
          queue3D66Getlink(() => fetchFrom3D66(url, cookieValue, { downloadFormat })),
        );
        const fileUrl =
          typeof download === "string" ? download : download.fileUrl;
        const cacheProductId =
          (typeof download === "string" ? "" : download.productId) || productId;
        const metadata = typeof download === "string" ? {} : download;
        const resolvedCache =
          cacheProductId !== productId
            ? await ProductCache.findOne({ productId: cacheProductId })
            : null;
        if (
          isCacheFresh(resolvedCache) &&
          cacheMatchesModelUrl(resolvedCache, url) &&
          cacheMatchesDownloadFormat(resolvedCache, downloadFormat)
        ) {
          return resolvedCache;
        }

        const metadataCache = [resolvedCache, cached, existing].find((cache) =>
          cacheMatchesModelUrl(cache, url),
        );
        const writableCache = resolvedCache || cached || existing;
        const creditCost = normalizeDownloadCreditCost(
          metadata.creditCost || metadataCache?.creditCost,
          1,
        );
        const priceKnown = Boolean(
          metadata.priceKnown ||
            metadataCache?.priceKnown ||
            Number(metadata.creditCost || metadataCache?.creditCost || 0) > 1,
        );
        const cachePayload = {
          productId: cacheProductId,
          fileUrl,
          sourceUrl: metadata.sourceUrl || url,
          title: metadata.title || metadataCache?.title,
          imageUrl: metadata.imageUrl || metadataCache?.imageUrl,
          creditCost,
          priceKnown,
          formatOptions: freshDownloadFormatOptions(metadata.formatOptions, metadataCache),
          formatOptionsVersion: DOWNLOAD_FORMAT_OPTIONS_VERSION,
          ...cacheFormatPatch(metadata.selectedFormat),
          isPurchased: true,
        };

        if (writableCache?._id) {
          const updated = await ProductCache.findByIdAndUpdate(
            writableCache._id,
            cachePayload,
            { new: true },
          );
          if (updated) return updated;
        }

        try {
          return await ProductCache.create(cachePayload);
        } catch (error) {
          if (error.code !== 11000) throw error;
          return ProductCache.findOneAndUpdate(
            { productId: cacheProductId },
            { $set: cachePayload },
            { new: true },
          );
        }
      })().finally(() => {
        productLocks.delete(productId);
      }),
    );
  }

  return productLocks.get(productId);
}

export async function previewGetlink(req, res, next) {
  try {
    const url = readUrlRequest(req, res);
    if (!url) return;

    const productId = extractProductId(url);
    const previewProductId = lockedProductId(url, productId, productId);
    const cache = await ProductCache.findOne({ productId });
    const cacheMatchesCurrentUrl = cacheMatchesModelUrl(cache, url);
    const cachedTitle = String(cache?.title || "").trim();
    const hasRealCachedTitle = Boolean(
      cachedTitle &&
      cachedTitle !== "3D66 model" &&
      cachedTitle !== cache?.productId &&
      cachedTitle !== productId,
    );
    const hasReliableCachedPrice = Number(cache?.creditCost || 0) > 1;
    const hasKnownCachedPrice = Boolean(cache?.priceKnown || hasReliableCachedPrice);
    const hasPreviewMetadata = Boolean(
      cacheMatchesCurrentUrl && hasRealCachedTitle && hasKnownCachedPrice,
    );
    if (hasPreviewMetadata) {
      return res.json({
        productId: previewProductId,
        title: cache.title || cache.productId,
        imageUrl: cache.imageUrl || "",
        creditCost: normalizeDownloadCreditCost(cache.creditCost, 1),
        cached: isCacheFresh(cache),
      });
    }

    const preview = await with3D66Cookie((cookieValue) =>
      queue3D66Preview(() => fetch3D66Preview(url, cookieValue)),
    );
    const resolvedProductId = lockedProductId(url, productId, preview.productId);
    if (
      process.env.THREED66_MOCK === "false" &&
      isFallbackMetadata(preview, resolvedProductId)
    ) {
      return res.status(422).json({
        message:
          "Chưa đọc được đầy đủ thông tin model 3D66. Vui lòng thử lại hoặc bật Playwright fallback nếu model bị 3D66 render/challenge.",
        metadataIncomplete: true,
        productId: resolvedProductId,
      });
    }
    const previewPayload = {
      productId: resolvedProductId,
      sourceUrl: preview.sourceUrl || url,
      title: preview.title,
      imageUrl: preview.imageUrl,
      creditCost: normalizeDownloadCreditCost(preview.creditCost, 1),
      priceKnown: Boolean(preview.priceKnown || Number(preview.creditCost || 0) > 1),
    };
    await upsertProductCache(previewPayload, cache);
    res.json({
      productId: resolvedProductId,
      title: preview.title,
      imageUrl: preview.imageUrl,
      creditCost: normalizeDownloadCreditCost(preview.creditCost, 1),
      cached: false,
      metadataIncomplete: isFallbackMetadata(
        preview,
        resolvedProductId,
      ),
    });
  } catch (error) {
    if (shouldWriteSystemError(error)) {
      await writeSystemLog({
        type: "getlink",
        level: "error",
        message: error.message,
        userId: req.user?._id,
        ip: req.ip,
        path: req.path,
        status: error.status,
        details: { stage: "preview" },
      });
    }
    next(error);
  }
}

export async function inspectGetlink(req, res, next) {
  try {
    const url = readUrlRequest(req, res);
    if (!url) return;

    const inspection = await with3D66Cookie((cookieValue) =>
      queue3D66Getlink(() => inspect3D66Page(url, cookieValue)),
    );
    res.json(inspection);
  } catch (error) {
    if (shouldWriteSystemError(error)) {
      await writeSystemLog({
        type: "getlink",
        level: "error",
        message: error.message,
        userId: req.user?._id,
        ip: req.ip,
        path: req.path,
        status: error.status,
        details: { stage: "inspect" },
      });
    }
    next(error);
  }
}

export async function getLink(req, res, next) {
  let acquiredLockKey = null;
  let logProductId = "";
  try {
    const url = readUrlRequest(req, res);
    if (!url) return;
    const includePreviewImage = normalizeBooleanFlag(req.body?.includePreviewImage);
    const downloadFormat = normalizeDownloadFormatRequest(req.body?.downloadFormat);

    const productId = extractProductId(url);
    const lockToInputProductId = hasExplicitProductId(url);
    const requestedProductIds = productIdsFromModelUrl(url);
    let effectiveProductId = productId;
    logProductId = productId;

    // Acquire per-user-per-product mutex de chan 2 request dong thoi cung product
    // bi tru credit 2 lan (race condition giua findActiveRedownload va deductCredit).
    const lockKey = userProductLockKey(req.user._id, productId);
    if (userProductLocks.has(lockKey)) {
      securityEvent("GETLINK_CONCURRENT_REQUEST", {
        userId: String(req.user._id),
        productId,
        ip: req.ip,
      });
      return res.status(409).json({
        message:
          "Yeu cau cho model nay dang xu ly. Vui long doi vai giay roi thu lai.",
        retryable: true,
      });
    }
    userProductLocks.add(lockKey);
    acquiredLockKey = lockKey;

    let activeRedownload = await findActiveRedownload(
      req.user._id,
      requestedProductIds.length ? requestedProductIds : productId,
      url,
      downloadFormat,
    );
    if (!activeRedownload && downloadFormat) {
      const activeRedownloadAnyFormat = await findActiveRedownload(
        req.user._id,
        requestedProductIds.length ? requestedProductIds : productId,
        url,
        null,
      );
      if (activeRedownloadAnyFormat) {
        activeRedownload = await with3D66Cookie((cookieValue) =>
          refreshHistoryDownloadLocked(activeRedownloadAnyFormat, cookieValue, downloadFormat),
        );
      }
    }
    if (activeRedownload) {
      if (!downloadFormat) {
        const redownloadCache = await ProductCache.findOne({ productId: activeRedownload.productId }).lean();
        const redownloadFormatSelection = await resolveDownloadFormatSelection(
          activeRedownload.sourceUrl || url,
          activeRedownload.productId,
          redownloadCache,
          {
            productId: activeRedownload.productId,
            title: activeRedownload.title,
            imageUrl: activeRedownload.imageUrl,
            creditCost: activeRedownload.creditUsed || 1,
            priceKnown: true,
          },
          { preferLive: true },
        );
        const redownloadFormatOptions = sanitizeDownloadFormatOptions(redownloadFormatSelection.formatOptions);
        if (redownloadFormatOptions.length > 1) {
          return res.json(formatSelectionPayload(req, {
            productId: activeRedownload.productId,
            title: activeRedownload.title,
            imageUrl: activeRedownload.imageUrl,
            creditCost: activeRedownload.creditUsed || 1,
            formatOptions: redownloadFormatOptions,
            freeRedownload: true,
          }));
        }
      }
      return sendFreeRedownload(req, res, activeRedownload, {
        includePreviewImage,
      });
    }

    let cachePreview = await ProductCache.findOne({ productId });
    if (cachePreview && !cacheMatchesModelUrl(cachePreview, url)) {
      cachePreview = null;
    }
    let expectedCreditCost = normalizeDownloadCreditCost(
      cachePreview?.creditCost,
      0,
    );

    if (
      !expectedCreditCost ||
      expectedCreditCost <= 1 ||
      isFallbackMetadata(cachePreview || {}, productId)
    ) {
      const preview = await with3D66Cookie((cookieValue) =>
        queue3D66Preview(() => fetch3D66Preview(url, cookieValue)),
      );
      if (
        process.env.THREED66_MOCK === "false" &&
        isFallbackMetadata(preview, preview.productId || productId)
      ) {
        return res.status(422).json({
          message:
            "Cannot read 3D66 model metadata yet. Please check 3D66 cookie/browser status before downloading.",
          metadataIncomplete: true,
        });
      }

      expectedCreditCost = normalizeDownloadCreditCost(preview.creditCost, 1);
      const previewProductId = lockedProductId(url, productId, preview.productId);
      const previewPayload = {
        productId: previewProductId,
        sourceUrl: preview.sourceUrl || url,
        title: preview.title,
        imageUrl: preview.imageUrl,
        creditCost: expectedCreditCost,
        priceKnown: Boolean(preview.priceKnown || Number(preview.creditCost || 0) > 1),
      };
      effectiveProductId = previewPayload.productId;
      logProductId = effectiveProductId;

      if (!lockToInputProductId && previewPayload.productId !== productId) {
        let previewRedownload = await findActiveRedownload(
          req.user._id,
          [productId, previewPayload.productId],
          url,
          downloadFormat,
        );
        if (!previewRedownload && downloadFormat) {
          const previewRedownloadAnyFormat = await findActiveRedownload(
            req.user._id,
            [productId, previewPayload.productId],
            url,
            null,
          );
          if (previewRedownloadAnyFormat) {
            previewRedownload = await with3D66Cookie((cookieValue) =>
              refreshHistoryDownloadLocked(previewRedownloadAnyFormat, cookieValue, downloadFormat),
            );
          }
        }
        if (previewRedownload) {
          if (!downloadFormat) {
            const redownloadCache = await ProductCache.findOne({ productId: previewRedownload.productId }).lean();
            const redownloadFormatSelection = await resolveDownloadFormatSelection(
              previewRedownload.sourceUrl || url,
              previewRedownload.productId,
              redownloadCache,
              {
                productId: previewRedownload.productId,
                title: previewRedownload.title,
                imageUrl: previewRedownload.imageUrl,
                creditCost: previewRedownload.creditUsed || 1,
                priceKnown: true,
              },
              { preferLive: true },
            );
            const redownloadFormatOptions = sanitizeDownloadFormatOptions(redownloadFormatSelection.formatOptions);
            if (redownloadFormatOptions.length > 1) {
              return res.json(formatSelectionPayload(req, {
                productId: previewRedownload.productId,
                title: previewRedownload.title,
                imageUrl: previewRedownload.imageUrl,
                creditCost: previewRedownload.creditUsed || 1,
                formatOptions: redownloadFormatOptions,
                freeRedownload: true,
              }));
            }
          }
          return sendFreeRedownload(req, res, previewRedownload, {
            includePreviewImage,
          });
        }
      }

      cachePreview = await upsertProductCache(previewPayload, cachePreview);
    }

    const preFormatCreditCheck = await hasEnoughCredit(req.user._id, expectedCreditCost);
    if (!preFormatCreditCheck.ok) {
      return res.status(402).json({
        message: `Không đủ credit. Cần ${expectedCreditCost} credit.`,
        creditRequired: expectedCreditCost,
        credit: preFormatCreditCheck.credit,
      });
    }

    if (!downloadFormat) {
      const formatSelection = await resolveDownloadFormatSelection(
        url,
        effectiveProductId,
        cachePreview,
        {
          productId: effectiveProductId,
          title: cachePreview?.title,
          imageUrl: cachePreview?.imageUrl,
          creditCost: expectedCreditCost,
          priceKnown: cachePreview?.priceKnown,
        },
        { preferLive: true },
      );
      const formatOptions = sanitizeDownloadFormatOptions(formatSelection.formatOptions);
      if (formatSelection.cache) {
        if (
          !lockToInputProductId ||
          requestedProductIds.includes(String(formatSelection.cache.productId || ""))
        ) {
          cachePreview = formatSelection.cache;
        }
        effectiveProductId = lockToInputProductId
          ? lockedProductId(url, productId, formatSelection.cache.productId)
          : cachePreview.productId || effectiveProductId;
        logProductId = effectiveProductId;
      }
      if (formatOptions.length > 1) {
        const metadata = formatSelection.metadata || {};
        const selectionCache = formatSelection.cache || cachePreview;
        return res.json(formatSelectionPayload(req, {
          productId: lockToInputProductId
            ? lockedProductId(url, productId, metadata.productId || selectionCache?.productId || effectiveProductId)
            : metadata.productId || selectionCache?.productId || effectiveProductId,
          title: metadata.title || selectionCache?.title || cachePreview?.title,
          imageUrl: metadata.imageUrl || selectionCache?.imageUrl || cachePreview?.imageUrl,
          creditCost: expectedCreditCost,
          formatOptions,
        }));
      }
    }

    const creditCheck = await hasEnoughCredit(req.user._id, expectedCreditCost);
    if (!creditCheck.ok) {
      return res.status(402).json({
        message: `Không đủ credit. Cần ${expectedCreditCost} credit.`,
        creditRequired: expectedCreditCost,
        credit: creditCheck.credit,
      });
    }

    const cachedBeforeDownload = await ProductCache.findOne({
        productId: effectiveProductId,
        fileUrl: { $ne: "" },
      });
    const hadCache = Boolean(
      cachedBeforeDownload &&
        cacheMatchesModelUrl(cachedBeforeDownload, url) &&
        cacheMatchesDownloadFormat(cachedBeforeDownload, downloadFormat),
    );
    const cache = await resolveProductCache(effectiveProductId, url, downloadFormat);
    if (lockToInputProductId && !requestedProductIds.includes(String(cache.productId || ""))) {
      throw Object.assign(
        new Error("3D66 returned a different model than the requested link. Please retry this model."),
        {
          status: 502,
          details: {
            requestedProductId: productId,
            requestedProductIds,
            returnedProductId: cache.productId,
          },
        },
      );
    }
    const cachedRedownload = await findActiveRedownload(
      req.user._id,
      lockToInputProductId
        ? [productId, effectiveProductId, ...requestedProductIds]
        : [productId, effectiveProductId, cache.productId],
      url,
      downloadFormat,
    );
    if (cachedRedownload) {
      return sendFreeRedownload(req, res, cachedRedownload, {
        includePreviewImage,
      });
    }
    const creditCost = normalizeDownloadCreditCost(
      Math.max(Number(cache.creditCost || 0), Number(expectedCreditCost || 0)),
      1,
    );
    if (Number(cache.creditCost || 0) !== creditCost) {
      await ProductCache.findByIdAndUpdate(cache._id, { creditCost });
    }

    // Atomic deduct: no stale pre-check, deductCredit uses $gte atomically
    let user;
    try {
      user = await deductCredit(req.user._id, creditCost);
    } catch (deductError) {
      if (deductError.status === 402) {
        const freshUser = await User.findById(req.user._id);
        return res.status(402).json({
          message: `Not enough credit. Need ${creditCost} credit.`,
          creditRequired: creditCost,
          credit: freshUser?.credit || 0,
        });
      }
      throw deductError;
    }

    const history = await Getlink.create({
      userId: req.user._id,
      productId: cache.productId,
      fileUrl: cache.fileUrl,
      sourceUrl: cache.sourceUrl || url,
      title: cache.title,
      imageUrl: cache.imageUrl,
      creditUsed: creditCost,
      downloadFormat: {
        key: cache.downloadFormatKey || "",
        label: cache.formatLabel || "",
        fileFormat: cache.fileFormat || "",
        formatVersion: cache.formatVersion || "",
        rendererType: cache.rendererType || "",
        rendererLabel: cache.rendererLabel || "",
        size: cache.formatSize || "",
      },
    });
    const downloadUrl = publicDownloadUrl(req, history._id);
    const previewImageDownloadUrl =
      includePreviewImage && cache.imageUrl
        ? publicPreviewImageUrl(req, history._id)
        : null;

    res.json({
      url: downloadUrl,
      downloadUrl,
      previewImageDownloadUrl,
      productId: cache.productId,
      title: cache.title,
      imageUrl: cache.imageUrl,
      selectedFormat: {
        key: cache.downloadFormatKey || "",
        label: cache.formatLabel || "",
        fileFormat: cache.fileFormat || "",
        formatVersion: cache.formatVersion || "",
        rendererType: cache.rendererType || "",
        rendererLabel: cache.rendererLabel || "",
        size: cache.formatSize || "",
      },
      credit: user.credit,
      cached: hadCache,
      creditUsed: creditCost,
    });
  } catch (error) {
    if (shouldWriteSystemError(error)) {
      await writeSystemLog({
        type: "getlink",
        level: "error",
        message: error.message,
        userId: req.user?._id,
        productId: logProductId,
        ip: req.ip,
        path: req.path,
        status: error.status,
        details: { stage: "create" },
      });
    }
    next(error);
  } finally {
    if (acquiredLockKey) userProductLocks.delete(acquiredLockKey);
  }
}

async function refreshHistoryDownload(history, cookieValue, downloadFormatOverride = null) {
  if (!history.sourceUrl) return history;
  const requestedFormat = downloadFormatOverride || history.downloadFormat || null;

  const download = await queue3D66Refresh(() =>
    fetchFrom3D66(history.sourceUrl, cookieValue, {
      downloadFormat: requestedFormat,
    }),
  );
  const updatedFields = {
    fileUrl: typeof download === "string" ? download : download.fileUrl,
    sourceUrl:
      (typeof download === "string" ? "" : download.sourceUrl) ||
      history.sourceUrl,
    title:
      (typeof download === "string" ? "" : download.title) || history.title,
    imageUrl:
      (typeof download === "string" ? "" : download.imageUrl) ||
      history.imageUrl,
    downloadFormat:
      (typeof download === "string" ? null : download.selectedFormat) ||
      requestedFormat ||
      history.downloadFormat,
    creditUsed: history.creditUsed,
  };

  const cache = await ProductCache.findOne({ productId: history.productId });
  if (cache?._id) {
    await ProductCache.findByIdAndUpdate(cache._id, {
      fileUrl: updatedFields.fileUrl,
      sourceUrl: updatedFields.sourceUrl,
      title: updatedFields.title,
      imageUrl: updatedFields.imageUrl,
      ...cacheFormatPatch(updatedFields.downloadFormat),
      isPurchased: true,
    });
  }

  return Getlink.findByIdAndUpdate(history._id, updatedFields, { new: true });
}

async function refreshHistoryDownloadLocked(history, cookieValue, downloadFormatOverride = null) {
  if (!history.sourceUrl) return history;
  const requestedFormat = downloadFormatOverride || history.downloadFormat || null;
  const cachedHistory = await useFreshCacheForHistory(history, requestedFormat);
  if (cachedHistory) return cachedHistory;

  const key = refreshLockKey(history, requestedFormat);
  const existingLock = historyRefreshLocks.get(key);
  if (existingLock) {
    await existingLock.catch(() => null);
    const latestHistory = await Getlink.findById(history._id);
    if (latestHistory && isCacheFresh(latestHistory)) return latestHistory;
    const latestCachedHistory = await useFreshCacheForHistory(latestHistory || history, requestedFormat);
    if (latestCachedHistory) return latestCachedHistory;
  }

  const refreshPromise = refreshHistoryDownload(history, cookieValue, requestedFormat);
  historyRefreshLocks.set(key, refreshPromise);
  try {
    return await refreshPromise;
  } catch (error) {
    if (isDuplicate3D66Operation(error)) {
      await delay(1500);
      const latestHistory = await Getlink.findById(history._id);
      if (latestHistory && isCacheFresh(latestHistory)) return latestHistory;
      const latestCachedHistory = await useFreshCacheForHistory(latestHistory || history, requestedFormat);
      if (latestCachedHistory) return latestCachedHistory;
    }
    throw error;
  } finally {
    if (historyRefreshLocks.get(key) === refreshPromise) {
      historyRefreshLocks.delete(key);
    }
  }
}

export async function prepareRedownload(req, res, next) {
  try {
    const unknownKey = rejectUnknownKeys(req.body || {}, ["downloadFormat"]);
    if (unknownKey) {
      return res.status(400).json({ message: "Invalid redownload request" });
    }
    if (!isSafeId(req.params.id)) {
      return res.status(400).json({ message: "Invalid download id" });
    }

    const history = await Getlink.findById(req.params.id);
    if (!history) {
      return res.status(404).json({ message: "Download not found" });
    }
    if (String(history.userId) !== String(req.user._id)) {
      securityEvent("DOWNLOAD_HISTORY_FORBIDDEN", {
        userId: String(req.user._id),
        ownerId: String(history.userId),
        historyId: String(history._id),
        ip: req.ip,
      });
      return res.status(403).json({ message: "Download not found" });
    }
    if (!isWithinRedownloadWindow(history)) {
      return res.status(403).json({
        message: `Free redownload expired after ${redownloadWindowDays()} days. Please getlink this model again.`,
        canRedownload: false,
        redownloadExpiresAt: redownloadExpiresAt(history),
      });
    }
    if (!canRedownload(history)) {
      return res.status(429).json({
        message: `Download limit reached. You can download this file ${redownloadLimit()} times within ${redownloadWindowDays()} days.`,
        canRedownload: false,
        redownloadLimit: redownloadLimit(),
      });
    }

    const cache = await ProductCache.findOne({ productId: history.productId }).lean();
    let formatOptions = cacheDownloadFormatOptions(cache);
    const requestedFormat = normalizeDownloadFormatRequest(req.body?.downloadFormat);
    let selectedFormat = requestedFormat;

    if (!requestedFormat && history.sourceUrl) {
      try {
        const formatSelection = await resolveDownloadFormatSelection(
          history.sourceUrl,
          history.productId,
          cache,
          {
            productId: history.productId,
            title: history.title,
            imageUrl: history.imageUrl,
            creditCost: history.creditUsed || 1,
            priceKnown: true,
          },
          { preferLive: true },
        );
        formatOptions = sanitizeDownloadFormatOptions(formatSelection.formatOptions);
      } catch (formatError) {
        await writeSystemLog({
          type: "download",
          level: "warn",
          message: `Could not inspect 3D66 redownload formats: ${formatError.message}`,
          userId: req.user?._id,
          historyId: req.params?.id,
          status: formatError.status,
          details: { stage: "prepare-redownload-format" },
        });
      }
    }

    if (!requestedFormat && formatOptions.length > 1) {
      return res.json(formatSelectionPayload(req, {
        productId: history.productId,
        title: history.title,
        imageUrl: history.imageUrl,
        creditCost: history.creditUsed || 1,
        formatOptions,
        freeRedownload: true,
      }));
    }

    if (requestedFormat && !formatOptions.length) {
      formatOptions = [requestedFormat];
    }

    if (requestedFormat) {
      if (!formatOptions.length) {
        return res.status(400).json({ message: "Model này không có lựa chọn định dạng file." });
      }
      selectedFormat = findDownloadFormatOption(formatOptions, requestedFormat) || requestedFormat;
      if (!selectedFormat) {
        return res.status(400).json({ message: "Định dạng file đã chọn không còn khả dụng trên 3D66." });
      }
    }

    const currentFormatKey = downloadFormatKey(history.downloadFormat);
    const selectedFormatKey = downloadFormatKey(selectedFormat);
    const activeHistory =
      selectedFormatKey && selectedFormatKey !== currentFormatKey
        ? await with3D66Cookie((cookieValue) =>
            refreshHistoryDownloadLocked(history, cookieValue, selectedFormat),
          )
        : history;
    const downloadUrl = publicDownloadUrl(req, activeHistory._id);

    return res.json({
      url: downloadUrl,
      downloadUrl,
      previewImageDownloadUrl: activeHistory.imageUrl ? publicPreviewImageUrl(req, activeHistory._id) : null,
      productId: activeHistory.productId,
      title: activeHistory.title,
      imageUrl: activeHistory.imageUrl,
      selectedFormat: activeHistory.downloadFormat || selectedFormat || null,
      formatOptions,
      canRedownload: true,
      redownloadExpiresAt: redownloadExpiresAt(activeHistory),
      redownloadCount: Number(activeHistory.redownloadCount || 0),
      redownloadLimit: redownloadLimit(),
      redownloadRemaining: Math.max(
        0,
        redownloadLimit() - Number(activeHistory.redownloadCount || 0),
      ),
    });
  } catch (error) {
    if (shouldWriteSystemError(error)) {
      await writeSystemLog({
        type: "download",
        level: "error",
        message: error.message,
        userId: req.user?._id,
        historyId: req.params?.id,
        ip: req.ip,
        path: req.path,
        status: error.status,
        details: { stage: "prepare-redownload" },
      });
    }
    next(error);
  }
}

async function openDownloadResponse(history, req, signal) {
  return with3D66Cookie(async (cookieValue) => {
    let activeHistory = history;
    if (!isCacheFresh(activeHistory)) {
      activeHistory = await refreshHistoryDownloadLocked(activeHistory, cookieValue);
    }

    let upstream = await request3D66File(activeHistory.fileUrl, cookieValue, {
      sourceUrl: activeHistory.sourceUrl,
      range: req.get("range"),
      signal,
    });

    if (isRefreshableStatus(upstream.status) && activeHistory.sourceUrl) {
      activeHistory = await refreshHistoryDownloadLocked(activeHistory, cookieValue);
      upstream = await request3D66File(activeHistory.fileUrl, cookieValue, {
        sourceUrl: activeHistory.sourceUrl,
        range: req.get("range"),
        signal,
      });
    }

    if (isRefreshableStatus(upstream.status)) {
      const error = new Error(
        `3D66 download auth failed: HTTP ${upstream.status}`,
      );
      error.status = upstream.status;
      throw error;
    }

    if (
      (upstream.ok || upstream.status === 206) &&
      !looksLikeDownloadFile(upstream)
    ) {
      const error = new Error(
        "3D66 did not return a file stream. Cookie/session may be blocked or expired.",
      );
      error.status = 403;
      throw error;
    }

    return { history: activeHistory, upstream };
  });
}

export async function downloadGetlink(req, res, next) {
  const controller = new AbortController();
  const isPartialDownload = Boolean(String(req.get("range") || "").trim());
  let downloadSlot = null;
  let reservedInitialDownload = false;
  let reservedDownloadCount = false;
  let reservedHistoryId = "";
  let activeLogUserId = req.user?._id;
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    if (!isSafeId(req.params.id)) {
      return res.status(400).json({ message: "Invalid download id" });
    }

    const history = await Getlink.findById(req.params.id);
    if (!history) {
      return res.status(404).json({ message: "Download not found" });
    }
    activeLogUserId = history.userId;

    // Link tai co token HMAC de IDM co the tai ma khong can cookie trinh duyet.
    // Neu dang nhap tren web, van yeu cau dung chu so huu history.
    const token = String(req.query?.t || "");
    const ownerUserId = String(history.userId);
    const authenticatedOwner =
      req.isAuthenticated?.() &&
      req.user &&
      String(req.user._id) === ownerUserId;
    const tokenValid = verifyDownloadToken(
      token,
      String(req.params.id),
      ownerUserId,
    );

    if (!authenticatedOwner && !tokenValid) {
      securityEvent("DOWNLOAD_TOKEN_INVALID", {
        userId: ownerUserId,
        requesterId: req.user?._id ? String(req.user._id) : "",
        historyId: String(req.params.id),
        ip: req.ip,
        path: req.path,
      });
      return res.status(403).json({
        message:
          "Download link da het han hoac khong hop le. Vui long mo lai tu trang Lich su / Getlink.",
      });
    }

    downloadSlot = acquireDownloadSlot(req, ownerUserId);
    if (!downloadSlot.ok) {
      securityEvent("DOWNLOAD_CONCURRENCY_LIMIT", {
        userId: ownerUserId,
        historyId: String(req.params.id),
        ip: req.ip,
      });
      return res
        .status(downloadSlot.status)
        .json({ message: downloadSlot.message, retryable: true });
    }

    const reusePartialDownloadSession =
      isPartialDownload && isRecentPartialDownloadSession(history);
    if (!isWithinRedownloadWindow(history)) {
      return res.status(403).json({
        message: `Free redownload expired after ${redownloadWindowDays()} days. Please getlink this model again.`,
        canRedownload: false,
        redownloadExpiresAt: redownloadExpiresAt(history),
      });
    }
    if (!reusePartialDownloadSession && !canRedownload(history)) {
      return res.status(429).json({
        message: `Download limit reached. You can download this file ${redownloadLimit()} times within ${redownloadWindowDays()} days.`,
        canRedownload: false,
        redownloadLimit: redownloadLimit(),
      });
    }

    let reservedHistory = history;
    const isInitialDownload =
      !history.initialDownloadAt && Number(history.redownloadCount || 0) <= 0;
    if (!reusePartialDownloadSession && isInitialDownload) {
      const initialHistory = await Getlink.findOneAndUpdate(
        {
          _id: history._id,
          userId: history.userId,
          $or: [
            { initialDownloadAt: { $exists: false } },
            { initialDownloadAt: null },
          ],
          $and: [
            {
              $or: [
                { redownloadCount: { $exists: false } },
                { redownloadCount: { $lte: 0 } },
              ],
            },
          ],
        },
        {
          $set: {
            initialDownloadAt: new Date(),
            lastRedownloadAt: new Date(),
          },
        },
        { new: true },
      );

      if (initialHistory) {
        reservedHistory = initialHistory;
        reservedInitialDownload = true;
        reservedHistoryId = String(history._id);
      }
    } else if (!reusePartialDownloadSession) {
      const reserveConditions = [
        {
          $or: [
            { redownloadCount: { $exists: false } },
            { redownloadCount: { $lt: redownloadLimit() } },
          ],
        },
      ];
      if (isPartialDownload) {
        reserveConditions.push({
          $or: [
            { lastRedownloadAt: { $exists: false } },
            {
              lastRedownloadAt: {
                $lt: new Date(Date.now() - PARTIAL_DOWNLOAD_SESSION_MS),
              },
            },
          ],
        });
      }
      const newlyReservedHistory = await Getlink.findOneAndUpdate(
        {
          _id: history._id,
          userId: history.userId,
          $and: reserveConditions,
        },
        {
          $inc: { redownloadCount: 1 },
          $set: { lastRedownloadAt: new Date() },
        },
        { new: true },
      );

      if (newlyReservedHistory) {
        reservedHistory = newlyReservedHistory;
        reservedDownloadCount = true;
        reservedHistoryId = String(history._id);
      } else if (isPartialDownload) {
        const currentHistory = await Getlink.findById(history._id);
        if (
          !currentHistory ||
          !isWithinRedownloadWindow(currentHistory) ||
          !isRecentPartialDownloadSession(currentHistory)
        ) {
          return res.status(429).json({
            message: `Download limit reached. You can download this file ${redownloadLimit()} times within ${redownloadWindowDays()} days.`,
            canRedownload: false,
            redownloadLimit: redownloadLimit(),
          });
        }
        reservedHistory = currentHistory;
      } else {
        return res.status(429).json({
          message: `Download limit reached. You can download this file ${redownloadLimit()} times within ${redownloadWindowDays()} days.`,
          canRedownload: false,
          redownloadLimit: redownloadLimit(),
        });
      }
    }

    const { history: activeHistory, upstream } = await openDownloadResponse(
      reservedHistory,
      req,
      controller.signal,
    );

    if (!upstream.ok && upstream.status !== 206) {
      if (reservedInitialDownload && reservedHistoryId) {
        await Getlink.findByIdAndUpdate(reservedHistoryId, {
          $unset: { initialDownloadAt: "", lastRedownloadAt: "" },
        }).catch(() => {});
        reservedInitialDownload = false;
      }
      if (reservedDownloadCount && reservedHistoryId) {
        await Getlink.findByIdAndUpdate(reservedHistoryId, {
          $inc: { redownloadCount: -1 },
        }).catch(() => {});
        reservedDownloadCount = false;
      }
      return res
        .status(upstream.status || 502)
        .json({ message: `3D66 download failed: HTTP ${upstream.status}` });
    }

    if (!looksLikeDownloadFile(upstream)) {
      if (reservedInitialDownload && reservedHistoryId) {
        await Getlink.findByIdAndUpdate(reservedHistoryId, {
          $unset: { initialDownloadAt: "", lastRedownloadAt: "" },
        }).catch(() => {});
        reservedInitialDownload = false;
      }
      if (reservedDownloadCount && reservedHistoryId) {
        await Getlink.findByIdAndUpdate(reservedHistoryId, {
          $inc: { redownloadCount: -1 },
        }).catch(() => {});
        reservedDownloadCount = false;
      }
      return res.status(502).json({
        message: "3D66 did not return a file stream. Please try again later.",
      });
    }

    setProxyHeaders(res, upstream, activeHistory);
    res.status(upstream.status === 206 ? 206 : 200);

    if (!upstream.body) {
      return res.end();
    }

    res.flushHeaders();
    await pipeline(Readable.fromWeb(upstream.body), res);
    reservedInitialDownload = false;
    reservedDownloadCount = false;
  } catch (error) {
    if (reservedInitialDownload && reservedHistoryId) {
      await Getlink.findByIdAndUpdate(reservedHistoryId, {
        $unset: { initialDownloadAt: "", lastRedownloadAt: "" },
      }).catch(() => {});
      reservedInitialDownload = false;
    }
    if (reservedDownloadCount && reservedHistoryId) {
      await Getlink.findByIdAndUpdate(reservedHistoryId, {
        $inc: { redownloadCount: -1 },
      }).catch(() => {});
      reservedDownloadCount = false;
    }
    if (error.name === "AbortError") return;
    if (isClientDownloadAbort(error, controller.signal)) return;
    await writeSystemLog({
      type: "download",
      level: "error",
      message: error.message,
      userId: activeLogUserId,
      historyId: req.params?.id,
      ip: req.ip,
      path: req.path,
      status: error.status,
      details: { stage: "stream" },
    });
    if (res.headersSent) {
      console.error("Download stream failed after headers were sent:", error);
      return;
    }
    next(error);
  } finally {
    if (downloadSlot?.release) downloadSlot.release();
  }
}

export async function downloadGetlinkPreviewImage(req, res, next) {
  const controller = new AbortController();
  let activeLogUserId = req.user?._id;
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    if (!isSafeId(req.params.id)) {
      return res.status(400).json({ message: "Invalid download id" });
    }

    const history = await Getlink.findById(req.params.id);
    if (!history) {
      return res.status(404).json({ message: "Download not found" });
    }
    activeLogUserId = history.userId;

    const token = String(req.query?.t || "");
    const ownerUserId = String(history.userId);
    const authenticatedOwner =
      req.isAuthenticated?.() &&
      req.user &&
      String(req.user._id) === ownerUserId;
    const tokenValid = verifyDownloadToken(
      token,
      String(req.params.id),
      ownerUserId,
    );

    if (!authenticatedOwner && !tokenValid) {
      securityEvent("PREVIEW_IMAGE_TOKEN_INVALID", {
        userId: ownerUserId,
        requesterId: req.user?._id ? String(req.user._id) : "",
        historyId: String(req.params.id),
        ip: req.ip,
        path: req.path,
      });
      return res.status(403).json({
        message:
          "Preview image link da het han hoac khong hop le. Vui long mo lai tu trang Lich su / Getlink.",
      });
    }

    if (!history.imageUrl) {
      return res.status(404).json({ message: "Preview image not found" });
    }

    if (!isWithinRedownloadWindow(history)) {
      return res.status(403).json({
        message: `Free redownload expired after ${redownloadWindowDays()} days. Please getlink this model again.`,
        canRedownload: false,
        redownloadExpiresAt: redownloadExpiresAt(history),
      });
    }

    const previewCandidates = previewImageUrlCandidates(
      history.imageUrl,
      history.sourceUrl,
    );
    let upstream = null;
    let previewImageBuffer = null;
    let detectedContentType = "";
    let lastPreviewStatus = 0;
    const previewHeaders = {
      "user-agent":
        req.get("user-agent") ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      referer: history.sourceUrl || "https://www.3d66.com/",
      accept: "image/jpeg,image/png,image/webp,image/gif,image/*;q=0.8,*/*;q=0.5",
    };

    for (const previewUrl of previewCandidates) {
      const candidate = await fetch(previewUrl, {
        signal: controller.signal,
        headers: previewHeaders,
      });
      lastPreviewStatus = candidate.status;
      const candidateContentType = String(
        candidate.headers.get("content-type") || "",
      ).toLowerCase();
      if (candidate.ok && candidateContentType.startsWith("image/")) {
        const candidateLength = Number(candidate.headers.get("content-length") || 0);
        if (candidateLength > MAX_PREVIEW_IMAGE_BYTES) {
          try {
            await candidate.body?.cancel();
          } catch {
            // ignore failed candidate cleanup
          }
          continue;
        }

        const candidateBuffer = Buffer.from(await candidate.arrayBuffer());
        const candidateMime = sniffImageMime(candidateBuffer);
        if (
          candidateBuffer.length > 0 &&
          candidateBuffer.length <= MAX_PREVIEW_IMAGE_BYTES &&
          candidateMime
        ) {
          previewImageBuffer = candidateBuffer;
          detectedContentType = candidateMime;
          upstream = candidate;
          break;
        }
      }
      try {
        await candidate.body?.cancel();
      } catch {
        // ignore failed candidate cleanup
      }
    }

    if (!upstream || !previewImageBuffer) {
      return res
        .status(lastPreviewStatus || 502)
        .json({ message: `Preview image download failed: HTTP ${lastPreviewStatus || 502}` });
    }

    const contentType = detectedContentType || upstream.headers.get("content-type") || "image/jpeg";
    if (!String(contentType).toLowerCase().startsWith("image/")) {
      return res.status(502).json({
        message: "3D66 did not return a preview image.",
      });
    }

    const fileName = previewImageFileName(history, contentType);
    const encoded = encodeURIComponent(fileName).replace(/['()]/g, (char) =>
      `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    res.setHeader("content-length", String(previewImageBuffer.length));
    res.setHeader("content-type", contentType);
    res.setHeader(
      "content-disposition",
      `attachment; filename="${fileName}"; filename*=UTF-8''${encoded}`,
    );
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-accel-buffering", "no");
    return res.status(200).end(previewImageBuffer);
  } catch (error) {
    if (error.name === "AbortError") return;
    if (isClientDownloadAbort(error, controller.signal)) return;
    await writeSystemLog({
      type: "download",
      level: "error",
      message: error.message,
      userId: activeLogUserId,
      historyId: req.params?.id,
      ip: req.ip,
      path: req.path,
      status: error.status,
      details: { stage: "preview-image" },
    });
    if (res.headersSent) {
      console.error("Preview image stream failed after headers were sent:", error);
      return;
    }
    next(error);
  }
}

export async function getlinkHistory(req, res, next) {
  try {
    const history = await Getlink.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    const productIds = [
      ...new Set(history.map((item) => String(item.productId || "")).filter(Boolean)),
    ];
    const caches = productIds.length
      ? await ProductCache.find({ productId: { $in: productIds } })
          .select("productId formatOptions formatOptionsVersion")
          .lean()
      : [];
    const cacheByProductId = new Map(caches.map((cache) => [String(cache.productId), cache]));
    res.json({
      history: history.map((item) =>
        publicHistoryItem(req, {
          ...item,
          formatOptions: cacheDownloadFormatOptions(cacheByProductId.get(String(item.productId || ""))),
        }),
      ),
    });
  } catch (error) {
    next(error);
  }
}

import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import Getlink from "../models/Getlink.js";
import ProductCache from "../models/ProductCache.js";
import User from "../models/User.js";
import {
  fetch3D66Preview,
  fetchFrom3D66,
  inspect3D66Page,
  request3D66File,
} from "../utils/3d66Service.js";
import { with3D66Cookie } from "../utils/3d66CookiePool.js";
import { queue3D66Getlink } from "../utils/3d66Queue.js";
import { deductCredit } from "../utils/creditService.js";
import { extractProductId } from "../utils/parse3d66.js";
import { normalizeDownloadCreditCost } from "../utils/pricingService.js";
import { isSafeId, rejectUnknownKeys } from "../utils/validators.js";
import {
  signDownloadToken,
  verifyDownloadToken,
} from "../utils/downloadToken.js";
import { securityEvent } from "../utils/logger.js";
import { writeSystemLog } from "../utils/systemLog.js";

const productLocks = new Map();
const MAX_PRODUCT_LOCKS = 500;
const REDOWNLOAD_WINDOW_DAYS = Number(process.env.GETLINK_REDOWNLOAD_DAYS || 3);
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

function redownloadWindowMs() {
  const days =
    Number.isFinite(REDOWNLOAD_WINDOW_DAYS) && REDOWNLOAD_WINDOW_DAYS > 0
      ? REDOWNLOAD_WINDOW_DAYS
      : 3;
  return days * 24 * 60 * 60 * 1000;
}

function redownloadLimit() {
  const limit = Number(process.env.GETLINK_REDOWNLOAD_LIMIT || 5);
  return Number.isFinite(limit) && limit > 0 ? limit : 5;
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

function acquireDownloadSlot(req) {
  const userId = String(req.user?._id || "anonymous");
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

function readUrlRequest(req, res) {
  const unknownKey = rejectUnknownKeys(req.body, ["url"]);
  if (unknownKey) {
    res.status(400).json({ message: "Invalid getlink request" });
    return null;
  }

  const url = String(req.body.url || "").trim();
  if (!url || url.length > 3000) {
    res.status(400).json({ message: "URL is required" });
    return null;
  }

  return url;
}

async function findActiveRedownload(userId, productId) {
  if (!productId) return null;
  return Getlink.findOne({
    userId,
    productId,
    createdAt: { $gte: new Date(Date.now() - redownloadWindowMs()) },
    $or: [
      { redownloadCount: { $exists: false } },
      { redownloadCount: { $lt: redownloadLimit() } },
    ],
  }).sort({ createdAt: -1 });
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

function publicHistoryItem(req, item) {
  const doc = item.toObject ? item.toObject() : item;
  const allowed = canRedownload(doc);
  return {
    ...doc,
    fileUrl: undefined,
    downloadUrl: allowed ? publicDownloadUrl(req, doc._id) : null,
    canRedownload: allowed,
    redownloadExpiresAt: redownloadExpiresAt(doc),
    redownloadDays:
      Number.isFinite(REDOWNLOAD_WINDOW_DAYS) && REDOWNLOAD_WINDOW_DAYS > 0
        ? REDOWNLOAD_WINDOW_DAYS
        : 3,
    redownloadCount: Number(doc.redownloadCount || 0),
    redownloadLimit: redownloadLimit(),
    redownloadRemaining: Math.max(
      0,
      redownloadLimit() - Number(doc.redownloadCount || 0),
    ),
  };
}

function sendFreeRedownload(req, res, history) {
  const downloadUrl = publicDownloadUrl(req, history._id);
  return res.json({
    url: downloadUrl,
    downloadUrl,
    productId: history.productId,
    title: history.title,
    imageUrl: history.imageUrl,
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

function isFallbackMetadata(metadata = {}, inputProductId = "") {
  const title = String(metadata.title || "").trim();
  return Boolean(
    !title ||
    title === "3D66 model" ||
    title === inputProductId ||
    !metadata.imageUrl ||
    Number(metadata.creditCost || 0) <= 1,
  );
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
    upstreamDisposition ||
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

async function resolveProductCache(productId, url) {
  const existing = await ProductCache.findOne({ productId });
  if (isCacheFresh(existing)) return existing;

  if (!productLocks.has(productId)) {
    if (productLocks.size >= MAX_PRODUCT_LOCKS) {
      const firstKey = productLocks.keys().next().value;
      productLocks.delete(firstKey);
    }
    productLocks.set(
      productId,
      (async () => {
        const cached = await ProductCache.findOne({ productId });
        if (isCacheFresh(cached)) return cached;

        const download = await with3D66Cookie((cookieValue) =>
          queue3D66Getlink(() => fetchFrom3D66(url, cookieValue)),
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
        if (isCacheFresh(resolvedCache)) return resolvedCache;

        const staleCache = resolvedCache || cached || existing;
        const creditCost = normalizeDownloadCreditCost(
          metadata.creditCost || staleCache?.creditCost,
          1,
        );
        const cachePayload = {
          productId: cacheProductId,
          fileUrl,
          sourceUrl: metadata.sourceUrl || url,
          title: metadata.title || staleCache?.title,
          imageUrl: metadata.imageUrl || staleCache?.imageUrl,
          creditCost,
          isPurchased: true,
        };

        if (staleCache?._id) {
          const updated = await ProductCache.findByIdAndUpdate(
            staleCache._id,
            cachePayload,
            { new: true },
          );
          if (updated) return updated;
        }

        try {
          return await ProductCache.create(cachePayload);
        } catch (error) {
          if (error.code !== 11000) throw error;
          return ProductCache.findOne({ productId: cacheProductId });
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
    const cache = await ProductCache.findOne({ productId });
    const cachedTitle = String(cache?.title || "").trim();
    const hasRealCachedTitle = Boolean(
      cachedTitle &&
      cachedTitle !== "3D66 model" &&
      cachedTitle !== cache?.productId &&
      cachedTitle !== productId,
    );
    const cachedImage = String(cache?.imageUrl || "");
    const hasLargeCachedImage = Boolean(
      cachedImage && !/small-size-p|list-w-auto-p/i.test(cachedImage),
    );
    const hasReliableCachedPrice = Number(cache?.creditCost || 0) > 1;
    const hasPreviewMetadata = Boolean(
      hasLargeCachedImage && hasRealCachedTitle && hasReliableCachedPrice,
    );
    if (hasPreviewMetadata) {
      return res.json({
        productId: cache.productId,
        title: cache.title || cache.productId,
        imageUrl: cache.imageUrl || "",
        creditCost: normalizeDownloadCreditCost(cache.creditCost, 1),
        cached: isCacheFresh(cache),
      });
    }

    const preview = await with3D66Cookie((cookieValue) =>
      queue3D66Getlink(() => fetch3D66Preview(url, cookieValue)),
    );
    const previewPayload = {
      productId: preview.productId || productId,
      sourceUrl: preview.sourceUrl || url,
      title: preview.title,
      imageUrl: preview.imageUrl,
      creditCost: normalizeDownloadCreditCost(preview.creditCost, 1),
    };
    if (cache?._id) {
      await ProductCache.findByIdAndUpdate(cache._id, previewPayload);
    } else {
      try {
        await ProductCache.create(previewPayload);
      } catch (error) {
        if (error.code !== 11000) throw error;
        await ProductCache.findOneAndUpdate(
          { productId: previewPayload.productId },
          previewPayload,
        );
      }
    }
    res.json({
      productId: preview.productId || productId,
      title: preview.title,
      imageUrl: preview.imageUrl,
      creditCost: normalizeDownloadCreditCost(preview.creditCost, 1),
      cached: false,
      metadataIncomplete: isFallbackMetadata(
        preview,
        preview.productId || productId,
      ),
    });
  } catch (error) {
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
    next(error);
  }
}

export async function getLink(req, res, next) {
  let acquiredLockKey = null;
  let logProductId = "";
  try {
    const url = readUrlRequest(req, res);
    if (!url) return;

    const productId = extractProductId(url);
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

    const activeRedownload = await findActiveRedownload(
      req.user._id,
      productId,
    );
    if (activeRedownload) {
      return sendFreeRedownload(req, res, activeRedownload);
    }

    let cachePreview = await ProductCache.findOne({ productId });
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
        queue3D66Getlink(() => fetch3D66Preview(url, cookieValue)),
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
      const previewPayload = {
        productId: preview.productId || productId,
        sourceUrl: preview.sourceUrl || url,
        title: preview.title,
        imageUrl: preview.imageUrl,
        creditCost: expectedCreditCost,
      };

      if (previewPayload.productId !== productId) {
        const previewRedownload = await findActiveRedownload(
          req.user._id,
          previewPayload.productId,
        );
        if (previewRedownload) {
          return sendFreeRedownload(req, res, previewRedownload);
        }
      }

      cachePreview = await ProductCache.findOne({
        productId: previewPayload.productId,
      });
      if (cachePreview?._id) {
        await ProductCache.findByIdAndUpdate(cachePreview._id, previewPayload);
      } else {
        try {
          cachePreview = await ProductCache.create(previewPayload);
        } catch (error) {
          if (error.code !== 11000) throw error;
          cachePreview = await ProductCache.findOneAndUpdate(
            { productId: previewPayload.productId },
            previewPayload,
            {
              new: true,
            },
          );
        }
      }
    }

    const hadCache = Boolean(
      await ProductCache.exists({ productId, fileUrl: { $ne: "" } }),
    );
    const cache = await resolveProductCache(productId, url);
    const creditCost = normalizeDownloadCreditCost(cache.creditCost, 1);

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
    });
    const downloadUrl = publicDownloadUrl(req, history._id);

    res.json({
      url: downloadUrl,
      downloadUrl,
      productId: cache.productId,
      title: cache.title,
      imageUrl: cache.imageUrl,
      credit: user.credit,
      cached: hadCache,
      creditUsed: creditCost,
    });
  } catch (error) {
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
    next(error);
  } finally {
    if (acquiredLockKey) userProductLocks.delete(acquiredLockKey);
  }
}

async function refreshHistoryDownload(history, cookieValue) {
  if (!history.sourceUrl) return history;

  const download = await queue3D66Getlink(() =>
    fetchFrom3D66(history.sourceUrl, cookieValue),
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
    creditUsed: history.creditUsed,
  };

  const cache = await ProductCache.findOne({ productId: history.productId });
  if (cache?._id) {
    await ProductCache.findByIdAndUpdate(cache._id, {
      fileUrl: updatedFields.fileUrl,
      sourceUrl: updatedFields.sourceUrl,
      title: updatedFields.title,
      imageUrl: updatedFields.imageUrl,
      isPurchased: true,
    });
  }

  return Getlink.findByIdAndUpdate(history._id, updatedFields, { new: true });
}

async function openDownloadResponse(history, req, signal) {
  return with3D66Cookie(async (cookieValue) => {
    let activeHistory = history;
    if (!isCacheFresh(activeHistory)) {
      activeHistory = await refreshHistoryDownload(activeHistory, cookieValue);
    }

    let upstream = await request3D66File(activeHistory.fileUrl, cookieValue, {
      sourceUrl: activeHistory.sourceUrl,
      range: req.get("range"),
      signal,
    });

    if (isRefreshableStatus(upstream.status) && activeHistory.sourceUrl) {
      activeHistory = await refreshHistoryDownload(activeHistory, cookieValue);
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
  let downloadSlot = null;
  let reservedDownloadCount = false;
  let reservedHistoryId = "";
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    if (!isSafeId(req.params.id)) {
      return res.status(400).json({ message: "Invalid download id" });
    }

    // Verify HMAC download token (chong CSRF/bandwidth abuse va leak qua <img>/<iframe>).
    // Token bind voi historyId + userId + exp 15 phut.
    const token = String(req.query?.t || "");
    if (
      !verifyDownloadToken(token, String(req.params.id), String(req.user._id))
    ) {
      securityEvent("DOWNLOAD_TOKEN_INVALID", {
        userId: String(req.user._id),
        historyId: String(req.params.id),
        ip: req.ip,
        path: req.path,
      });
      return res.status(403).json({
        message:
          "Download link da het han hoac khong hop le. Vui long mo lai tu trang Lich su / Getlink.",
      });
    }

    downloadSlot = acquireDownloadSlot(req);
    if (!downloadSlot.ok) {
      securityEvent("DOWNLOAD_CONCURRENCY_LIMIT", {
        userId: String(req.user._id),
        historyId: String(req.params.id),
        ip: req.ip,
      });
      return res
        .status(downloadSlot.status)
        .json({ message: downloadSlot.message, retryable: true });
    }

    const history = await Getlink.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });
    if (!history) {
      return res.status(404).json({ message: "Download not found" });
    }

    if (!canRedownload(history)) {
      return res.status(403).json({
        message: `Free redownload expired after ${REDOWNLOAD_WINDOW_DAYS || 3} days. Please getlink this model again.`,
        canRedownload: false,
        redownloadExpiresAt: redownloadExpiresAt(history),
      });
    }

    const reservedHistory = await Getlink.findOneAndUpdate(
      {
        _id: history._id,
        userId: req.user._id,
        $or: [
          { redownloadCount: { $exists: false } },
          { redownloadCount: { $lt: redownloadLimit() } },
        ],
      },
      {
        $inc: { redownloadCount: 1 },
        $set: { lastRedownloadAt: new Date() },
      },
      { new: true },
    );

    if (!reservedHistory) {
      return res.status(429).json({
        message: `Download limit reached. You can download this file ${redownloadLimit()} times within ${REDOWNLOAD_WINDOW_DAYS || 3} days.`,
        canRedownload: false,
        redownloadLimit: redownloadLimit(),
      });
    }
    reservedDownloadCount = true;
    reservedHistoryId = String(history._id);

    const { history: activeHistory, upstream } = await openDownloadResponse(
      reservedHistory,
      req,
      controller.signal,
    );

    if (!upstream.ok && upstream.status !== 206) {
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
    reservedDownloadCount = false;
  } catch (error) {
    if (reservedDownloadCount && reservedHistoryId) {
      await Getlink.findByIdAndUpdate(reservedHistoryId, {
        $inc: { redownloadCount: -1 },
      }).catch(() => {});
      reservedDownloadCount = false;
    }
    if (error.name === "AbortError") return;
    await writeSystemLog({
      type: "download",
      level: "error",
      message: error.message,
      userId: req.user?._id,
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

export async function getlinkHistory(req, res, next) {
  try {
    const history = await Getlink.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json({
      history: history.map((item) => publicHistoryItem(req, item)),
    });
  } catch (error) {
    next(error);
  }
}

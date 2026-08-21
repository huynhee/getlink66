import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import MarketplaceModel from "../models/MarketplaceModel.js";
import { normalizeAssetType } from "../data/marketplaceCatalogs.js";
import { openGoogleDriveFileStream } from "./storageProvider.js";

const READY_MIME_TYPE = "image/webp";
const SUPPORTED_SOURCE_EXTENSIONS = new Set(["jpg", "jpeg", "png"]);

function assertSupportedCoverSource(fileName = "") {
  const extension = String(fileName).trim().toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
  if (!SUPPORTED_SOURCE_EXTENSIONS.has(extension)) {
    const error = new Error("Marketplace cover source must be a JPEG or PNG image.");
    error.code = "MARKETPLACE_COVER_FORMAT_UNSUPPORTED";
    throw error;
  }
}

function booleanEnv(name, fallback = false) {
  const value = String(process.env[name] ?? "").trim().toLowerCase();
  if (!value) return fallback;
  return value === "true";
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : fallback));
}

function normalizedPublicBase() {
  const value = String(process.env.MARKETPLACE_COVER_PUBLIC_BASE_URL || "/media/covers").trim();
  return `/${value.replace(/^\/+|\/+$/g, "") || "media/covers"}`;
}

export function marketplaceCoverCacheConfig() {
  return {
    enabled: booleanEnv("MARKETPLACE_COVER_CACHE_ENABLED", false),
    workerEnabled: booleanEnv("MARKETPLACE_COVER_WORKER_ENABLED", false),
    root: path.resolve(
      String(process.env.MARKETPLACE_COVER_CACHE_DIR || path.join(process.cwd(), "data", "marketplace-covers")),
    ),
    publicBaseUrl: normalizedPublicBase(),
    size: Math.round(boundedNumber(process.env.MARKETPLACE_COVER_SIZE, 480, 128, 1024)),
    quality: Math.round(boundedNumber(process.env.MARKETPLACE_COVER_WEBP_QUALITY, 80, 40, 95)),
    concurrency: Math.round(boundedNumber(process.env.MARKETPLACE_COVER_WORKER_CONCURRENCY, 4, 1, 8)),
    maxAttempts: Math.round(boundedNumber(process.env.MARKETPLACE_COVER_WORKER_MAX_ATTEMPTS, 8, 1, 20)),
    retryBaseSeconds: Math.round(boundedNumber(process.env.MARKETPLACE_COVER_RETRY_BASE_SECONDS, 30, 5, 3600)),
  };
}

function assertCacheKey(key) {
  const normalized = String(key || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!/^(model|scene)\/[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9-]+\.webp$/i.test(normalized)) {
    throw new Error("Invalid marketplace cover cache key.");
  }
  return normalized;
}

export function marketplaceCoverCachePath(key) {
  const config = marketplaceCoverCacheConfig();
  const normalized = assertCacheKey(key);
  const target = path.resolve(config.root, ...normalized.split("/"));
  if (!target.startsWith(`${config.root}${path.sep}`)) {
    throw new Error("Marketplace cover cache path escapes the configured root.");
  }
  return target;
}

export function marketplaceCoverSourceFingerprint(image = {}) {
  if (!image?.driveFileId) return "";
  const config = marketplaceCoverCacheConfig();
  return crypto.createHash("sha256").update([
    "cover-cache-v1",
    String(config.size),
    String(config.quality),
    image.driveFileId,
    image.driveVersion || "",
    image.modifiedTime ? new Date(image.modifiedTime).toISOString() : "",
    String(image.size || ""),
    image.fileName || "",
  ].join("|")).digest("hex");
}

function coverCacheKey(model, fingerprint) {
  const id = String(model?._id || "").toLowerCase();
  const shard = id.replace(/[^a-f0-9]/g, "").padEnd(4, "0");
  return [
    normalizeAssetType(model?.assetType),
    shard.slice(0, 2),
    shard.slice(2, 4),
    `${id}-${String(fingerprint).slice(0, 16)}.webp`,
  ].join("/");
}

export function marketplaceCoverCachePublicUrl(model = {}) {
  const config = marketplaceCoverCacheConfig();
  const key = model.coverCache?.status === "ready" ? model.coverCache?.key : "";
  if (!config.enabled || !key) return "";
  const normalized = assertCacheKey(key);
  if (!fs.existsSync(marketplaceCoverCachePath(normalized))) return "";
  return `${config.publicBaseUrl}/${normalized}`;
}

async function removeFile(key) {
  if (!key) return false;
  const filePath = marketplaceCoverCachePath(key);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await fs.promises.rm(filePath, { force: true });
      return true;
    } catch (error) {
      if (!["EBUSY", "EPERM"].includes(error?.code) || attempt === 5) return false;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
  return false;
}

export async function removeMarketplaceCoverCache(model = {}) {
  const key = model.coverCache?.key || "";
  await removeFile(key);
  if (!model?._id) return;
  await MarketplaceModel.findByIdAndUpdate(model._id, {
    $set: {
      coverCache: {
        status: "missing",
        key: "",
        sourceFingerprint: "",
        width: 0,
        height: 0,
        size: 0,
        mimeType: "",
        error: "",
        attempts: 0,
        generatedAt: null,
        nextRetryAt: null,
        lockedAt: null,
      },
    },
  });
}

export async function queueMarketplaceCoverCache(model, sourceImage = null, options = {}) {
  const config = marketplaceCoverCacheConfig();
  if (!model?._id || !config.enabled) return model;
  const image = sourceImage?.driveFileId ? sourceImage : model.coverImage;
  const fingerprint = marketplaceCoverSourceFingerprint(image);
  if (!fingerprint) {
    await removeMarketplaceCoverCache(model);
    return MarketplaceModel.findById(model._id);
  }
  const current = model.coverCache || {};
  if (
    !options.force
    &&
    current.sourceFingerprint === fingerprint
    && ["queued", "processing", "ready"].includes(current.status)
  ) {
    return model;
  }

  const oldKey = current.key || "";
  const updated = await MarketplaceModel.findByIdAndUpdate(model._id, {
    $set: {
      coverCache: {
        status: "queued",
        key: "",
        sourceFingerprint: fingerprint,
        width: 0,
        height: 0,
        size: 0,
        mimeType: "",
        error: "",
        attempts: 0,
        nextRetryAt: new Date(),
        generatedAt: null,
        lockedAt: null,
      },
    },
  }, { new: true });
  await removeFile(oldKey);
  return updated;
}

async function cacheFileInfo(key) {
  const filePath = marketplaceCoverCachePath(key);
  const body = await fs.promises.readFile(filePath);
  const metadata = await sharp(body).metadata();
  return {
    key,
    filePath,
    width: Number(metadata.width || 0),
    height: Number(metadata.height || 0),
    size: body.length,
    mimeType: READY_MIME_TYPE,
  };
}

async function generateCover(model) {
  const config = marketplaceCoverCacheConfig();
  const fingerprint = String(model.coverCache?.sourceFingerprint || "");
  const candidates = [model.coverImage, ...(model.previewImages || [])]
    .filter((image) => image?.driveFileId)
    .filter((image, index, values) => (
      values.findIndex((candidate) => candidate.driveFileId === image.driveFileId) === index
    ));
  if (!fingerprint || !candidates.length) throw new Error("Marketplace cover source is missing.");
  const key = coverCacheKey(model, fingerprint);
  const targetPath = marketplaceCoverCachePath(key);
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o755 });

  try {
    return await cacheFileInfo(key);
  } catch {
    // A missing or invalid output is rebuilt below.
    await removeFile(key);
  }

  let lastError = null;
  for (const [candidateIndex, candidate] of candidates.entries()) {
    const token = `${process.pid}-${candidateIndex}-${crypto.randomBytes(8).toString("hex")}`;
    const outputPath = `${targetPath}.${token}.tmp`;
    try {
      assertSupportedCoverSource(candidate.fileName);
      const source = await openGoogleDriveFileStream(candidate.driveFileId, candidate.fileName || "cover");
      if (source.contentLength > 50 * 1024 * 1024) {
        throw new Error("Marketplace cover source exceeds 50 MB.");
      }
      let receivedBytes = 0;
      const chunks = [];
      for await (const chunk of source.stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        receivedBytes += buffer.length;
        if (receivedBytes > 50 * 1024 * 1024) {
          throw new Error("Marketplace cover source exceeds 50 MB.");
        }
        chunks.push(buffer);
      }
      await sharp(Buffer.concat(chunks, receivedBytes), { failOn: "warning" })
        .rotate()
        .resize(config.size, config.size, {
          fit: "contain",
          withoutEnlargement: false,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .webp({ quality: config.quality, alphaQuality: config.quality, effort: 4 })
        .toFile(outputPath);
      await fs.promises.chmod(outputPath, 0o644);
      await fs.promises.rename(outputPath, targetPath);
      return cacheFileInfo(key);
    } catch (error) {
      lastError = error;
    } finally {
      await fs.promises.rm(outputPath, { force: true }).catch(() => {});
    }
  }
  throw lastError || new Error("No valid JPEG or PNG cover source was found.");
}

function retryAt(attempts) {
  const config = marketplaceCoverCacheConfig();
  const seconds = Math.min(6 * 60 * 60, config.retryBaseSeconds * (2 ** Math.max(0, attempts - 1)));
  return new Date(Date.now() + seconds * 1000);
}

export async function processMarketplaceCoverCacheModel(model) {
  const fingerprint = String(model.coverCache?.sourceFingerprint || "");
  try {
    const output = await generateCover(model);
    const updated = await MarketplaceModel.findOneAndUpdate(
      {
        _id: model._id,
        "coverCache.sourceFingerprint": fingerprint,
        "coverCache.status": "processing",
      },
      {
        $set: {
          "coverCache.status": "ready",
          "coverCache.key": output.key,
          "coverCache.width": output.width,
          "coverCache.height": output.height,
          "coverCache.size": output.size,
          "coverCache.mimeType": output.mimeType,
          "coverCache.generatedAt": new Date(),
          "coverCache.error": "",
          "coverCache.lockedAt": null,
          "coverCache.nextRetryAt": null,
        },
      },
      { new: true },
    );
    if (!updated) await removeFile(output.key);
    return { model: updated, status: updated ? "ready" : "stale" };
  } catch (error) {
    const attempts = Math.max(1, Number(model.coverCache?.attempts || 1));
    await MarketplaceModel.findOneAndUpdate(
      { _id: model._id, "coverCache.sourceFingerprint": fingerprint },
      {
        $set: {
          "coverCache.status": "error",
          "coverCache.error": String(error?.message || "cover_cache_failed").slice(0, 500),
          "coverCache.lockedAt": null,
          "coverCache.nextRetryAt": retryAt(attempts),
        },
      },
    );
    throw error;
  }
}

export async function openMarketplaceCoverCache(model = {}) {
  const key = model.coverCache?.status === "ready" ? model.coverCache?.key : "";
  if (!marketplaceCoverCacheConfig().enabled || !key) return null;
  try {
    const filePath = marketplaceCoverCachePath(key);
    const stats = await fs.promises.stat(filePath);
    return {
      stream: fs.createReadStream(filePath),
      contentLength: Number(stats.size || 0),
      contentType: READY_MIME_TYPE,
      fileName: path.basename(filePath),
    };
  } catch {
    return null;
  }
}

export async function requeueFailedMarketplaceCoverCaches({ assetType = "" } = {}) {
  const query = {
    "coverCache.status": "error",
    "coverCache.sourceFingerprint": { $type: "string", $gt: "" },
    $or: [{ deletionStatus: "active" }, { deletionStatus: { $exists: false } }],
  };
  if (assetType) query.assetType = normalizeAssetType(assetType);
  const result = await MarketplaceModel.updateMany(query, {
    $set: {
      "coverCache.status": "queued",
      "coverCache.error": "",
      "coverCache.attempts": 0,
      "coverCache.nextRetryAt": new Date(),
      "coverCache.lockedAt": null,
    },
  });
  return Number(result.modifiedCount || 0);
}

export async function marketplaceCoverCacheStats() {
  const activeCoverQuery = {
    $and: [
      { "coverImage.driveFileId": { $type: "string", $gt: "" } },
      { $or: [{ deletionStatus: "active" }, { deletionStatus: { $exists: false } }] },
    ],
  };
  const [missing, queued, processing, ready, error] = await Promise.all([
    MarketplaceModel.countDocuments({
      ...activeCoverQuery,
      $or: [{ "coverCache.status": "missing" }, { "coverCache.status": { $exists: false } }],
    }),
    ...["queued", "processing", "ready", "error"]
      .map((status) => MarketplaceModel.countDocuments({
        ...activeCoverQuery,
        "coverCache.status": status,
      })),
  ]);
  let diskBytes = 0;
  if (typeof MarketplaceModel.aggregate === "function") {
    const [total] = await MarketplaceModel.aggregate([
      { $match: { ...activeCoverQuery, "coverCache.status": "ready" } },
      { $group: { _id: null, value: { $sum: "$coverCache.size" } } },
    ]);
    diskBytes = Number(total?.value || 0);
  } else {
    const rows = await MarketplaceModel.find({ "coverCache.status": "ready" }).select("coverCache").lean();
    diskBytes = rows.reduce((sum, row) => sum + Number(row.coverCache?.size || 0), 0);
  }
  return {
    config: {
      enabled: marketplaceCoverCacheConfig().enabled,
      workerEnabled: marketplaceCoverCacheConfig().workerEnabled,
      size: marketplaceCoverCacheConfig().size,
      quality: marketplaceCoverCacheConfig().quality,
      concurrency: marketplaceCoverCacheConfig().concurrency,
    },
    counts: { missing, queued, processing, ready, error },
    diskBytes,
  };
}

export async function verifyMarketplaceCoverCacheFile(model = {}) {
  const key = model.coverCache?.status === "ready" ? model.coverCache?.key : "";
  if (!key) return { ok: false, reason: "not_ready" };
  try {
    const info = await cacheFileInfo(key);
    const expectedSize = marketplaceCoverCacheConfig().size;
    return {
      ok: info.width === expectedSize && info.height === expectedSize && info.size > 0,
      ...info,
    };
  } catch (error) {
    return { ok: false, reason: String(error?.code || error?.message || "missing_file") };
  }
}

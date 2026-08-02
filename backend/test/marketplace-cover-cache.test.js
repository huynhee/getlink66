import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: MarketplaceModel } = await import("../src/models/MarketplaceModel.js");
const {
  marketplaceCoverCachePath,
  marketplaceCoverCacheStats,
  processMarketplaceCoverCacheModel,
  queueMarketplaceCoverCache,
  verifyMarketplaceCoverCacheFile,
} = await import("../src/utils/marketplaceCoverCache.js");
const { listMarketplaceModels } = await import("../src/controllers/marketplaceController.js");

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("cover cache generates a square WebP and public catalog uses its static URL", async () => {
  const previous = Object.fromEntries([
    "MARKETPLACE_COVER_CACHE_ENABLED",
    "MARKETPLACE_COVER_CACHE_DIR",
    "MARKETPLACE_COVER_PUBLIC_BASE_URL",
    "MARKETPLACE_COVER_SIZE",
    "MARKETPLACE_COVER_WEBP_QUALITY",
    "GOOGLE_DRIVE_ACCESS_TOKEN",
    "GOOGLE_DRIVE_BEARER_TOKEN",
    "GOOGLE_DRIVE_REFRESH_TOKEN",
  ].map((name) => [name, process.env[name]]));
  const previousFetch = globalThis.fetch;
  const cacheRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "3dipl-cover-cache-"));
  const sourceImage = await sharp({
    create: {
      width: 320,
      height: 160,
      channels: 4,
      background: { r: 20, g: 150, b: 220, alpha: 1 },
    },
  }).png().toBuffer();

  process.env.MARKETPLACE_COVER_CACHE_ENABLED = "true";
  process.env.MARKETPLACE_COVER_CACHE_DIR = cacheRoot;
  process.env.MARKETPLACE_COVER_PUBLIC_BASE_URL = "/media/covers";
  process.env.MARKETPLACE_COVER_SIZE = "480";
  process.env.MARKETPLACE_COVER_WEBP_QUALITY = "80";
  process.env.GOOGLE_DRIVE_ACCESS_TOKEN = "cover-test-token";
  delete process.env.GOOGLE_DRIVE_BEARER_TOKEN;
  delete process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  globalThis.fetch = async (input) => {
    assert.match(String(input), /files\/cover-cache-drive-id\?alt=media/);
    return new Response(sourceImage, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-length": String(sourceImage.length),
      },
    });
  };

  try {
    let model = await MarketplaceModel.create({
      assetType: "model",
      title: "Cached cover chair",
      slug: `cached-cover-chair-${Math.random().toString(16).slice(2)}`,
      source: {
        provider: "drive",
        modelId: "cover-cache-folder",
        assetId: `cover-cache-${Math.random().toString(16).slice(2)}`,
      },
      coverImage: {
        driveFileId: "cover-cache-drive-id",
        driveVersion: "1",
        modifiedTime: new Date("2026-07-29T00:00:00.000Z"),
        fileName: "cover.png",
        size: sourceImage.length,
      },
      previewImages: [{
        driveFileId: "preview-does-not-become-cover",
        driveVersion: "1",
        fileName: "preview-1.png",
      }],
      metadataStatus: "complete",
      fileStatus: "ready",
      desiredPublished: true,
      isPublished: true,
      deletionStatus: "active",
    });

    model = await queueMarketplaceCoverCache(model, model.coverImage);
    assert.equal(model.coverCache.status, "queued");
    model = await MarketplaceModel.findByIdAndUpdate(model._id, {
      $set: { "coverCache.status": "processing", "coverCache.lockedAt": new Date() },
      $inc: { "coverCache.attempts": 1 },
    }, { new: true });

    const generated = await processMarketplaceCoverCacheModel(model);
    assert.equal(generated.status, "ready");
    const stored = await MarketplaceModel.findById(model._id);
    assert.equal(stored.coverCache.status, "ready");
    assert.equal(stored.coverCache.mimeType, "image/webp");
    assert.equal(stored.coverCache.width, 480);
    assert.equal(stored.coverCache.height, 480);
    assert.ok(stored.coverCache.size > 0);

    const filePath = marketplaceCoverCachePath(stored.coverCache.key);
    assert.equal(fs.existsSync(filePath), true);
    assert.deepEqual(
      await fs.promises.readFile(filePath)
        .then((body) => sharp(body).metadata())
        .then(({ format, width, height }) => ({ format, width, height })),
      { format: "webp", width: 480, height: 480 },
    );
    assert.equal((await verifyMarketplaceCoverCacheFile(stored)).ok, true);
    const stats = await marketplaceCoverCacheStats();
    assert.ok(stats.counts.ready >= 1);
    assert.ok(stats.diskBytes >= stored.coverCache.size);

    let payload;
    await listMarketplaceModels(
      { query: { search: "Cached cover chair" }, marketplaceAssetType: "model" },
      { json(value) { payload = value; return value; } },
      (error) => { throw error; },
    );
    const publicModel = payload.models.find((item) => item._id === model._id);
    assert.match(publicModel.coverImage.url, /^\/media\/covers\/model\//);
    assert.equal(publicModel.coverImage.width, 480);
    assert.equal(publicModel.coverImage.url.includes("drive"), false);
    assert.equal(publicModel.previewImages.length, 1);
    assert.match(publicModel.previewImages[0].url, new RegExp(`/api/marketplace/models/${model._id}/preview/0`));
    assert.equal(JSON.stringify(publicModel.previewImages).includes("driveFileId"), false);

    const sameCover = await queueMarketplaceCoverCache({
      ...stored,
      previewImages: [{ driveFileId: "new-preview-only", driveVersion: "2" }],
    }, stored.coverImage);
    assert.equal(sameCover.coverCache.key, stored.coverCache.key);

    const changedCover = {
      ...stored.coverImage,
      driveVersion: "2",
      modifiedTime: new Date("2026-07-29T01:00:00.000Z"),
    };
    const queued = await queueMarketplaceCoverCache(stored, changedCover);
    assert.equal(queued.coverCache.status, "queued");
    assert.notEqual(queued.coverCache.sourceFingerprint, stored.coverCache.sourceFingerprint);
    assert.equal(fs.existsSync(filePath), false);
  } finally {
    globalThis.fetch = previousFetch;
    await fs.promises.rm(cacheRoot, { recursive: true, force: true });
    Object.entries(previous).forEach(([name, value]) => restoreEnv(name, value));
  }
});

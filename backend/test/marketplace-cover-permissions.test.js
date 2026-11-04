import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();
const { default: MarketplaceModel } = await import("../src/models/MarketplaceModel.js");
const { marketplaceCoverCachePath, processMarketplaceCoverCacheModel, queueMarketplaceCoverCache } =
  await import("../src/utils/marketplaceCoverCache.js");

test("public Model/Scene covers survive umask 077 without opening private directories", { skip: process.platform === "win32" }, async t => {
  const envKeys = ["MARKETPLACE_COVER_CACHE_ENABLED", "MARKETPLACE_COVER_CACHE_DIR",
    "GOOGLE_DRIVE_ACCESS_TOKEN", "GOOGLE_DRIVE_BEARER_TOKEN", "GOOGLE_DRIVE_REFRESH_TOKEN"];
  const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const originalUmask = process.umask(0o077);
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "3dipl-cover-permissions-"));
  const root = path.join(base, "public-covers");
  const privateDirectory = path.join(base, "private-browser-profile");
  const secret = path.join(privateDirectory, "state.json");
  const source = await sharp({ create: { width: 64, height: 32, channels: 3,
    background: { r: 10, g: 130, b: 180 } } }).png().toBuffer();
  let fetches = 0;
  t.mock.method(globalThis, "fetch", async input => {
    assert.match(String(input), /files\/cover-permission-fixture\?alt=media/);
    fetches++;
    return new Response(source, { headers: { "content-type": "image/png", "content-length": String(source.length) } });
  });
  process.env.MARKETPLACE_COVER_CACHE_ENABLED = "true";
  process.env.MARKETPLACE_COVER_CACHE_DIR = root;
  process.env.GOOGLE_DRIVE_ACCESS_TOKEN = "cover-permission-fixture-token";
  delete process.env.GOOGLE_DRIVE_BEARER_TOKEN;
  delete process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  const mode = async value => (await fs.stat(value)).mode & 0o777;
  async function createModel(assetType) {
    let model = await MarketplaceModel.create({ assetType, title: "Cover permission fixture",
      slug: `cover-permission-${assetType}-${Date.now()}`, source: { modelId: "permission-fixture" },
      coverImage: { driveFileId: "cover-permission-fixture", driveVersion: "1", fileName: "cover.png", size: source.length } });
    model = await queueMarketplaceCoverCache(model, model.coverImage);
    return MarketplaceModel.findByIdAndUpdate(model._id, {
      $set: { "coverCache.status": "processing", "coverCache.lockedAt": new Date() },
      $inc: { "coverCache.attempts": 1 },
    }, { new: true });
  }
  try {
    await fs.mkdir(privateDirectory, { mode: 0o700 });
    await fs.writeFile(secret, "fixture", { mode: 0o600 });
    for (const assetType of ["model", "scene"]) {
      const model = await createModel(assetType);
      const first = await processMarketplaceCoverCacheModel(model);
      assert.equal(first.status, "ready");
      const target = marketplaceCoverCachePath(first.model.coverCache.key);
      assert.equal(await mode(target), 0o644);
      let directory = root;
      const directories = [root];
      for (const part of path.relative(root, path.dirname(target)).split(path.sep)) {
        directory = path.join(directory, part);
        directories.push(directory);
      }
      for (const value of directories) assert.equal(await mode(value), 0o755);
      for (const value of directories) await fs.chmod(value, 0o700);
      // Existing restricted shards must be repaired even when the output already exists.
      const reclaimed = await MarketplaceModel.findByIdAndUpdate(model._id,
        { $set: { "coverCache.status": "processing", "coverCache.lockedAt": new Date() } }, { new: true });
      assert.equal((await processMarketplaceCoverCacheModel(reclaimed)).status, "ready");
      for (const value of directories) assert.equal(await mode(value), 0o755);
    }
    assert.equal(fetches, 2);
    assert.equal(await mode(privateDirectory), 0o700);
    assert.equal(await mode(secret), 0o600);
    assert.equal(await mode(base), 0o700);

    const redirectedRoot = path.join(base, "symlink-covers");
    await fs.mkdir(redirectedRoot, { mode: 0o755 });
    await fs.symlink(privateDirectory, path.join(redirectedRoot, "model"), "dir");
    process.env.MARKETPLACE_COVER_CACHE_DIR = redirectedRoot;
    const linked = await createModel("model");
    await assert.rejects(processMarketplaceCoverCacheModel(linked), /cannot be symlinks/);
    assert.equal(fetches, 2);
    assert.equal(await mode(privateDirectory), 0o700);
    assert.equal(await mode(secret), 0o600);
    assert.equal(process.umask(), 0o077);
  } finally {
    process.umask(originalUmask);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(base, { recursive: true, force: true });
  }
});

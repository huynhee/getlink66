import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: MarketplaceModel } = await import("../src/models/MarketplaceModel.js");
const { default: DownloadSession } = await import("../src/models/DownloadSession.js");
const { default: ModelDownload } = await import("../src/models/ModelDownload.js");
const {
  adminListMarketplaceModels,
  adminUpdateMarketplaceModel,
} = await import("../src/controllers/marketplaceAdminController.js");
const { listMarketplaceModels } = await import("../src/controllers/marketplaceController.js");
const {
  permanentlyDeleteMarketplaceAsset,
  trashMarketplaceAsset,
} = await import("../src/utils/marketplaceDeletionService.js");

function readyAsset(values = {}) {
  return MarketplaceModel.create({
    assetType: "model",
    title: "Deletion test model",
    slug: `deletion-test-${Math.random().toString(16).slice(2)}`,
    source: { provider: "drive", modelId: "folder-delete", assetId: "asset-delete", slug: "folder-delete" },
    metadataSourceModelId: "asset-delete",
    driveFolderId: "folder-delete",
    driveFolderName: "asset-delete-model",
    driveFileId: "archive-delete",
    storageProvider: "google_drive",
    coverImage: { driveFileId: "cover-delete", fileName: "cover.jpg" },
    previewImages: [{ driveFileId: "preview-delete", fileName: "preview-1.jpg" }],
    metadataDriveFileId: "metadata-delete",
    metadataStatus: "complete",
    fileStatus: "ready",
    desiredPublished: true,
    isPublished: true,
    deletionStatus: "active",
    restoreDesiredPublished: false,
    downloadCount: 17,
    ...values,
  });
}

function jsonResponse(body, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: body === null ? {} : { "content-type": "application/json" },
  });
}

test("trashing an asset hides it and revokes active sessions without deleting history", async () => {
  const oldFetch = global.fetch;
  const oldWrite = process.env.MARKETPLACE_DRIVE_WRITE_ENABLED;
  const oldToken = process.env.GOOGLE_DRIVE_ACCESS_TOKEN;
  process.env.MARKETPLACE_DRIVE_WRITE_ENABLED = "true";
  process.env.GOOGLE_DRIVE_ACCESS_TOKEN = "test-token";
  global.fetch = async (_url, options = {}) => {
    assert.equal(options.method, "PATCH");
    assert.equal(JSON.parse(options.body).trashed, true);
    return jsonResponse({ id: "folder-delete", name: "folder", trashed: true });
  };
  try {
    const model = await readyAsset();
    const session = await DownloadSession.create({
      assetType: "model",
      modelId: model._id,
      tokenHash: "trash-session",
      status: "active",
      expiresAt: new Date(Date.now() + 60_000),
      purgeAt: new Date(Date.now() + 120_000),
    });
    await ModelDownload.create({ modelId: model._id, sessionId: session._id, status: "downloaded" });

    const trashed = await trashMarketplaceAsset(model);
    const storedSession = await DownloadSession.findById(session._id);

    assert.equal(trashed.deletionStatus, "trashed");
    assert.equal(trashed.isPublished, false);
    assert.equal(trashed.restoreDesiredPublished, true);
    assert.equal(trashed.downloadCount, 17);
    assert.equal(storedSession.status, "revoked");
    assert.equal(await ModelDownload.countDocuments({ modelId: model._id }), 1);
  } finally {
    global.fetch = oldFetch;
    process.env.MARKETPLACE_DRIVE_WRITE_ENABLED = oldWrite;
    process.env.GOOGLE_DRIVE_ACCESS_TOKEN = oldToken;
  }
});

test("admin search includes asset IDs and separates active assets from trash", async () => {
  const active = await readyAsset({
    title: "Searchable chair",
    slug: "searchable-chair",
    driveFolderId: "folder-search-991",
    driveFolderName: "991-searchable-chair",
    source: { provider: "drive", modelId: "folder-search-991", assetId: "asset-search-991" },
  });
  await readyAsset({
    title: "Trashed chair",
    slug: "trashed-chair",
    deletionStatus: "trashed",
    isPublished: false,
    desiredPublished: false,
  });

  let payload;
  await adminListMarketplaceModels(
    { query: { search: "asset-search-991", deleted: "active" }, marketplaceAssetType: "model" },
    { json(value) { payload = value; return value; } },
    (error) => { throw error; },
  );
  assert.equal(payload.models.length, 1);
  assert.equal(payload.models[0]._id, active._id);

  await adminListMarketplaceModels(
    { query: { deleted: "trashed" }, marketplaceAssetType: "model" },
    { json(value) { payload = value; return value; } },
    (error) => { throw error; },
  );
  assert.ok(payload.models.length >= 1);
  assert.ok(payload.models.every((model) => model.deletionStatus !== "active"));
});

test("permanent deletion keeps a compact tombstone and download history", async () => {
  const oldFetch = global.fetch;
  const oldWrite = process.env.MARKETPLACE_DRIVE_WRITE_ENABLED;
  const oldToken = process.env.GOOGLE_DRIVE_ACCESS_TOKEN;
  process.env.MARKETPLACE_DRIVE_WRITE_ENABLED = "true";
  process.env.GOOGLE_DRIVE_ACCESS_TOKEN = "test-token";
  global.fetch = async (_url, options = {}) => {
    assert.equal(options.method, "DELETE");
    return jsonResponse(null, 204);
  };
  try {
    const model = await readyAsset({ deletionStatus: "trashed", isPublished: false, desiredPublished: false });
    await ModelDownload.create({ modelId: model._id, status: "downloaded" });
    const purged = await permanentlyDeleteMarketplaceAsset(model);

    assert.equal(purged.deletionStatus, "purged");
    assert.equal(purged.title, model.title);
    assert.equal(purged.slug, model.slug);
    assert.equal(purged.downloadCount, 17);
    assert.equal(purged.driveFolderId, undefined);
    assert.equal(purged.previewImages.length, 0);
    assert.equal(purged.source.provider, "drive");
    assert.equal(purged.source.assetId, model.source.assetId);
    assert.equal(await ModelDownload.countDocuments({ modelId: model._id }), 1);
  } finally {
    global.fetch = oldFetch;
    process.env.MARKETPLACE_DRIVE_WRITE_ENABLED = oldWrite;
    process.env.GOOGLE_DRIVE_ACCESS_TOKEN = oldToken;
  }
});

test("trashed assets stay private and cannot be edited outside the restore flow", async () => {
  const model = await readyAsset({
    title: "Private trashed catalog asset",
    slug: "private-trashed-catalog-asset",
    deletionStatus: "trashed",
    isPublished: true,
  });
  let payload;
  await listMarketplaceModels(
    { query: { search: "Private trashed catalog asset" }, marketplaceAssetType: "model" },
    { json(value) { payload = value; return value; } },
    (error) => { throw error; },
  );
  assert.equal(payload.models.some((item) => item._id === model._id), false);

  let updateError;
  await adminUpdateMarketplaceModel(
    { params: { id: model._id }, body: { desiredPublished: true }, marketplaceAssetType: "model" },
    { status() { return this; }, json() { return this; } },
    (error) => { updateError = error; },
  );
  assert.equal(updateError?.code, "MARKETPLACE_ASSET_DELETED");
  assert.equal(updateError?.status, 409);
});

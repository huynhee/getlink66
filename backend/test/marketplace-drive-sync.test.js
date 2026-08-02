import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

process.env.GOOGLE_DRIVE_ACCESS_TOKEN = "test-drive-token";
process.env.MARKETPLACE_DRIVE_WRITE_ENABLED = "true";

const { default: MarketplaceCategory } = await import("../src/models/MarketplaceCategory.js");
const { default: MarketplaceDriveChange } = await import("../src/models/MarketplaceDriveChange.js");
const { default: MarketplaceModel } = await import("../src/models/MarketplaceModel.js");
const {
  marketplaceMetadataDocument,
  marketplaceMetadataHash,
  normalizeMarketplaceMetadata,
  serializeMarketplaceMetadata,
} = await import("../src/utils/marketplaceMetadata.js");
const {
  decodeMarketplaceMetadataBuffer,
  syncMarketplaceDriveFolder,
  writeMarketplaceModelMetadata,
} = await import("../src/utils/marketplaceDriveService.js");
const { adminCleanupMarketplaceRaw } = await import("../src/controllers/marketplaceAdminController.js");
const {
  pollMarketplaceDriveChanges,
  processMarketplaceDriveChangeQueue,
} = await import("../src/utils/marketplaceDriveSyncJob.js");
const { listMarketplaceModels } = await import("../src/controllers/marketplaceController.js");

const FOLDER_MIME = "application/vnd.google-apps.folder";
let fixtureSequence = 0;

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function metadataInput(overrides = {}) {
  return {
    sourceModelId: "6373049",
    title: "Outdoor Kitchen 145",
    sourceCategoryId: "category-256",
    accessType: "member",
    renderer: "Corona",
    styles: ["modern"],
    renderers: ["corona"],
    forms: ["rectangle"],
    colors: ["black"],
    materials: ["metal"],
    sha256: "a".repeat(64),
    ...overrides,
  };
}

function createDriveFixture() {
  fixtureSequence += 1;
  const suffix = String(fixtureSequence);
  const rootId = `root-${suffix}`;
  const folderId = `folder-${suffix}`;
  const metadataId = `metadata-${suffix}`;
  const sourceModelId = `6373049${suffix}`;
  const folder = {
    id: folderId,
    name: `${sourceModelId}.fixture-${suffix}`,
    mimeType: FOLDER_MIME,
    modifiedTime: "2026-07-13T00:00:00.000Z",
    version: "1",
    parents: [rootId],
    driveId: `shared-${suffix}`,
    trashed: false,
  };
  const root = {
    id: rootId,
    name: "models",
    mimeType: FOLDER_MIME,
    modifiedTime: "2026-07-13T00:00:00.000Z",
    version: "1",
    parents: [],
    driveId: `shared-${suffix}`,
    trashed: false,
  };
  const { document } = marketplaceMetadataDocument(metadataInput({ sourceModelId }), {
    revision: 1,
    updatedAt: "2026-07-13T00:00:00.000Z",
  });
  const fixture = {
    root,
    folder,
    sourceModelId,
    metadataBuffer: zlib.gzipSync(Buffer.from(serializeMarketplaceMetadata(document))),
    files: [
      {
        id: metadataId,
        name: "metadata.json.gz",
        mimeType: "application/gzip",
        size: "300",
        modifiedTime: "2026-07-13T00:00:00.000Z",
        version: "1",
        parents: [folderId],
        driveId: root.driveId,
        trashed: false,
      },
      {
        id: `archive-${suffix}`,
        name: "model.zip",
        mimeType: "application/zip",
        size: "25000000",
        modifiedTime: "2026-07-13T00:00:00.000Z",
        version: "1",
        parents: [folderId],
        driveId: root.driveId,
        trashed: false,
      },
      {
        id: `cover-${suffix}`,
        name: "cover.jpg",
        mimeType: "image/jpeg",
        size: "120000",
        imageMediaMetadata: { width: 800, height: 800 },
        modifiedTime: "2026-07-13T00:00:00.000Z",
        version: "1",
        parents: [folderId],
        driveId: root.driveId,
        trashed: false,
      },
      {
        id: `preview-${suffix}`,
        name: "preview-01.jpg",
        mimeType: "image/jpeg",
        size: "240000",
        imageMediaMetadata: { width: 1200, height: 1200 },
        modifiedTime: "2026-07-13T00:00:00.000Z",
        version: "1",
        parents: [folderId],
        driveId: root.driveId,
        trashed: false,
      },
    ],
    patchCount: 0,
    failPatch: false,
    changes: [],
    onFolderList: null,
    install() {
      const previousFetch = globalThis.fetch;
      globalThis.fetch = async (input, options = {}) => {
        const url = new URL(String(input));
        const method = String(options.method || "GET").toUpperCase();
        if (url.pathname === "/drive/v3/changes/startPageToken") {
          return jsonResponse({ startPageToken: `start-${suffix}` });
        }
        if (url.pathname === "/drive/v3/changes") {
          return jsonResponse({ newStartPageToken: `next-${suffix}`, changes: fixture.changes });
        }
        if (url.pathname === "/drive/v3/files" && method === "GET") {
          const query = url.searchParams.get("q") || "";
          if (query.includes(`'${folderId}' in parents`)) {
            if (fixture.onFolderList) await fixture.onFolderList();
            return jsonResponse({ files: fixture.files });
          }
          if (query.includes(`'${rootId}' in parents`)) return jsonResponse({ files: [fixture.folder] });
          return jsonResponse({ files: [] });
        }
        if (url.pathname === `/drive/v3/files/${rootId}`) return jsonResponse(fixture.root);
        if (url.pathname === `/drive/v3/files/${folderId}`) return jsonResponse(fixture.folder);
        if (url.pathname === `/drive/v3/files/${metadataId}` && url.searchParams.get("alt") === "media") {
          return new Response(fixture.metadataBuffer, { status: 200, headers: { "content-type": "application/gzip" } });
        }
        const driveFile = fixture.files.find((file) => url.pathname === `/drive/v3/files/${file.id}`);
        if (driveFile) return jsonResponse(driveFile);
        if (url.pathname === `/upload/drive/v3/files/${metadataId}` && method === "PATCH") {
          fixture.patchCount += 1;
          if (fixture.failPatch) return jsonResponse({ error: { message: "simulated Drive failure" } }, 500);
          fixture.metadataBuffer = Buffer.from(options.body);
          const file = fixture.files.find((item) => item.id === metadataId);
          file.version = String(Number(file.version) + 1);
          file.modifiedTime = new Date().toISOString();
          file.size = String(fixture.metadataBuffer.length);
          return jsonResponse(file);
        }
        return jsonResponse({ error: { message: `Unhandled test URL ${method} ${url.pathname}` } }, 404);
      };
      return () => { globalThis.fetch = previousFetch; };
    },
    setMetadata(overrides = {}) {
      const currentFile = fixture.files.find((item) => item.id === metadataId);
      const { document: nextDocument } = marketplaceMetadataDocument(metadataInput({ sourceModelId, ...overrides }), {
        revision: Number(overrides.revision || 2),
        updatedAt: new Date().toISOString(),
      });
      fixture.metadataBuffer = zlib.gzipSync(Buffer.from(serializeMarketplaceMetadata(nextDocument)));
      currentFile.version = String(Number(currentFile.version) + 1);
      currentFile.modifiedTime = new Date().toISOString();
      currentFile.size = String(fixture.metadataBuffer.length);
    },
  };
  return fixture;
}

async function createLeafCategory(suffix = "") {
  return MarketplaceCategory.create({
    sourceProvider: "catalog",
    sourceCategoryId: `category-256${suffix}`,
    title: "Bếp ngoài trời",
    titleEn: "Outdoor kitchen",
    slug: `outdoor-kitchen${suffix}`,
    isActive: true,
  });
}

await createLeafCategory();

test("metadata V2 rejects values outside the controlled vocabulary", () => {
  const { metadata, errors } = normalizeMarketplaceMetadata(metadataInput({ forms: ["rectangle", "made-up-shape"] }));
  assert.deepEqual(metadata.forms, ["rectangle"]);
  assert.ok(errors.some((item) => item.field === "form" && item.code === "unknown_value"));
});

test("compressed metadata is rejected before it can expand beyond the limit", () => {
  const compressed = zlib.gzipSync(Buffer.alloc(256 * 1024 + 2, "a"));
  assert.throws(
    () => decodeMarketplaceMetadataBuffer(compressed, { compressed: true }),
    (error) => error?.status === 413 && error?.code === "MARKETPLACE_METADATA_TOO_LARGE",
  );
  assert.throws(
    () => decodeMarketplaceMetadataBuffer(Buffer.from("not-gzip"), { compressed: true }),
    (error) => error?.status === 400 && error?.code === "MARKETPLACE_METADATA_INVALID_GZIP",
  );
});

test("empty optional facets remain publishable and are excluded by facet filters", async () => {
  const fixture = createDriveFixture();
  fixture.setMetadata({
    renderer: "",
    styles: [],
    renderers: [],
    forms: [],
    colors: [],
    materials: [],
  });
  const restoreFetch = fixture.install();
  try {
    const result = await syncMarketplaceDriveFolder({ driveFolderId: fixture.folder.id });
    assert.equal(result.model.isPublished, true);
    assert.equal(result.model.metadataStatus, "complete");
    assert.deepEqual(result.model.publicationBlockers, []);
    assert.deepEqual(result.model.styles, []);
    assert.deepEqual(result.model.renderers, []);
    assert.deepEqual(result.model.forms, []);
    assert.deepEqual(result.model.colors, []);
    assert.deepEqual(result.model.materials, []);

    let unfilteredPayload;
    let filteredPayload;
    await listMarketplaceModels(
      { query: {} },
      { json(value) { unfilteredPayload = value; return value; } },
      (error) => { throw error; },
    );
    await listMarketplaceModels(
      { query: { style: "modern" } },
      { json(value) { filteredPayload = value; return value; } },
      (error) => { throw error; },
    );
    assert.ok(unfilteredPayload.models.some((model) => String(model._id) === String(result.model._id)));
    assert.equal(filteredPayload.models.some((model) => String(model._id) === String(result.model._id)), false);
  } finally {
    restoreFetch();
  }
});

test("Mongo cleanup removes only stale optional blockers and republishes intended assets", async () => {
  const model = await MarketplaceModel.create({
    assetType: "model",
    title: "Legacy sparse model",
    slug: `legacy-sparse-${fixtureSequence += 1}`,
    categorySourceId: "category-256",
    accessType: "free",
    styles: [],
    renderers: [],
    forms: [],
    colors: [],
    materials: [],
    metadataStatus: "incomplete",
    metadataMissingFields: ["style", "render", "form", "color", "material"],
    publicationBlockers: ["styles", "renderers", "forms", "colors", "materials"],
    desiredPublished: true,
    isPublished: false,
    fileStatus: "ready",
    storageProvider: "google_drive",
    driveFileId: "legacy-sparse-archive",
  });
  let payload;
  await adminCleanupMarketplaceRaw(
    {},
    { json(value) { payload = value; return value; } },
    (error) => { throw error; },
  );
  const updated = await MarketplaceModel.findById(model._id).lean();
  assert.ok(payload.normalizedMetadata >= 1);
  assert.equal(updated.metadataStatus, "complete");
  assert.deepEqual(updated.metadataMissingFields, []);
  assert.deepEqual(updated.publicationBlockers, []);
  assert.equal(updated.isPublished, true);
});

test("single-folder sync preserves public state and only removes missing previews", async () => {
  const fixture = createDriveFixture();
  const restoreFetch = fixture.install();
  try {
    const created = await syncMarketplaceDriveFolder({ driveFolderId: fixture.folder.id });
    assert.equal(created.action, "created");
    assert.equal(created.model.isPublished, true);
    assert.equal(created.model.previewImages.length, 1);

    await MarketplaceModel.findByIdAndUpdate(created.model._id, {
      $set: { slug: "admin-kept-slug", desiredPublished: false, isPublished: false },
    });
    fixture.setMetadata({ title: "Changed on Drive" });
    fixture.files = fixture.files.filter((file) => !file.name.startsWith("preview-"));
    const updated = await syncMarketplaceDriveFolder({ driveFolderId: fixture.folder.id });
    assert.equal(updated.model.title, "Changed on Drive");
    assert.equal(updated.model.slug, "admin-kept-slug");
    assert.equal(updated.model.desiredPublished, false);
    assert.equal(updated.model.isPublished, false);
    assert.equal(updated.model.previewImages.length, 0);
    assert.equal(updated.model.publicationBlockers.length, 0);
    assert.equal(await MarketplaceModel.countDocuments({ driveFolderId: fixture.folder.id }), 1);
  } finally {
    restoreFetch();
  }
});

test("new model public slug comes from the source slug in the Drive folder name", async () => {
  const fixture = createDriveFixture();
  fixture.folder.name = `${fixture.sourceModelId}-decorative-tea-ceremony-set`;
  const restoreFetch = fixture.install();
  try {
    const created = await syncMarketplaceDriveFolder({ driveFolderId: fixture.folder.id });
    assert.equal(created.model.slug, "decorative-tea-ceremony-set");
  } finally {
    restoreFetch();
  }
});

test("duplicate folder source slugs use the existing unique slug fallback", async () => {
  const firstFixture = createDriveFixture();
  firstFixture.folder.name = `${firstFixture.sourceModelId}-shared-drive-slug`;
  const restoreFirst = firstFixture.install();
  let first;
  try {
    first = await syncMarketplaceDriveFolder({ driveFolderId: firstFixture.folder.id });
  } finally {
    restoreFirst();
  }

  const secondFixture = createDriveFixture();
  secondFixture.folder.name = `${secondFixture.sourceModelId}-shared-drive-slug`;
  const restoreSecond = secondFixture.install();
  try {
    const second = await syncMarketplaceDriveFolder({ driveFolderId: secondFixture.folder.id });
    assert.equal(first.model.slug, "shared-drive-slug");
    assert.notEqual(second.model.slug, first.model.slug);
    assert.match(second.model.slug, /^shared-drive-slug-/);
  } finally {
    restoreSecond();
  }
});

test("missing archive blocks publication and restoring it honors desiredPublished", async () => {
  const fixture = createDriveFixture();
  const restoreFetch = fixture.install();
  try {
    const created = await syncMarketplaceDriveFolder({ driveFolderId: fixture.folder.id });
    const archive = fixture.files.find((file) => file.name === "model.zip");
    fixture.files = fixture.files.filter((file) => file !== archive);
    const missing = await syncMarketplaceDriveFolder({ driveFolderId: fixture.folder.id });
    assert.equal(missing.model.fileStatus, "missing");
    assert.equal(missing.model.isPublished, false);
    assert.ok(missing.model.publicationBlockers.includes("archive"));

    fixture.files.push(archive);
    const restored = await syncMarketplaceDriveFolder({ driveFolderId: fixture.folder.id });
    assert.equal(restored.model.desiredPublished, true);
    assert.equal(restored.model.isPublished, true);
    assert.equal(restored.model.fileStatus, "ready");
    assert.equal(created.model.slug, restored.model.slug);
  } finally {
    restoreFetch();
  }
});

test("Scene uses cover.jpg for catalog and preview-01 as the first detail image", async () => {
  const fixture = createDriveFixture();
  const restoreFetch = fixture.install();
  try {
    await MarketplaceCategory.create({
      assetType: "scene",
      sourceProvider: "internal",
      sourceCategoryId: "scene-living-room",
      title: "Phòng khách",
      titleEn: "Living Room",
      slug: "scene-living-room",
      isActive: true,
    });
    fixture.files.find((file) => file.name === "model.zip").name = "scene.zip";
    fixture.setMetadata({
      assetType: "scene",
      sourceAssetId: `scene-${fixture.sourceModelId}`,
      sourceCategoryId: "scene-living-room",
      renderer: "Corona",
      renderers: ["corona"],
      styles: ["modern"],
      sha256: "b".repeat(64),
    });
    fixture.files.push({
      id: `unrelated-scene-image-${fixture.sourceModelId}`,
      name: "reference.jpg",
      mimeType: "image/jpeg",
      size: "180000",
      imageMediaMetadata: { width: 1600, height: 900 },
      modifiedTime: "2026-07-13T00:00:00.000Z",
      version: "1",
      parents: [fixture.folder.id],
      driveId: fixture.folder.driveId,
      trashed: false,
    });

    const ready = await syncMarketplaceDriveFolder({ driveFolderId: fixture.folder.id, assetType: "scene" });
    assert.equal(ready.model.isPublished, true);
    assert.equal(ready.model.coverImage.fileName, "cover.jpg");
    assert.equal(ready.model.previewImages.length, 1);
    assert.equal(ready.model.previewImages[0].fileName, "preview-01.jpg");

    fixture.files = fixture.files.filter((file) => file.name !== "preview-01.jpg");
    const missingPreview = await syncMarketplaceDriveFolder({ driveFolderId: fixture.folder.id, assetType: "scene" });
    assert.equal(missingPreview.model.isPublished, false);
    assert.ok(missingPreview.model.publicationBlockers.includes("preview"));

    fixture.files.push({
      id: `legacy-preview-${fixture.sourceModelId}`,
      name: "preview-1.jpg",
      mimeType: "image/jpeg",
      size: "240000",
      imageMediaMetadata: { width: 1200, height: 900 },
      modifiedTime: "2026-07-13T00:00:00.000Z",
      version: "1",
      parents: [fixture.folder.id],
      driveId: fixture.folder.driveId,
      trashed: false,
    });

    fixture.files = fixture.files.filter((file) => file.name !== "cover.jpg");
    const legacy = await syncMarketplaceDriveFolder({ driveFolderId: fixture.folder.id, assetType: "scene" });
    assert.equal(legacy.model.coverImage.fileName, "preview-1.jpg");
  } finally {
    restoreFetch();
  }
});

test("Drive sync rejects unsupported image formats as marketplace covers", async () => {
  const fixture = createDriveFixture();
  fixture.files = fixture.files
    .filter((file) => !String(file.mimeType || "").startsWith("image/"))
    .concat({
      id: `cover-svg-${fixtureSequence}`,
      name: "cover.svg",
      mimeType: "image/svg+xml",
      size: "1200",
      modifiedTime: "2026-07-13T00:00:00.000Z",
      version: "1",
      parents: [fixture.folder.id],
      driveId: fixture.root.driveId,
      trashed: false,
    });
  const restoreFetch = fixture.install();
  try {
    const result = await syncMarketplaceDriveFolder({ driveFolderId: fixture.folder.id });
    assert.equal(result.model.isPublished, false);
    assert.equal(result.model.coverImage?.driveFileId || "", "");
    assert.ok(result.model.publicationBlockers.includes("cover"));
  } finally {
    restoreFetch();
  }
});

test("Drive write failure leaves Mongo unchanged and stale versions return conflict", async () => {
  const fixture = createDriveFixture();
  const restoreFetch = fixture.install();
  try {
    const created = await syncMarketplaceDriveFolder({ driveFolderId: fixture.folder.id });
    const before = await MarketplaceModel.findById(created.model._id).lean();
    fixture.failPatch = true;
    await assert.rejects(
      writeMarketplaceModelMetadata(before, metadataInput({ title: "Must not persist" }), {
        metadataHash: before.metadataHash,
        driveVersion: before.metadataDriveVersion,
      }),
      /Google Drive file update failed/,
    );
    const afterFailure = await MarketplaceModel.findById(created.model._id).lean();
    assert.equal(afterFailure.title, before.title);

    fixture.failPatch = false;
    fixture.setMetadata({ title: "External edit" });
    const patchCountBeforeConflict = fixture.patchCount;
    await assert.rejects(
      writeMarketplaceModelMetadata(before, metadataInput({ title: "Admin edit" }), {
        metadataHash: before.metadataHash,
        driveVersion: before.metadataDriveVersion,
      }),
      (error) => error?.code === "METADATA_CONFLICT" && error?.diff?.some((item) => item.field === "title"),
    );
    assert.equal(fixture.patchCount, patchCountBeforeConflict);
  } finally {
    restoreFetch();
  }
});

test("successful metadata save verifies Drive then updates Mongo revision", async () => {
  const fixture = createDriveFixture();
  const restoreFetch = fixture.install();
  try {
    const created = await syncMarketplaceDriveFolder({ driveFolderId: fixture.folder.id });
    const result = await writeMarketplaceModelMetadata(created.model, metadataInput({ title: "Saved through Drive" }), {
      metadataHash: created.model.metadataHash,
      driveVersion: created.model.metadataDriveVersion,
    });
    assert.equal(fixture.patchCount, 1);
    assert.equal(result.model.title, "Saved through Drive");
    assert.equal(result.model.metadataRevision, 2);
    assert.equal(result.model.metadataHash, marketplaceMetadataHash(result.metadata));
  } finally {
    restoreFetch();
  }
});

test("Changes API coalesces multiple file changes into one folder queue item", async () => {
  const fixture = createDriveFixture();
  const restoreFetch = fixture.install();
  try {
    const created = await syncMarketplaceDriveFolder({ driveFolderId: fixture.folder.id });
    process.env.MARKETPLACE_DRIVE_ROOT_FOLDER_ID = fixture.root.id;
    fixture.changes = [
      { fileId: fixture.files[0].id, time: new Date().toISOString(), changeType: "file", file: fixture.files[0] },
      { fileId: fixture.files[2].id, time: new Date().toISOString(), changeType: "file", file: fixture.files[2] },
    ];
    const result = await pollMarketplaceDriveChanges({ rootId: fixture.root.id });
    const queued = await MarketplaceDriveChange.findOne({
      rootFolderId: fixture.root.id,
      driveFolderId: created.model.driveFolderId,
    }).lean();
    assert.equal(result.changes, 2);
    assert.equal(await MarketplaceDriveChange.countDocuments({ rootFolderId: fixture.root.id }), 1);
    assert.equal(queued.changedFileIds.length, 2);
    assert.equal(queued.generation, 2);
    assert.equal(queued.attempts, 0);
  } finally {
    restoreFetch();
  }
});

test("a change arriving during folder sync remains queued for the next pass", async () => {
  const fixture = createDriveFixture();
  const restoreFetch = fixture.install();
  try {
    const created = await syncMarketplaceDriveFolder({ driveFolderId: fixture.folder.id });
    await MarketplaceDriveChange.create({
      rootFolderId: fixture.root.id,
      driveFolderId: created.model.driveFolderId,
      generation: 1,
      attempts: 0,
      status: "pending",
      nextAttemptAt: new Date(),
    });
    let injected = false;
    fixture.onFolderList = async () => {
      if (injected) return;
      injected = true;
      await MarketplaceDriveChange.findOneAndUpdate(
        { rootFolderId: fixture.root.id, driveFolderId: created.model.driveFolderId },
        {
          $set: { status: "pending", attempts: 0, nextAttemptAt: new Date(), lockedAt: null },
          $inc: { generation: 1 },
        },
      );
    };
    const result = await processMarketplaceDriveChangeQueue({ rootId: fixture.root.id, limit: 1 });
    const queued = await MarketplaceDriveChange.findOne({
      rootFolderId: fixture.root.id,
      driveFolderId: created.model.driveFolderId,
    }).lean();
    assert.equal(result.results[0].status, "rescheduled");
    assert.equal(queued.status, "pending");
    assert.equal(queued.generation, 2);
  } finally {
    restoreFetch();
  }
});

test("public marketplace response never exposes Drive or sync internals", async () => {
  const fixture = createDriveFixture();
  const restoreFetch = fixture.install();
  try {
    await syncMarketplaceDriveFolder({ driveFolderId: fixture.folder.id });
    let payload;
    await listMarketplaceModels(
      { query: {} },
      { json(value) { payload = value; return value; } },
      (error) => { throw error; },
    );
    const serialized = JSON.stringify(payload);
    assert.equal(serialized.includes("driveFileId"), false);
    assert.equal(serialized.includes("driveFolderId"), false);
    assert.equal(serialized.includes("metadataHash"), false);
    assert.equal(serialized.includes("metadataDriveVersion"), false);
    assert.ok(payload.models[0].coverImage.url.startsWith("/api/marketplace/models/"));
  } finally {
    restoreFetch();
  }
});

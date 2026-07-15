import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: Getlink } = await import("../src/models/Getlink.js");
const { default: HistoryArchiveManifest } = await import("../src/models/HistoryArchiveManifest.js");
const { default: ModelDownload } = await import("../src/models/ModelDownload.js");
const { default: SiteSetting } = await import("../src/models/SiteSetting.js");
const { archiveHistoryBatch, runHistoryRetentionCycle } = await import("../src/utils/historyRetentionService.js");

const DAY_MS = 24 * 60 * 60 * 1000;

function dateBefore(now, days) {
  return new Date(now.getTime() - days * DAY_MS);
}

async function createDownload(downloadedAt, suffix) {
  return ModelDownload.create({
    assetType: "model",
    modelId: `retention-model-${suffix}`,
    sessionId: `retention-session-${suffix}`,
    userId: `retention-user-${suffix}`,
    status: "downloaded",
    downloadedAt,
    quotaCharged: true,
    quotaCost: 1,
  });
}

test("archive failure keeps marketplace history online", async () => {
  const record = await createDownload(new Date("2024-01-01T00:00:00.000Z"), "failure");
  await assert.rejects(
    archiveHistoryBatch({
      kind: "marketplace-download",
      records: [record],
      archiveWriter: async () => { throw new Error("simulated Drive outage"); },
    }),
    /simulated Drive outage/,
  );

  assert.ok(await ModelDownload.findById(record._id));
  const manifest = await HistoryArchiveManifest.findOne({ kind: "marketplace-download", status: "error" });
  assert.ok(manifest);
});

test("verified archive deletes only its exact Mongo records", async () => {
  const record = await createDownload(new Date("2024-02-01T00:00:00.000Z"), "success");
  const result = await archiveHistoryBatch({
    kind: "marketplace-download",
    records: [record],
    archiveWriter: async ({ checksum }) => ({
      archiveDriveFileId: `archive-${checksum.slice(0, 8)}`,
      driveManifestFileId: `manifest-${checksum.slice(0, 8)}`,
      archiveFileName: "verified.jsonl.gz",
    }),
  });

  assert.equal(result.deleted, 1);
  assert.equal(await ModelDownload.findById(record._id), null);
  assert.equal(result.manifest.status, "deleted");
});

test("retention zero keeps history while detail cleanup and configured boundaries work", async () => {
  const now = new Date("2026-07-15T03:00:00.000Z");
  await SiteSetting.findOneAndUpdate(
    { key: "homepage" },
    {
      $set: {
        key: "homepage",
        getlinkRedownloadDays: 3,
        getlinkDetailRetentionDaysAfterExpiry: 0,
        getlinkHistoryRetentionDaysAfterExpiry: 0,
        marketplaceDownloadHistoryRetentionDays: 0,
      },
    },
    { upsert: true, new: true },
  );
  const foreverGetlink = await Getlink.create({
    userId: "retention-user-forever",
    productId: "retention-product-forever",
    fileUrl: "https://files.example/forever",
    sourceUrl: "https://source.example/forever",
  });
  await Getlink.findByIdAndUpdate(foreverGetlink._id, { $set: { createdAt: dateBefore(now, 1000) } });
  const foreverDownload = await createDownload(dateBefore(now, 1000), "forever");

  await runHistoryRetentionCycle({
    now,
    archiveWriter: async () => { throw new Error("archive must not run when retention is zero"); },
  });
  assert.ok(await Getlink.findById(foreverGetlink._id));
  assert.ok(await ModelDownload.findById(foreverDownload._id));

  await SiteSetting.findOneAndUpdate(
    { key: "homepage" },
    {
      $set: {
        getlinkDetailRetentionDaysAfterExpiry: 1,
        getlinkHistoryRetentionDaysAfterExpiry: 730,
        marketplaceDownloadHistoryRetentionDays: 365,
      },
    },
    { new: true },
  );
  const compactGetlink = await Getlink.create({
    userId: "retention-user-compact",
    productId: "retention-product-compact",
    fileUrl: "https://files.example/compact",
    sourceUrl: "https://source.example/compact",
    imageUrl: "https://images.example/compact.jpg",
  });
  await Getlink.findByIdAndUpdate(compactGetlink._id, { $set: { createdAt: dateBefore(now, 5) } });
  const boundaryGetlink = await Getlink.create({
    userId: "retention-user-boundary",
    productId: "retention-product-boundary",
    fileUrl: "https://files.example/boundary",
  });
  await Getlink.findByIdAndUpdate(boundaryGetlink._id, { $set: { createdAt: dateBefore(now, 733) } });
  const expiredDownload = await createDownload(dateBefore(now, 366), "expired");
  const boundaryDownload = await createDownload(dateBefore(now, 365), "boundary");
  const currentDownload = await createDownload(dateBefore(now, 364), "current");
  const writer = async ({ checksum }) => ({
    archiveDriveFileId: `archive-${checksum.slice(0, 8)}`,
    driveManifestFileId: `manifest-${checksum.slice(0, 8)}`,
    archiveFileName: "retention.jsonl.gz",
  });

  const cycle = await runHistoryRetentionCycle({ now, archiveWriter: writer });
  const compacted = await Getlink.findById(compactGetlink._id);

  assert.ok(cycle.detailsPurged >= 1);
  assert.equal(compacted.fileUrl, undefined);
  assert.equal(compacted.sourceUrl, undefined);
  assert.equal(compacted.imageUrl, undefined);
  assert.ok(compacted.detailsPurgedAt);
  assert.equal(await Getlink.findById(boundaryGetlink._id), null);
  assert.equal(await ModelDownload.findById(expiredDownload._id), null);
  assert.equal(await ModelDownload.findById(boundaryDownload._id), null);
  assert.ok(await ModelDownload.findById(currentDownload._id));
});

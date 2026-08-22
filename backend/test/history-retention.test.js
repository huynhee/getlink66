import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: Getlink } = await import("../src/models/Getlink.js");
const { default: HistoryArchiveManifest } = await import("../src/models/HistoryArchiveManifest.js");
const { default: AuditLog } = await import("../src/models/AuditLog.js");
const { default: MarketplaceReport } = await import("../src/models/MarketplaceReport.js");
const { default: ModelDownload } = await import("../src/models/ModelDownload.js");
const { default: CreditLedgerEntry } = await import("../src/models/CreditLedgerEntry.js");
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

test("marketplace Credit ledger is archived with marketplace retention", async () => {
  const now = new Date("2026-07-15T03:00:00.000Z");
  await SiteSetting.findOneAndUpdate(
    { key: "homepage" },
    {
      $set: {
        key: "homepage",
        getlinkDetailRetentionDaysAfterExpiry: 0,
        getlinkHistoryRetentionDaysAfterExpiry: 0,
        marketplaceDownloadHistoryRetentionDays: 365,
        marketplaceReportHistoryRetentionDays: 0,
        auditLogHistoryRetentionDays: 0,
      },
    },
    { upsert: true, new: true },
  );
  const ledger = await CreditLedgerEntry.create({
    userId: "retention-credit-user",
    direction: "debit",
    amount: 5,
    balanceBefore: 20,
    balanceAfter: 15,
    type: "marketplace_download",
    asset: { assetType: "model", assetId: "retention-credit-model", title: "Archived model" },
    idempotencyKey: "retention-credit-entry",
  });
  await CreditLedgerEntry.findByIdAndUpdate(ledger._id, { $set: { createdAt: dateBefore(now, 366) } });
  const writer = async ({ kind, checksum }) => ({
    archiveDriveFileId: `${kind}-${checksum.slice(0, 8)}`,
    driveManifestFileId: `${kind}-manifest-${checksum.slice(0, 8)}`,
    archiveFileName: `${kind}.jsonl.gz`,
  });

  const result = await runHistoryRetentionCycle({ now, archiveWriter: writer });
  assert.equal(result.marketplaceCredit.deleted, 1);
  assert.equal(await CreditLedgerEntry.findById(ledger._id), null);
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
        marketplaceReportHistoryRetentionDays: 0,
        auditLogHistoryRetentionDays: 0,
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
        marketplaceReportHistoryRetentionDays: 365,
        auditLogHistoryRetentionDays: 365,
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

test("closed reports and audit logs are archived before deletion", async () => {
  const now = new Date("2026-07-29T03:00:00.000Z");
  await SiteSetting.findOneAndUpdate(
    { key: "homepage" },
    {
      $set: {
        key: "homepage",
        getlinkDetailRetentionDaysAfterExpiry: 0,
        getlinkHistoryRetentionDaysAfterExpiry: 0,
        marketplaceDownloadHistoryRetentionDays: 0,
        marketplaceReportHistoryRetentionDays: 365,
        auditLogHistoryRetentionDays: 365,
      },
    },
    { upsert: true, new: true },
  );
  const report = await MarketplaceReport.create({
    modelId: "retention-report-model",
    assetType: "model",
    userId: "retention-report-user",
    reason: "archive_corrupt",
    status: "resolved",
    isActive: false,
    resolvedAt: dateBefore(now, 366),
  });
  await MarketplaceReport.findByIdAndUpdate(report._id, {
    $set: { resolvedAt: dateBefore(now, 366), updatedAt: dateBefore(now, 366) },
  });
  const audit = await AuditLog.create({
    actor: "retention-admin",
    action: "RETENTION_TEST",
  });
  await AuditLog.findByIdAndUpdate(audit._id, { $set: { createdAt: dateBefore(now, 366) } });
  const uploadedKinds = [];
  const writer = async ({ kind, checksum }) => {
    uploadedKinds.push(kind);
    return {
      archiveDriveFileId: `${kind}-${checksum.slice(0, 8)}`,
      driveManifestFileId: `${kind}-manifest-${checksum.slice(0, 8)}`,
      archiveFileName: `${kind}.jsonl.gz`,
    };
  };

  const result = await runHistoryRetentionCycle({ now, archiveWriter: writer });

  assert.equal(result.reports.deleted, 1);
  assert.equal(result.audit.deleted, 1);
  assert.equal(await MarketplaceReport.findById(report._id), null);
  assert.equal(await AuditLog.findById(audit._id), null);
  assert.deepEqual(uploadedKinds.sort(), ["audit-log", "marketplace-report"]);
});

test("Drive failure keeps closed reports and audit logs online", async () => {
  const now = new Date("2026-07-29T03:00:00.000Z");
  const report = await MarketplaceReport.create({
    modelId: "retention-failure-model",
    assetType: "scene",
    userId: "retention-failure-user",
    reason: "missing_files",
    status: "dismissed",
    isActive: false,
    resolvedAt: dateBefore(now, 500),
  });
  await MarketplaceReport.findByIdAndUpdate(report._id, {
    $set: { resolvedAt: dateBefore(now, 500) },
  });

  await assert.rejects(
    runHistoryRetentionCycle({
      now,
      archiveWriter: async () => { throw new Error("Drive offline"); },
    }),
    /Drive offline/,
  );
  assert.ok(await MarketplaceReport.findById(report._id));
});

import crypto from "node:crypto";
import zlib from "node:zlib";
import Getlink from "../models/Getlink.js";
import HistoryArchiveManifest from "../models/HistoryArchiveManifest.js";
import ModelDownload from "../models/ModelDownload.js";
import SiteSetting from "../models/SiteSetting.js";
import {
  createGoogleDriveFile,
  ensureGoogleDriveFolderPath,
  readGoogleDriveFileBuffer,
} from "./storageProvider.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function hash(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function plainRecord(record) {
  const value = record?.toObject ? record.toObject() : { ...record };
  delete value.__v;
  return value;
}

function periodFor(kind, record, redownloadDays = 3) {
  const sourceDate = kind === "getlink"
    ? new Date(new Date(record.createdAt).getTime() + redownloadDays * DAY_MS)
    : new Date(record.downloadedAt || record.createdAt);
  return Number.isNaN(sourceDate.getTime()) ? "unknown" : sourceDate.toISOString().slice(0, 7);
}

async function defaultArchiveWriter({ kind, period, batchKey, gzip, checksum, recordCount }) {
  const rootFolderId = String(process.env.HISTORY_ARCHIVE_DRIVE_FOLDER_ID || "").trim();
  if (!rootFolderId) throw new Error("HISTORY_ARCHIVE_DRIVE_FOLDER_ID is not configured.");
  const folderId = await ensureGoogleDriveFolderPath(rootFolderId, [kind, period]);
  const stem = `${kind}-${period}-${batchKey.slice(0, 16)}`;
  const archiveFileName = `${stem}.jsonl.gz`;
  const archiveFile = await createGoogleDriveFile({
    folderId,
    fileName: archiveFileName,
    content: gzip,
    contentType: "application/gzip",
  });
  const downloaded = await readGoogleDriveFileBuffer(archiveFile.id, {
    fileName: archiveFileName,
    maxBytes: Math.min(20 * 1024 * 1024, gzip.length + 1024),
  });
  if (hash(downloaded) !== checksum) {
    const error = new Error("History archive checksum verification failed.");
    error.code = "HISTORY_ARCHIVE_CHECKSUM_MISMATCH";
    throw error;
  }
  const driveManifest = {
    schemaVersion: 1,
    kind,
    period,
    batchKey,
    recordCount,
    archiveFileId: archiveFile.id,
    archiveFileName,
    archiveSha256: checksum,
    archiveSize: gzip.length,
    verifiedAt: new Date().toISOString(),
  };
  const manifestFile = await createGoogleDriveFile({
    folderId,
    fileName: `${stem}.manifest.json`,
    content: Buffer.from(`${JSON.stringify(driveManifest, null, 2)}\n`),
    contentType: "application/json",
  });
  return {
    archiveDriveFileId: archiveFile.id,
    driveManifestFileId: manifestFile.id,
    archiveFileName,
  };
}

async function deleteArchivedRecords(kind, recordIds) {
  if (!recordIds.length) return 0;
  const model = kind === "getlink" ? Getlink : ModelDownload;
  const result = await model.deleteMany({ _id: { $in: recordIds } });
  return Number(result.deletedCount || 0);
}

export async function archiveHistoryBatch({ kind, records, redownloadDays = 3, archiveWriter = defaultArchiveWriter } = {}) {
  if (!records?.length) return { archived: 0, deleted: 0, skipped: true };
  const plain = records.map(plainRecord);
  const period = periodFor(kind, plain[0], redownloadDays);
  const samePeriod = plain.filter((record) => periodFor(kind, record, redownloadDays) === period);
  const recordIds = samePeriod.map((record) => String(record._id));
  const body = Buffer.from(`${samePeriod.map((record) => JSON.stringify(record)).join("\n")}\n`);
  const gzip = zlib.gzipSync(body, { level: 9 });
  if (gzip.length > 19 * 1024 * 1024) throw new Error("History archive batch exceeds the 19 MB safety limit.");
  const checksum = hash(gzip);
  const batchKey = hash(`${kind}|${recordIds.join(",")}|${checksum}`);
  let manifest = await HistoryArchiveManifest.findOneAndUpdate(
    { batchKey },
    {
      $setOnInsert: {
        kind,
        batchKey,
        period,
        recordIds,
        recordCount: recordIds.length,
        status: "pending",
      },
    },
    { upsert: true, new: true },
  );
  if (manifest.status === "deleted") {
    return { archived: recordIds.length, deleted: recordIds.length, resumed: true, manifest };
  }
  if (manifest.status !== "verified") {
    try {
      const upload = await archiveWriter({
        kind,
        period,
        batchKey,
        gzip,
        checksum,
        recordCount: recordIds.length,
      });
      manifest = await HistoryArchiveManifest.findByIdAndUpdate(
        manifest._id,
        {
          $set: {
            ...upload,
            archiveSha256: checksum,
            archiveSize: gzip.length,
            status: "verified",
            verifiedAt: new Date(),
            lastError: "",
          },
        },
        { new: true },
      );
    } catch (error) {
      await HistoryArchiveManifest.findByIdAndUpdate(manifest._id, {
        $set: { status: "error", lastError: String(error.message || "archive_failed").slice(0, 500) },
      }).catch(() => {});
      throw error;
    }
  }
  try {
    const deleted = await deleteArchivedRecords(kind, recordIds);
    manifest = await HistoryArchiveManifest.findByIdAndUpdate(
      manifest._id,
      { $set: { status: "deleted", deletedAt: new Date(), lastError: "" } },
      { new: true },
    );
    return { archived: recordIds.length, deleted, manifest };
  } catch (error) {
    await HistoryArchiveManifest.findByIdAndUpdate(manifest._id, {
      $set: { status: "verified", lastError: String(error.message || "delete_failed").slice(0, 500) },
    }).catch(() => {});
    throw error;
  }
}

async function archiveHistoryRecords({ kind, records, redownloadDays = 3, archiveWriter } = {}) {
  if (!records?.length) return { archived: 0, deleted: 0, skipped: true, batches: 0 };
  const groups = new Map();
  records.forEach((record) => {
    const period = periodFor(kind, record, redownloadDays);
    if (!groups.has(period)) groups.set(period, []);
    groups.get(period).push(record);
  });
  const result = { archived: 0, deleted: 0, skipped: false, batches: 0 };
  for (const group of groups.values()) {
    const batch = await archiveHistoryBatch({ kind, records: group, redownloadDays, archiveWriter });
    result.archived += Number(batch.archived || 0);
    result.deleted += Number(batch.deleted || 0);
    result.batches += 1;
  }
  return result;
}

export async function resumeVerifiedHistoryArchives(limit = 20) {
  const manifests = await HistoryArchiveManifest.find({ status: "verified" })
    .sort({ verifiedAt: 1 })
    .limit(Math.max(1, Math.min(100, Number(limit || 20))));
  let deleted = 0;
  for (const manifest of manifests) {
    deleted += await deleteArchivedRecords(manifest.kind, manifest.recordIds || []);
    await HistoryArchiveManifest.findByIdAndUpdate(manifest._id, {
      $set: { status: "deleted", deletedAt: new Date(), lastError: "" },
    });
  }
  return { manifests: manifests.length, deleted };
}

async function retentionSettings() {
  const settings = await SiteSetting.findOne({ key: "homepage" }).lean();
  return {
    redownloadDays: Math.max(1, Number(settings?.getlinkRedownloadDays || 3)),
    detailDays: Math.max(0, Number(settings?.getlinkDetailRetentionDaysAfterExpiry ?? 1)),
    getlinkDays: Math.max(0, Number(settings?.getlinkHistoryRetentionDaysAfterExpiry ?? 730)),
    marketplaceDays: Math.max(0, Number(settings?.marketplaceDownloadHistoryRetentionDays ?? 365)),
  };
}

async function purgeGetlinkDetails({ now, settings, batchSize }) {
  if (settings.detailDays === 0) return 0;
  const cutoff = new Date(now.getTime() - (settings.redownloadDays + settings.detailDays) * DAY_MS);
  const records = await Getlink.find({
    createdAt: { $lte: cutoff },
    $or: [{ detailsPurgedAt: null }, { detailsPurgedAt: { $exists: false } }],
  })
    .sort({ createdAt: 1 })
    .limit(batchSize)
    .select("_id");
  await Promise.all(records.map((record) => Getlink.findByIdAndUpdate(record._id, {
    $unset: { fileUrl: "", sourceUrl: "", resolvedSourceUrl: "", imageUrl: "" },
    $set: { detailsPurgedAt: now },
  })));
  return records.length;
}

export async function runHistoryRetentionCycle({ now = new Date(), batchSize = 500, archiveWriter } = {}) {
  const safeBatchSize = Math.max(1, Math.min(2000, Number(batchSize || 500)));
  const settings = await retentionSettings();
  const resumed = await resumeVerifiedHistoryArchives();
  const detailsPurged = await purgeGetlinkDetails({ now, settings, batchSize: safeBatchSize });
  let getlink = { archived: 0, deleted: 0, skipped: true };
  if (settings.getlinkDays > 0) {
    const cutoff = new Date(now.getTime() - (settings.redownloadDays + settings.getlinkDays) * DAY_MS);
    const records = await Getlink.find({ createdAt: { $lte: cutoff } })
      .sort({ createdAt: 1 })
      .limit(safeBatchSize)
      .lean();
    if (records.length) {
      getlink = await archiveHistoryRecords({ kind: "getlink", records, redownloadDays: settings.redownloadDays, archiveWriter });
    }
  }
  let marketplace = { archived: 0, deleted: 0, skipped: true };
  if (settings.marketplaceDays > 0) {
    const cutoff = new Date(now.getTime() - settings.marketplaceDays * DAY_MS);
    const records = await ModelDownload.find({ status: "downloaded", downloadedAt: { $lte: cutoff } })
      .sort({ downloadedAt: 1 })
      .limit(safeBatchSize)
      .lean();
    if (records.length) {
      marketplace = await archiveHistoryRecords({ kind: "marketplace-download", records, archiveWriter });
    }
  }
  return { settings, resumed, detailsPurged, getlink, marketplace };
}

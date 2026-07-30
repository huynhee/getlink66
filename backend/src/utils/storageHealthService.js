import fs from "node:fs";
import path from "node:path";
import BackupRun from "../models/BackupRun.js";
import HistoryArchiveManifest from "../models/HistoryArchiveManifest.js";
import MarketplaceDriveChange from "../models/MarketplaceDriveChange.js";
import MarketplaceDriveSyncState from "../models/MarketplaceDriveSyncState.js";
import {
  coreDbConnection,
  databaseHealth,
  marketplaceDbConnection,
} from "../config/db.js";
import {
  getGoogleDriveAuthStatus,
  getGoogleDriveFileMetadata,
} from "./storageProvider.js";
import { marketplaceCoverCacheStats } from "./marketplaceCoverCache.js";

const HOUR_MS = 60 * 60 * 1000;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

async function databaseSnapshot(connection, limitBytes = 0) {
  if (!connection?.db || connection.readyState !== 1) {
    return { connected: false, error: "disconnected" };
  }
  try {
    const [stats, hello] = await Promise.all([
      connection.db.command({ dbStats: 1, scale: 1 }),
      connection.db.admin().command({ hello: 1 }),
    ]);
    const storageBytes = finiteNumber(stats.storageSize);
    return {
      connected: true,
      database: connection.name || "",
      dataBytes: finiteNumber(stats.dataSize),
      storageBytes,
      indexBytes: finiteNumber(stats.indexSize),
      collections: finiteNumber(stats.collections),
      objects: finiteNumber(stats.objects),
      limitBytes,
      usagePercent: limitBytes > 0 ? Math.round((storageBytes / limitBytes) * 10_000) / 100 : null,
      replicaSet: hello.setName || "",
      topology: hello.msg === "isdbgrid" ? "sharded" : hello.setName ? "replica_set" : "standalone",
    };
  } catch (error) {
    return { connected: true, error: String(error.message || error).slice(0, 300) };
  }
}

async function diskSnapshot() {
  const target = path.resolve(process.env.VPS_DISK_PATH || process.env.BACKUP_WORK_DIR || process.cwd());
  try {
    const stats = await fs.promises.statfs(target);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    const availableBytes = Number(stats.bavail) * Number(stats.bsize);
    const usedBytes = Math.max(0, totalBytes - availableBytes);
    return {
      path: target,
      totalBytes,
      usedBytes,
      availableBytes,
      usagePercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 10_000) / 100 : 0,
    };
  } catch (error) {
    return { path: target, error: String(error.message || error).slice(0, 300) };
  }
}

function runSummary(run) {
  if (!run) return null;
  const verifiedAt = run.verifiedAt || run.completedAt || run.createdAt;
  return {
    id: String(run._id),
    kind: run.kind,
    status: run.status,
    verifiedAt,
    ageHours: verifiedAt ? Math.round(((Date.now() - new Date(verifiedAt).getTime()) / HOUR_MS) * 10) / 10 : null,
    encryptedBytes: finiteNumber(run.encryptedBytes),
    encryptedSha256: run.encryptedSha256 || "",
    artifactFileName: run.artifactFileName || "",
    error: run.error || "",
  };
}

async function backupSnapshot() {
  const [core, marketplace, restoreDrill, latestFailure] = await Promise.all([
    BackupRun.findOne({ kind: "core", status: "verified" }).sort({ verifiedAt: -1 }).lean(),
    BackupRun.findOne({ kind: "marketplace", status: "verified" }).sort({ verifiedAt: -1 }).lean(),
    BackupRun.findOne({ kind: "restore_drill", status: "verified" }).sort({ verifiedAt: -1 }).lean(),
    BackupRun.findOne({ status: { $in: ["failed", "verification_failed"] } }).sort({ completedAt: -1 }).lean(),
  ]);
  const growth = {};
  for (const kind of ["core", "marketplace"]) {
    const rows = await BackupRun.find({ kind, status: "verified" })
      .sort({ verifiedAt: -1 })
      .limit(31)
      .select("verifiedAt encryptedBytes")
      .lean();
    const latest = rows[0];
    const atLeastDaysAgo = (days) => rows.find((row) =>
      new Date(latest?.verifiedAt || 0) - new Date(row.verifiedAt || 0) >= days * 24 * HOUR_MS,
    );
    const percent = (older) => {
      if (!latest || !older || !Number(older.encryptedBytes)) return null;
      return Math.round(((Number(latest.encryptedBytes) - Number(older.encryptedBytes))
        / Number(older.encryptedBytes)) * 10_000) / 100;
    };
    growth[kind] = {
      sevenDayPercent: percent(atLeastDaysAgo(7)),
      thirtyDayPercent: percent(atLeastDaysAgo(30)),
    };
  }
  return {
    core: runSummary(core),
    marketplace: runSummary(marketplace),
    restoreDrill: runSummary(restoreDrill),
    latestFailure: runSummary(latestFailure),
    growth,
  };
}

async function driveSnapshot({ verify = true } = {}) {
  const auth = getGoogleDriveAuthStatus();
  const folders = {
    backup: String(process.env.DATABASE_BACKUP_DRIVE_FOLDER_ID || "").trim(),
    history: String(process.env.HISTORY_ARCHIVE_DRIVE_FOLDER_ID || "").trim(),
  };
  if (!verify || auth.mode === "missing") {
    return { auth, foldersConfigured: Boolean(folders.backup && folders.history), verified: false };
  }
  const checks = await Promise.all(Object.entries(folders).map(async ([key, fileId]) => {
    if (!fileId) return [key, { ok: false, error: "missing_folder_id" }];
    try {
      const metadata = await getGoogleDriveFileMetadata(fileId, {
        fields: "id,name,mimeType,trashed,capabilities(canAddChildren)",
      });
      return [key, {
        ok: !metadata.trashed && metadata.capabilities?.canAddChildren !== false,
        name: metadata.name || "",
        canWrite: metadata.capabilities?.canAddChildren !== false,
      }];
    } catch (error) {
      return [key, { ok: false, error: String(error.message || error).slice(0, 300) }];
    }
  }));
  return {
    auth,
    foldersConfigured: Boolean(folders.backup && folders.history),
    verified: true,
    folders: Object.fromEntries(checks),
  };
}

function thresholdAlert(alerts, code, label, percent) {
  if (!Number.isFinite(percent) || percent < 70) return;
  const severity = percent >= 95 ? "critical" : percent >= 85 ? "error" : "warning";
  alerts.push({ code, severity, message: `${label} is ${percent}% full.` });
}

export function evaluateStorageAlerts(snapshot, now = new Date()) {
  const alerts = [];
  if (!snapshot.databases?.core?.connected) {
    alerts.push({ code: "CORE_DB_DOWN", severity: "critical", message: "Atlas Core is disconnected." });
  }
  if (!snapshot.databases?.marketplace?.connected) {
    alerts.push({ code: "MARKETPLACE_DB_DOWN", severity: "critical", message: "Marketplace VPS database is disconnected." });
  }
  if (snapshot.databases?.routing?.expectedDistinct && !snapshot.databases.routing.distinct) {
    alerts.push({ code: "DATABASES_NOT_SPLIT", severity: "critical", message: "Core and marketplace databases are not distinct." });
  }
  if (
    process.env.MONGO_MARKETPLACE_TRANSACTIONS_REQUIRED === "true"
    && snapshot.databases?.marketplace?.topology === "standalone"
  ) {
    alerts.push({ code: "MARKETPLACE_REPLICA_SET_DOWN", severity: "critical", message: "Marketplace MongoDB is not a replica set." });
  }
  thresholdAlert(alerts, "ATLAS_CAPACITY", "Atlas Core", snapshot.databases?.core?.usagePercent);
  thresholdAlert(alerts, "VPS_DISK_CAPACITY", "VPS disk", snapshot.disk?.usagePercent);
  for (const kind of ["core", "marketplace"]) {
    const backup = snapshot.backups?.[kind];
    if (!backup || backup.status !== "verified" || Number(backup.ageHours) > 26) {
      alerts.push({
        code: `BACKUP_STALE_${kind.toUpperCase()}`,
        severity: "critical",
        message: `${kind} backup is missing or older than 26 hours.`,
      });
    }
  }
  if (snapshot.backups?.latestFailure) {
    const failure = snapshot.backups.latestFailure;
    const latestVerified = failure.kind === "restore_drill"
      ? snapshot.backups?.restoreDrill
      : snapshot.backups?.[failure.kind];
    if (!latestVerified || new Date(failure.verifiedAt || 0) >= new Date(latestVerified.verifiedAt || 0)) {
      alerts.push({
        code: "BACKUP_FAILED",
        severity: "critical",
        message: `${failure.kind} backup or verification failed: ${failure.error || "unknown error"}`,
      });
    }
  }
  if (snapshot.drive?.auth?.mode === "missing"
    || Object.values(snapshot.drive?.folders || {}).some((item) => !item.ok)) {
    alerts.push({ code: "DRIVE_UNAVAILABLE", severity: "critical", message: "Google Drive backup/archive storage is unavailable." });
  }
  if (finiteNumber(snapshot.workers?.driveFailed) > 0) {
    alerts.push({ code: "DRIVE_CHANGE_FAILED", severity: "error", message: `${snapshot.workers.driveFailed} Drive changes failed.` });
  }
  if (finiteNumber(snapshot.workers?.archiveErrors) > 0) {
    alerts.push({ code: "HISTORY_ARCHIVE_ERROR", severity: "error", message: `${snapshot.workers.archiveErrors} history archive batches failed.` });
  }
  if (finiteNumber(snapshot.coverCache?.counts?.error) > 0) {
    alerts.push({
      code: "COVER_CACHE_FAILED",
      severity: "warning",
      message: `${snapshot.coverCache.counts.error} cover cache jobs failed.`,
    });
  }
  if (snapshot.workers?.queryError) {
    alerts.push({
      code: "STORAGE_MONITOR_QUERY_ERROR",
      severity: "error",
      message: `Storage monitor queries failed: ${snapshot.workers.queryError}`,
    });
  }
  if (snapshot.workers?.lastDrivePollAt) {
    const ageMs = now - new Date(snapshot.workers.lastDrivePollAt);
    if (ageMs > 15 * 60 * 1000 && process.env.MARKETPLACE_DRIVE_CHANGES_ENABLED === "true") {
      alerts.push({ code: "DRIVE_WORKER_STALE", severity: "error", message: "Drive Changes worker has not polled for 15 minutes." });
    }
  }
  return alerts;
}

export async function buildStorageHealthSnapshot({ verifyDrive = true } = {}) {
  const health = databaseHealth();
  const atlasLimit = finiteNumber(process.env.ATLAS_CORE_STORAGE_LIMIT_BYTES, 500 * 1024 * 1024);
  const safe = async (operation, fallback) => {
    try {
      return await operation();
    } catch (error) {
      return {
        ...fallback,
        error: String(error.message || error).slice(0, 300),
      };
    }
  };
  const [core, marketplace, disk, backups, drive, coverCache, pending, processing, failed, archiveErrors, states] = await Promise.all([
    databaseSnapshot(coreDbConnection(), atlasLimit),
    databaseSnapshot(marketplaceDbConnection()),
    diskSnapshot(),
    safe(() => backupSnapshot(), {}),
    safe(() => driveSnapshot({ verify: verifyDrive }), {
      auth: { mode: "missing" },
      foldersConfigured: false,
      verified: false,
    }),
    safe(() => marketplaceCoverCacheStats(), {
      config: { enabled: false, workerEnabled: false },
      counts: {},
      diskBytes: 0,
    }),
    safe(() => MarketplaceDriveChange.countDocuments({ status: "pending" }), { value: null }),
    safe(() => MarketplaceDriveChange.countDocuments({ status: "processing" }), { value: null }),
    safe(() => MarketplaceDriveChange.countDocuments({ status: "failed" }), { value: null }),
    safe(() => HistoryArchiveManifest.countDocuments({ status: "error" }), { value: null }),
    safe(
      () => MarketplaceDriveSyncState.find().select("lastChangesPollAt status lastChangesError").lean(),
      { value: [] },
    ),
  ]);
  const countValue = (value) => (typeof value === "number" ? value : value?.value);
  const stateRows = Array.isArray(states) ? states : states.value || [];
  const lastDrivePollAt = stateRows
    .map((state) => state.lastChangesPollAt)
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a))[0] || null;
  const snapshot = {
    checkedAt: new Date(),
    databases: {
      core,
      marketplace,
      routing: {
        target: String(process.env.MARKETPLACE_DB_TARGET || "").toLowerCase() || "core",
        usesCore: health.marketplaceUsesCore,
        distinct: health.marketplaceDistinct,
        expectedDistinct: String(process.env.MARKETPLACE_DB_TARGET || "").toLowerCase() === "vps",
      },
    },
    disk,
    backups,
    drive,
    coverCache,
    workers: {
      drivePending: countValue(pending),
      driveProcessing: countValue(processing),
      driveFailed: countValue(failed),
      archiveErrors: countValue(archiveErrors),
      lastDrivePollAt,
      queryError: [pending, processing, failed, archiveErrors, states]
        .map((value) => value?.error)
        .filter(Boolean)
        .join("; "),
    },
  };
  snapshot.alerts = evaluateStorageAlerts(snapshot);
  snapshot.ok = snapshot.alerts.every((alert) => !["critical", "error"].includes(alert.severity));
  return snapshot;
}

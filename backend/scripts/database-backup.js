import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import BackupRun from "../src/models/BackupRun.js";
import {
  backupRetentionSelection,
  databaseNameFromUri,
  runCommand,
  sha256File,
  writeJsonFile,
} from "../src/utils/databaseBackupService.js";
import {
  createGoogleDriveFile,
  createGoogleDriveFileFromPath,
  deleteGoogleDriveFile,
  downloadGoogleDriveFileToPath,
  ensureGoogleDriveFolderPath,
  readGoogleDriveFileBuffer,
} from "../src/utils/storageProvider.js";
import { sendTelegramNotification } from "../src/utils/telegramNotifier.js";

const args = new Set(process.argv.slice(2));
const verifyOnly = args.has("--verify");
const requested = process.argv.find((value) => value.startsWith("--database="))?.split("=")[1] || "all";
const coreUri = String(process.env.MONGO_CORE_URI || process.env.MONGO_URI || "").trim();
const marketplaceUri = String(process.env.MONGO_MARKETPLACE_URI || "").trim();
const backupRoot = String(process.env.DATABASE_BACKUP_DRIVE_FOLDER_ID || "").trim();
const ageRecipient = String(process.env.BACKUP_AGE_RECIPIENT || "").trim();

function backupKinds() {
  if (requested === "all") return ["core", "marketplace"];
  if (["core", "marketplace"].includes(requested)) return [requested];
  throw new Error("--database must be core, marketplace or all.");
}

function uriFor(kind) {
  const uri = kind === "core" ? coreUri : marketplaceUri;
  if (!uri) throw new Error(`${kind === "core" ? "MONGO_CORE_URI" : "MONGO_MARKETPLACE_URI"} is required.`);
  return uri;
}

async function inventory(uri) {
  const connection = mongoose.createConnection(uri, {
    serverSelectionTimeoutMS: 30_000,
    connectTimeoutMS: 10_000,
  });
  await connection.asPromise();
  try {
    const rows = await connection.db.listCollections({}, { nameOnly: true }).toArray();
    const collections = {};
    let indexCount = 0;
    for (const row of rows) {
      const collection = connection.db.collection(row.name);
      const [count, indexes] = await Promise.all([
        collection.estimatedDocumentCount(),
        collection.indexes(),
      ]);
      collections[row.name] = { count, indexCount: indexes.length };
      indexCount += indexes.length;
    }
    return {
      databaseName: connection.name || databaseNameFromUri(uri),
      collectionCount: rows.length,
      indexCount,
      collections,
    };
  } finally {
    await connection.close();
  }
}

async function connectCoreLog() {
  if (!coreUri) throw new Error("MONGO_CORE_URI or MONGO_URI is required for BackupRun records.");
  if (mongoose.connection.readyState !== 1) await mongoose.connect(coreUri);
}

async function verifyArtifact(run, tempDir) {
  if (!run?.artifactDriveFileId || !run?.encryptedSha256) {
    throw new Error(`Backup ${run?._id || "unknown"} is missing artifact verification data.`);
  }
  const target = path.join(tempDir, run.artifactFileName || `${run.kind}.archive.gz.age`);
  await downloadGoogleDriveFileToPath(run.artifactDriveFileId, target);
  const checksum = await sha256File(target);
  if (checksum !== run.encryptedSha256) {
    const error = new Error(`Backup checksum mismatch for ${run.kind}.`);
    error.code = "BACKUP_CHECKSUM_MISMATCH";
    throw error;
  }
  return { target, checksum, size: fs.statSync(target).size };
}

async function verifyLatest(kind, tempDir) {
  const run = await BackupRun.findOne({ kind, status: "verified" }).sort({ verifiedAt: -1 }).lean();
  if (!run) throw new Error(`No verified ${kind} backup is available.`);
  try {
    const verified = await verifyArtifact(run, tempDir);
    await BackupRun.findByIdAndUpdate(run._id, {
      $set: {
        lastVerifiedAt: new Date(),
        completedAt: new Date(),
        error: "",
        "metadata.lastVerificationSource": "backup:verify",
      },
    });
    return { run, ...verified };
  } catch (error) {
    await BackupRun.findByIdAndUpdate(run._id, {
      $set: {
        status: "verification_failed",
        completedAt: new Date(),
        error: String(error.message || error).slice(0, 1000),
        "metadata.lastVerificationSource": "backup:verify",
      },
    }).catch(() => {});
    throw error;
  }
}

async function pruneOldBackups(kind) {
  const records = await BackupRun.find({ kind, status: "verified" })
    .sort({ verifiedAt: -1 })
    .limit(1000)
    .lean();
  const { prune } = backupRetentionSelection(records);
  for (const run of prune) {
    try {
      if (run.artifactDriveFileId) await deleteGoogleDriveFile(run.artifactDriveFileId);
      if (run.manifestDriveFileId) await deleteGoogleDriveFile(run.manifestDriveFileId);
      await BackupRun.findByIdAndUpdate(run._id, {
        $set: { status: "pruned", prunedAt: new Date(), error: "" },
      });
    } catch (error) {
      await BackupRun.findByIdAndUpdate(run._id, {
        $set: { error: `Prune failed: ${String(error.message || error).slice(0, 500)}` },
      }).catch(() => {});
    }
  }
  return prune.length;
}

async function backupDatabase(kind, tempDir) {
  const uri = uriFor(kind);
  const startedAt = new Date();
  const run = await BackupRun.create({
    kind,
    status: "running",
    databaseName: databaseNameFromUri(uri),
    schemaVersion: String(process.env.DATABASE_SCHEMA_VERSION || "1"),
    startedAt,
  });
  try {
    const source = path.join(tempDir, `${kind}.archive.gz`);
    const encrypted = `${source}.age`;
    const stamp = startedAt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const artifactFileName = `3dipl-${kind}-${stamp}.archive.gz.age`;
    const manifestFileName = `3dipl-${kind}-${stamp}.manifest.json`;
    const [databaseInventory, mongodumpVersion, ageVersion] = await Promise.all([
      inventory(uri),
      runCommand("mongodump", ["--version"]),
      runCommand("age", ["--version"]),
    ]);
    await runCommand("mongodump", [`--uri=${uri}`, `--archive=${source}`, "--gzip"]);
    const sourceSha256 = await sha256File(source);
    await runCommand("age", ["-r", ageRecipient, "-o", encrypted, source]);
    const encryptedSha256 = await sha256File(encrypted);
    const folderId = await ensureGoogleDriveFolderPath(backupRoot, [
      "database",
      kind,
      String(startedAt.getUTCFullYear()),
      String(startedAt.getUTCMonth() + 1).padStart(2, "0"),
    ]);
    const artifact = await createGoogleDriveFileFromPath({
      folderId,
      fileName: artifactFileName,
      filePath: encrypted,
      contentType: "application/octet-stream",
    });
    await BackupRun.findByIdAndUpdate(run._id, {
      $set: {
        status: "uploaded",
        artifactFileName,
        artifactDriveFileId: artifact.id,
        sourceSha256,
        encryptedSha256,
        sourceBytes: fs.statSync(source).size,
        encryptedBytes: fs.statSync(encrypted).size,
        collectionCount: databaseInventory.collectionCount,
        indexCount: databaseInventory.indexCount,
        uploadedAt: new Date(),
      },
    });
    const downloadedPath = path.join(tempDir, `${kind}.verify.archive.gz.age`);
    await downloadGoogleDriveFileToPath(artifact.id, downloadedPath);
    const uploadedSha256 = await sha256File(downloadedPath);
    if (uploadedSha256 !== encryptedSha256) {
      const error = new Error("Uploaded database backup checksum verification failed.");
      error.code = "BACKUP_CHECKSUM_MISMATCH";
      throw error;
    }
    const manifest = {
      schemaVersion: 1,
      databaseSchemaVersion: String(process.env.DATABASE_SCHEMA_VERSION || "1"),
      consistencyMode: "logical_dump",
      kind,
      databaseName: databaseInventory.databaseName,
      createdAt: startedAt.toISOString(),
      artifactFileName,
      artifactDriveFileId: artifact.id,
      sourceSha256,
      encryptedSha256,
      sourceBytes: fs.statSync(source).size,
      encryptedBytes: fs.statSync(encrypted).size,
      collectionCount: databaseInventory.collectionCount,
      indexCount: databaseInventory.indexCount,
      collections: databaseInventory.collections,
      tools: {
        mongodump: mongodumpVersion.stdout.split(/\r?\n/)[0] || "unknown",
        age: ageVersion.stdout.split(/\r?\n/)[0] || ageVersion.stderr.split(/\r?\n/)[0] || "unknown",
      },
      verifiedAt: new Date().toISOString(),
    };
    const manifestPath = path.join(tempDir, manifestFileName);
    await writeJsonFile(manifestPath, manifest);
    const manifestContent = await fs.promises.readFile(manifestPath);
    const manifestDrive = await createGoogleDriveFile({
      folderId,
      fileName: manifestFileName,
      content: manifestContent,
      contentType: "application/json",
    });
    const downloadedManifest = await readGoogleDriveFileBuffer(manifestDrive.id, {
      fileName: manifestFileName,
      maxBytes: 2 * 1024 * 1024,
    });
    if (!downloadedManifest.equals(manifestContent)) {
      throw new Error("Uploaded backup manifest verification failed.");
    }
    const completed = await BackupRun.findByIdAndUpdate(run._id, {
      $set: {
        status: "verified",
        manifestDriveFileId: manifestDrive.id,
        verifiedAt: new Date(),
        completedAt: new Date(),
        error: "",
        metadata: { collections: databaseInventory.collections },
      },
    }, { new: true });
    const pruned = await pruneOldBackups(kind);
    return { run: completed, pruned };
  } catch (error) {
    await BackupRun.findByIdAndUpdate(run._id, {
      $set: {
        status: "failed",
        completedAt: new Date(),
        error: String(error.message || error).slice(0, 1000),
      },
    }).catch(() => {});
    throw error;
  }
}

async function main() {
  if (!backupRoot) throw new Error("DATABASE_BACKUP_DRIVE_FOLDER_ID is required.");
  if (!verifyOnly && !ageRecipient) throw new Error("BACKUP_AGE_RECIPIENT is required.");
  await connectCoreLog();
  const base = path.resolve(process.env.BACKUP_WORK_DIR || os.tmpdir());
  await fs.promises.mkdir(base, { recursive: true });
  const tempDir = await fs.promises.mkdtemp(path.join(base, "3dipl-backup-"));
  try {
    const results = [];
    for (const kind of backupKinds()) {
      results.push(verifyOnly
        ? await verifyLatest(kind, tempDir)
        : await backupDatabase(kind, tempDir));
    }
    console.log(JSON.stringify({
      ok: true,
      operation: verifyOnly ? "verify" : "backup",
      results: results.map(({ run, pruned = 0, size = run?.encryptedBytes }) => ({
        kind: run.kind,
        status: "verified",
        verifiedAt: run.verifiedAt,
        size,
        pruned,
      })),
    }, null, 2));
  } finally {
    await mongoose.disconnect().catch(() => {});
    const resolvedBase = path.resolve(base);
    const resolvedTemp = path.resolve(tempDir);
    if (resolvedTemp.startsWith(`${resolvedBase}${path.sep}`)) {
      await fs.promises.rm(resolvedTemp, { recursive: true, force: true });
    }
  }
}

main().catch(async (error) => {
  console.error(`Database ${verifyOnly ? "verification" : "backup"} failed: ${error.message}`);
  await sendTelegramNotification(
    `3DIPL database ${verifyOnly ? "verification" : "backup"} failed\n${String(error.message || error).slice(0, 500)}`,
  ).catch(() => {});
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});

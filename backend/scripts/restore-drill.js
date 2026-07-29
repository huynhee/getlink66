import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import BackupRun from "../src/models/BackupRun.js";
import {
  assertIsolatedRestoreTarget,
  databaseNameFromUri,
  restoreNamespaceArguments,
  runCommand,
  sha256File,
} from "../src/utils/databaseBackupService.js";
import { downloadGoogleDriveFileToPath } from "../src/utils/storageProvider.js";
import { sendTelegramNotification } from "../src/utils/telegramNotifier.js";

const requested = process.argv.find((value) => value.startsWith("--database="))?.split("=")[1] || "all";
const sourceCoreUri = String(process.env.MONGO_CORE_URI || process.env.MONGO_URI || "").trim();
const sourceMarketplaceUri = String(process.env.MONGO_MARKETPLACE_URI || "").trim();
const restoreCoreUri = String(process.env.RESTORE_CORE_URI || "").trim();
const restoreMarketplaceUri = String(process.env.RESTORE_MARKETPLACE_URI || "").trim();
const identityFile = String(process.env.BACKUP_AGE_IDENTITY_FILE || "").trim();

function kinds() {
  if (requested === "all") return ["core", "marketplace"];
  if (["core", "marketplace"].includes(requested)) return [requested];
  throw new Error("--database must be core, marketplace or all.");
}

function targetUri(kind) {
  return kind === "core" ? restoreCoreUri : restoreMarketplaceUri;
}

async function targetInventory(uri) {
  const connection = mongoose.createConnection(uri);
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
    return { collectionCount: rows.length, indexCount, collections };
  } finally {
    await connection.close();
  }
}

function verifyInventory(expected = {}, actual = {}) {
  const errors = [];
  for (const [name, details] of Object.entries(expected)) {
    if (!actual[name]) errors.push(`Missing collection ${name}`);
    else if (Number(actual[name].count) !== Number(details.count)) {
      errors.push(`${name} count ${actual[name].count}/${details.count}`);
    } else if (Number(actual[name].indexCount) !== Number(details.indexCount)) {
      errors.push(`${name} indexes ${actual[name].indexCount}/${details.indexCount}`);
    }
  }
  if (errors.length) throw new Error(`Restore verification failed: ${errors.slice(0, 10).join(", ")}`);
}

async function drill(kind, tempDir) {
  const uri = targetUri(kind);
  if (!uri) throw new Error(`${kind === "core" ? "RESTORE_CORE_URI" : "RESTORE_MARKETPLACE_URI"} is required.`);
  assertIsolatedRestoreTarget(uri, [sourceCoreUri, sourceMarketplaceUri]);
  const source = await BackupRun.findOne({ kind, status: "verified" }).sort({ verifiedAt: -1 }).lean();
  if (!source) throw new Error(`No verified ${kind} backup is available.`);
  const encrypted = path.join(tempDir, source.artifactFileName);
  const archive = path.join(tempDir, `${kind}.restore.archive.gz`);
  await downloadGoogleDriveFileToPath(source.artifactDriveFileId, encrypted);
  if (await sha256File(encrypted) !== source.encryptedSha256) {
    throw new Error(`Encrypted ${kind} backup checksum mismatch.`);
  }
  await runCommand("age", ["-d", "-i", identityFile, "-o", archive, encrypted]);
  if (await sha256File(archive) !== source.sourceSha256) {
    throw new Error(`Decrypted ${kind} backup checksum mismatch.`);
  }
  await runCommand("mongorestore", [
    `--uri=${uri}`,
    `--archive=${archive}`,
    "--gzip",
    "--drop",
    ...restoreNamespaceArguments(source.databaseName, uri),
  ]);
  const actual = await targetInventory(uri);
  verifyInventory(source.metadata?.collections || {}, actual.collections);
  return {
    kind,
    sourceBackupId: source._id,
    targetDatabase: databaseNameFromUri(uri),
    actual,
  };
}

async function main() {
  if (process.env.RESTORE_CONFIRM !== "isolated-drill") {
    throw new Error("Set RESTORE_CONFIRM=isolated-drill to run a restore drill.");
  }
  if (!identityFile || !fs.existsSync(identityFile)) {
    throw new Error("BACKUP_AGE_IDENTITY_FILE must point to the offline age identity file.");
  }
  await mongoose.connect(sourceCoreUri);
  const run = await BackupRun.create({
    kind: "restore_drill",
    status: "running",
    startedAt: new Date(),
    sourceKind: requested === "all" ? "" : requested,
  });
  const base = path.resolve(process.env.BACKUP_WORK_DIR || os.tmpdir());
  await fs.promises.mkdir(base, { recursive: true });
  const tempDir = await fs.promises.mkdtemp(path.join(base, "3dipl-restore-"));
  try {
    const results = [];
    for (const kind of kinds()) results.push(await drill(kind, tempDir));
    await BackupRun.findByIdAndUpdate(run._id, {
      $set: {
        status: "verified",
        verifiedAt: new Date(),
        completedAt: new Date(),
        metadata: { results },
        error: "",
      },
    });
    console.log(JSON.stringify({ ok: true, results }, null, 2));
  } catch (error) {
    await BackupRun.findByIdAndUpdate(run._id, {
      $set: { status: "failed", completedAt: new Date(), error: String(error.message).slice(0, 1000) },
    }).catch(() => {});
    throw error;
  } finally {
    await mongoose.disconnect().catch(() => {});
    if (path.resolve(tempDir).startsWith(`${path.resolve(base)}${path.sep}`)) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  }
}

main().catch(async (error) => {
  console.error(`Restore drill failed: ${error.message}`);
  await sendTelegramNotification(`3DIPL restore drill failed\n${String(error.message).slice(0, 500)}`).catch(() => {});
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});

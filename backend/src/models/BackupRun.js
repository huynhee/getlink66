import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const backupRunSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ["core", "marketplace", "restore_drill"],
      required: true,
      index: true,
    },
    sourceKind: { type: String, enum: ["core", "marketplace", ""], default: "" },
    status: {
      type: String,
      enum: ["running", "uploaded", "verified", "verification_failed", "failed", "pruned"],
      default: "running",
      index: true,
    },
    databaseName: { type: String, default: "" },
    artifactFileName: { type: String, default: "" },
    artifactDriveFileId: { type: String, default: "" },
    manifestDriveFileId: { type: String, default: "" },
    sourceSha256: { type: String, default: "" },
    encryptedSha256: { type: String, default: "" },
    sourceBytes: { type: Number, default: 0, min: 0 },
    encryptedBytes: { type: Number, default: 0, min: 0 },
    collectionCount: { type: Number, default: 0, min: 0 },
    indexCount: { type: Number, default: 0, min: 0 },
    schemaVersion: { type: String, default: "1" },
    startedAt: { type: Date, default: Date.now },
    uploadedAt: Date,
    verifiedAt: Date,
    lastVerifiedAt: Date,
    completedAt: Date,
    prunedAt: Date,
    error: { type: String, default: "" },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

backupRunSchema.index({ kind: 1, status: 1, createdAt: -1 });
backupRunSchema.index({ status: 1, verifiedAt: -1 });

const BackupRunModel = isMemoryDb()
  ? createMemoryModel("BackupRun")
  : mongoose.model("BackupRun", backupRunSchema);

export async function ensureBackupRunIndexes() {
  if (isMemoryDb() || typeof BackupRunModel.init !== "function") return;
  await BackupRunModel.init();
}

export default BackupRunModel;

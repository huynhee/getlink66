import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";
import { marketplaceModel } from "../config/modelFactory.js";

const historyArchiveManifestSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["getlink", "marketplace-download"], required: true, index: true },
    batchKey: { type: String, required: true, unique: true },
    period: { type: String, required: true, index: true },
    recordIds: { type: [String], default: [] },
    recordCount: { type: Number, default: 0, min: 0 },
    archiveDriveFileId: { type: String, default: "" },
    driveManifestFileId: { type: String, default: "" },
    archiveFileName: { type: String, default: "" },
    archiveSha256: { type: String, default: "" },
    archiveSize: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ["pending", "verified", "deleted", "error"],
      default: "pending",
      index: true,
    },
    verifiedAt: Date,
    deletedAt: Date,
    lastError: { type: String, default: "" },
  },
  { timestamps: true },
);

historyArchiveManifestSchema.index({ status: 1, updatedAt: 1 });

export default isMemoryDb()
  ? createMemoryModel("HistoryArchiveManifest")
  : marketplaceModel("HistoryArchiveManifest", historyArchiveManifestSchema);

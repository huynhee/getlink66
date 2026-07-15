import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";
import { marketplaceModel } from "../config/modelFactory.js";

const marketplaceDriveSyncStateSchema = new mongoose.Schema(
  {
    assetType: { type: String, enum: ["model", "scene"], default: "model", index: true },
    rootFolderId: { type: String, required: true, unique: true },
    pageToken: { type: String, default: "" },
    changesPageToken: { type: String, default: "" },
    changesInitializedAt: Date,
    lastChangesPollAt: Date,
    lastChangesError: { type: String, default: "" },
    lastChangesCount: { type: Number, default: 0, min: 0 },
    queuedChangesCount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ["idle", "running", "error"], default: "idle" },
    lastStartedAt: Date,
    lastFinishedAt: Date,
    lastError: { type: String, default: "" },
    lastBatchCreated: { type: Number, default: 0, min: 0 },
    lastBatchUpdated: { type: Number, default: 0, min: 0 },
    lastBatchUnchanged: { type: Number, default: 0, min: 0 },
    createdCount: { type: Number, default: 0, min: 0 },
    updatedCount: { type: Number, default: 0, min: 0 },
    unchangedCount: { type: Number, default: 0, min: 0 },
    cycleCount: { type: Number, default: 0, min: 0 },
    lastCycleCompletedAt: Date,
    reconciliationPageToken: { type: String, default: "" },
    reconciliationStatus: { type: String, enum: ["idle", "running", "complete", "error"], default: "idle" },
    reconciliationScanned: { type: Number, default: 0, min: 0 },
    reconciliationUpdatedAt: Date,
    reconciliationError: { type: String, default: "" },
    migrationNextPage: { type: Number, default: 1, min: 1 },
    migrationStatus: { type: String, enum: ["idle", "running", "complete", "error"], default: "idle" },
    migrationMigratedCount: { type: Number, default: 0, min: 0 },
    migrationUpdatedAt: Date,
    migrationError: { type: String, default: "" },
  },
  { timestamps: true },
);

export default isMemoryDb()
  ? createMemoryModel("MarketplaceDriveSyncState")
  : marketplaceModel("MarketplaceDriveSyncState", marketplaceDriveSyncStateSchema);

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
    reconciliationStatus: {
      type: String,
      enum: ["idle", "queued", "running", "complete", "error", "canceled"],
      default: "idle",
      index: true,
    },
    reconciliationScanned: { type: Number, default: 0, min: 0 },
    reconciliationCreated: { type: Number, default: 0, min: 0 },
    reconciliationUpdated: { type: Number, default: 0, min: 0 },
    reconciliationUnchanged: { type: Number, default: 0, min: 0 },
    reconciliationFailed: { type: Number, default: 0, min: 0 },
    reconciliationBatchSize: { type: Number, default: 100, min: 1, max: 200 },
    reconciliationAttempts: { type: Number, default: 0, min: 0 },
    reconciliationCancelRequested: { type: Boolean, default: false },
    reconciliationStartedAt: Date,
    reconciliationFinishedAt: Date,
    reconciliationLockedAt: Date,
    reconciliationNextAttemptAt: Date,
    reconciliationLastFailures: { type: [mongoose.Schema.Types.Mixed], default: [] },
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

marketplaceDriveSyncStateSchema.index({
  reconciliationStatus: 1,
  reconciliationNextAttemptAt: 1,
  reconciliationLockedAt: 1,
});

export default isMemoryDb()
  ? createMemoryModel("MarketplaceDriveSyncState")
  : marketplaceModel("MarketplaceDriveSyncState", marketplaceDriveSyncStateSchema);

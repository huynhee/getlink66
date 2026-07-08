import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const marketplaceDriveSyncStateSchema = new mongoose.Schema(
  {
    rootFolderId: { type: String, required: true, unique: true },
    pageToken: { type: String, default: "" },
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
  },
  { timestamps: true },
);

export default isMemoryDb()
  ? createMemoryModel("MarketplaceDriveSyncState")
  : mongoose.model("MarketplaceDriveSyncState", marketplaceDriveSyncStateSchema);

import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const marketplaceDriveChangeSchema = new mongoose.Schema(
  {
    rootFolderId: { type: String, required: true, trim: true },
    driveFolderId: { type: String, required: true, trim: true },
    changedFileIds: { type: [String], default: [] },
    reasons: { type: [String], default: [] },
    status: {
      type: String,
      enum: ["pending", "processing", "failed"],
      default: "pending",
      index: true,
    },
    generation: { type: Number, default: 0, min: 0 },
    attempts: { type: Number, default: 0, min: 0 },
    nextAttemptAt: { type: Date, default: Date.now, index: true },
    lockedAt: Date,
    lastError: { type: String, default: "" },
    latestChangeAt: Date,
  },
  { timestamps: true },
);

marketplaceDriveChangeSchema.index({ rootFolderId: 1, driveFolderId: 1 }, { unique: true });
marketplaceDriveChangeSchema.index({ status: 1, nextAttemptAt: 1, updatedAt: 1 });

export default isMemoryDb()
  ? createMemoryModel("MarketplaceDriveChange")
  : mongoose.model("MarketplaceDriveChange", marketplaceDriveChangeSchema);

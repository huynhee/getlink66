import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const getlinkJobSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    activeUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    clientRequestId: { type: String, required: true, trim: true },
    input: { type: String, required: true, trim: true },
    includePreviewImage: { type: Boolean, default: false },
    requestedFormat: { type: mongoose.Schema.Types.Mixed, default: null },
    status: {
      type: String,
      enum: ["queued", "processing", "awaiting_format", "completed", "failed", "canceled"],
      default: "queued",
      index: true,
    },
    stage: {
      type: String,
      enum: ["queued", "validating", "resolving_format", "resolving_download", "saving", "completed", "failed", "canceled"],
      default: "queued",
    },
    progress: { type: Number, default: 10, min: 0, max: 100 },
    productId: { type: String, default: "", index: true },
    title: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
    creditCost: { type: Number, default: 0, min: 0 },
    formatOptions: { type: [mongoose.Schema.Types.Mixed], default: [] },
    selectedFormat: { type: mongoose.Schema.Types.Mixed, default: null },
    historyId: { type: mongoose.Schema.Types.ObjectId, ref: "Getlink", index: true },
    result: {
      credit: Number,
      creditUsed: Number,
      cached: Boolean,
      freeRedownload: Boolean,
    },
    error: {
      message: { type: String, default: "" },
      code: { type: String, default: "" },
      status: Number,
      retryable: { type: Boolean, default: false },
    },
    attempts: { type: Number, default: 0, min: 0 },
    nextAttemptAt: { type: Date, default: Date.now, index: true },
    lockedAt: Date,
    heartbeatAt: Date,
    startedAt: Date,
    completedAt: Date,
    failedAt: Date,
    canceledAt: Date,
    awaitingFormatExpiresAt: Date,
    acknowledgedAt: { type: Date, default: null, index: true },
    purgeAt: Date,
  },
  { timestamps: true },
);

getlinkJobSchema.index({ userId: 1, clientRequestId: 1 }, { unique: true });
getlinkJobSchema.index({ activeUserId: 1 }, { unique: true, sparse: true });
getlinkJobSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });
getlinkJobSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export default isMemoryDb()
  ? createMemoryModel("GetlinkJob")
  : mongoose.model("GetlinkJob", getlinkJobSchema);

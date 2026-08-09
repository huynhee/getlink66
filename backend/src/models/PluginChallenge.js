import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const schema = new mongoose.Schema(
  {
    challengeCode: { type: String, required: true, unique: true, index: true },
    approvalTokenHash: { type: String, default: "", index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PluginDeviceSession",
      required: true,
      index: true,
    },
    assetId: { type: String, required: true, index: true },
    idempotencyKeyHash: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ["pending", "approved", "consumed", "denied"],
      default: "pending",
      index: true,
    },
    approvedAt: Date,
    consumedAt: Date,
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schema.index({ userId: 1, sessionId: 1, assetId: 1, idempotencyKeyHash: 1, status: 1 });

export default isMemoryDb()
  ? createMemoryModel("PluginChallenge")
  : mongoose.model("PluginChallenge", schema);

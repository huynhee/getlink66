import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const schema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PluginDeviceSession",
      required: true,
      index: true,
    },
    tokenHash: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ["current", "rotated", "revoked"],
      default: "current",
      index: true,
    },
    rotatedAt: Date,
    revokedAt: Date,
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schema.index({ sessionId: 1, status: 1 });

export default isMemoryDb()
  ? createMemoryModel("PluginRefreshToken")
  : mongoose.model("PluginRefreshToken", schema);

import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const schema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    deviceName: { type: String, required: true, trim: true },
    pluginVersion: { type: String, required: true, trim: true },
    maxVersion: { type: String, required: true, trim: true },
    createdIpHash: { type: String, default: "" },
    lastIpHash: { type: String, default: "" },
    lastUsedAt: Date,
    absoluteExpiresAt: { type: Date, required: true },
    revokedAt: Date,
    revokeReason: { type: String, default: "" },
    riskChallengeRequired: { type: Boolean, default: false },
    challengeTrustedUntil: Date,
  },
  { timestamps: true },
);

schema.index({ userId: 1, revokedAt: 1, lastUsedAt: -1 });
schema.index({ absoluteExpiresAt: 1 }, { expireAfterSeconds: 0 });

export default isMemoryDb()
  ? createMemoryModel("PluginDeviceSession")
  : mongoose.model("PluginDeviceSession", schema);

import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";
import { coreModel } from "../config/modelFactory.js";

const pluginDeviceAuthorizationSchema = new mongoose.Schema(
  {
    deviceCodeHash: { type: String, required: true, unique: true, index: true },
    userCodeHash: { type: String, required: true, unique: true, index: true },
    deviceIdHash: { type: String, required: true, index: true },
    deviceName: { type: String, default: "" },
    maxVersion: { type: String, default: "" },
    pluginVersion: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "approved", "denied", "exchanging", "consumed", "expired"],
      default: "pending",
      index: true,
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    intervalSeconds: { type: Number, default: 5, min: 1, max: 30 },
    lastPolledAt: Date,
    approvedAt: Date,
    deniedAt: Date,
    consumedAt: Date,
    expiresAt: { type: Date, required: true, index: true },
    purgeAt: { type: Date, required: true },
    requestIpHash: { type: String, default: "" },
  },
  { timestamps: true },
);

pluginDeviceAuthorizationSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
pluginDeviceAuthorizationSchema.index({ status: 1, expiresAt: 1 });

export default isMemoryDb()
  ? createMemoryModel("PluginDeviceAuthorization")
  : coreModel("PluginDeviceAuthorization", pluginDeviceAuthorizationSchema);

import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const schema = new mongoose.Schema({
  channel: { type: String, required: true, enum: ["live-test", "staging", "production"] },
  version: { type: String, required: true },
  manifest: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, enum: ["draft", "verifying", "verified", "published", "withdrawn", "deleting"], default: "draft" },
  files: [{ name: String, bytes: Number, sha256: String, role: String, maxFamily: String, complete: Boolean }],
  error: { type: String, default: "" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  verifiedAt: Date,
  publishedAt: Date,
  verificationLease: Date,
  uploadExpiredAt: Date,
}, { timestamps: true });
schema.index({ channel: 1, version: 1 }, { unique: true });
const PluginReleaseModel = isMemoryDb() ? createMemoryModel("PluginRelease") : mongoose.model("PluginRelease", schema);

export async function ensurePluginReleaseIndexes() {
  if (isMemoryDb() || process.env.PLUGIN_RELEASE_SOURCE !== "database") return;
  await PluginReleaseModel.init();
}

export default PluginReleaseModel;

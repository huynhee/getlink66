import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const schema = new mongoose.Schema({
  _id: { type: String, enum: ["live-test", "staging", "production"] },
  activeReleaseId: { type: mongoose.Schema.Types.ObjectId, ref: "PluginRelease", default: null },
  activeReleaseV2Id: { type: mongoose.Schema.Types.ObjectId, ref: "PluginRelease", default: null },
  activeReleaseV3Id: { type: mongoose.Schema.Types.ObjectId, ref: "PluginRelease", default: null },
  revision: { type: Number, default: 0 },
}, { timestamps: true });
export default isMemoryDb() ? createMemoryModel("PluginReleaseChannel") : mongoose.model("PluginReleaseChannel", schema);

import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const schema = new mongoose.Schema({
  _id: String,
  accountNo: String,
  lastScanAt: Date,
  lastSuccessAt: Date,
  lastError: String,
  lastAttemptAt: Date,
  pollFailureCount: { type: Number, default: 0, min: 0 },
  pollBackoffUntil: Date,
  scanStartAt: Date,
  scanEndAt: Date,
  scanPageToken: String,
  lockOwner: String,
  lockUntil: Date,
}, { timestamps: true });
export default isMemoryDb() ? createMemoryModel("TimoMailState") : mongoose.model("TimoMailState", schema);

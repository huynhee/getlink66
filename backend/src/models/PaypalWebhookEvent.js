import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const schema = new mongoose.Schema({
  _id: String,
  environment: { type: String, enum: ["sandbox", "live"], required: true },
  eventType: { type: String, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  state: { type: String, default: "pending", index: true },
  leaseToken: String,
  leaseUntil: Date,
  nextAttemptAt: { type: Date, default: Date.now },
  attempts: { type: Number, default: 0 },
  lastError: String,
  notifiedAt: Date,
}, { timestamps: true });
schema.index({ state: 1, nextAttemptAt: 1 });
export default isMemoryDb() ? createMemoryModel("PaypalWebhookEvent") : mongoose.model("PaypalWebhookEvent", schema);

import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const schema = new mongoose.Schema({
  _id: String,
  kind: { type: String, enum: ["topup", "membership"], required: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  environment: { type: String, enum: ["sandbox", "live"], required: true },
  merchantId: { type: String, required: true },
  invoiceId: { type: String, required: true },
  amountMinor: { type: Number, required: true, min: 1 },
  paypalOrderId: { type: String, index: true },
  approvalUrl: String,
  captureId: String,
  captureStartedAt: Date,
  alertedAt: Date,
  capture: mongoose.Schema.Types.Mixed,
  state: { type: String, default: "creating", index: true },
  leaseToken: String,
  leaseUntil: Date,
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  attempts: { type: Number, default: 0 },
  lastError: { type: String, default: "" },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });
schema.index({ state: 1, nextAttemptAt: 1 });
schema.index({ environment: 1, paypalOrderId: 1 }, { unique: true, partialFilterExpression: { paypalOrderId: { $type: "string" } } });
export default isMemoryDb() ? createMemoryModel("PaypalPayment") : mongoose.model("PaypalPayment", schema);

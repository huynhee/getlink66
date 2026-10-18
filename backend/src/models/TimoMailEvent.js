import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const schema = new mongoose.Schema({
  _id: String,
  mailbox: { type: String, required: true },
  gmailMessageId: { type: String, required: true },
  state: { type: String, enum: ["pending", "verified", "applied", "ignored", "review"], default: "pending" },
  signedMessageIdHash: String,
  authenticationMethod: { type: String, enum: ["dkim", "gmail_arc"] },
  paymentCode: String,
  amount: Number,
  occurredAt: Date,
  receivedAt: Date,
  accountNo: String,
  kind: String,
  orderId: mongoose.Schema.Types.ObjectId,
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  reason: String,
  alertedAt: Date,
}, { timestamps: true });
schema.index({ mailbox: 1, state: 1, nextAttemptAt: 1 });
schema.index({ createdAt: -1 });
export default isMemoryDb() ? createMemoryModel("TimoMailEvent") : mongoose.model("TimoMailEvent", schema);

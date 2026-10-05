import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const schema = new mongoose.Schema({
  _id: String,
  paymentId: { type: String, required: true, index: true },
  type: { type: String, enum: ["refund", "reversal", "dispute"], required: true },
  externalId: { type: String, required: true },
  amountMinor: { type: Number, default: 0, min: 0 },
  currency: { type: String, default: "USD" },
  status: String,
  notifiedAt: Date,
}, { timestamps: true });
export default isMemoryDb() ? createMemoryModel("PaypalAdjustment") : mongoose.model("PaypalAdjustment", schema);

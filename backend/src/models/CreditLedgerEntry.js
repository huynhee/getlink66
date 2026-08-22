import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const creditLedgerEntrySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    direction: { type: String, enum: ["debit", "credit"], required: true },
    amount: { type: Number, required: true, min: 1 },
    balanceBefore: { type: Number, required: true, min: 0 },
    balanceAfter: { type: Number, required: true, min: 0 },
    type: { type: String, enum: ["marketplace_download"], required: true, index: true },
    asset: {
      assetType: { type: String, enum: ["model", "scene"], required: true },
      assetId: { type: String, required: true },
      sourceAssetId: { type: String, default: "" },
      title: { type: String, default: "" },
      slug: { type: String, default: "" },
    },
    idempotencyKey: { type: String, required: true, unique: true },
    entitlementId: { type: String, default: "" },
  },
  { timestamps: true },
);

creditLedgerEntrySchema.index({ userId: 1, createdAt: -1 });
creditLedgerEntrySchema.index({ "asset.assetType": 1, "asset.assetId": 1, createdAt: -1 });

export default isMemoryDb()
  ? createMemoryModel("CreditLedgerEntry")
  : mongoose.model("CreditLedgerEntry", creditLedgerEntrySchema);

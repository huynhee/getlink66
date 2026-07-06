import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const modelPurchaseSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    modelId: { type: mongoose.Schema.Types.ObjectId, ref: "MarketplaceModel", required: true, index: true },
    creditPaid: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

modelPurchaseSchema.index({ userId: 1, modelId: 1 }, { unique: true });

export default isMemoryDb()
  ? createMemoryModel("ModelPurchase")
  : mongoose.model("ModelPurchase", modelPurchaseSchema);

import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const productCacheSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true, unique: true, index: true },
    fileUrl: { type: String, default: "" },
    sourceUrl: String,
    title: String,
    imageUrl: String,
    creditCost: { type: Number, default: 1 },
    isPurchased: { type: Boolean, default: true }
  },
  { timestamps: true }
);

export default isMemoryDb() ? createMemoryModel("ProductCache") : mongoose.model("ProductCache", productCacheSchema);

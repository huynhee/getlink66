import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const marketplaceCategorySchema = new mongoose.Schema(
  {
    assetType: { type: String, enum: ["model", "scene"], default: "model", index: true },
    sourceProvider: { type: String, default: "3dsky", index: true },
    sourceCategoryId: { type: String, required: true, trim: true },
    title: { type: String, default: "" },
    titleEn: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true, index: true },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: "MarketplaceCategory", index: true },
    parentSourceCategoryId: { type: String, default: "", trim: true },
    position: { type: Number, default: 0, index: true },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

marketplaceCategorySchema.index(
  { assetType: 1, sourceProvider: 1, sourceCategoryId: 1 },
  { unique: true },
);
marketplaceCategorySchema.index({ assetType: 1, slug: 1 }, { unique: true });

export default isMemoryDb()
  ? createMemoryModel("MarketplaceCategory")
  : mongoose.model("MarketplaceCategory", marketplaceCategorySchema);

import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const marketplaceFilterOptionSchema = new mongoose.Schema(
  {
    assetType: { type: String, enum: ["model", "scene"], required: true, index: true },
    facet: {
      type: String,
      enum: ["style", "render", "form", "color", "material", "platform"],
      required: true,
      index: true,
    },
    value: { type: String, required: true, trim: true, lowercase: true },
    labelVi: { type: String, required: true, trim: true },
    labelEn: { type: String, required: true, trim: true },
    aliasesVi: { type: [String], default: [] },
    aliasesEn: { type: [String], default: [] },
    hex: { type: String, default: "", trim: true },
    iconKey: { type: String, default: "", trim: true },
    iconUrl: { type: String, default: "", trim: true },
    position: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true, index: true },
    catalogVersion: { type: Number, default: 1, min: 1 },
  },
  { timestamps: true },
);

marketplaceFilterOptionSchema.index(
  { assetType: 1, facet: 1, value: 1 },
  { unique: true },
);
marketplaceFilterOptionSchema.index({ assetType: 1, facet: 1, isActive: 1, position: 1 });

export default isMemoryDb()
  ? createMemoryModel("MarketplaceFilterOption")
  : mongoose.model("MarketplaceFilterOption", marketplaceFilterOptionSchema);

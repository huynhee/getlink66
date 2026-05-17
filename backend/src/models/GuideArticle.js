import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const guideArticleSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    summary: { type: String, default: "", trim: true },
    coverImage: { type: String, default: "", trim: true },
    content: { type: String, required: true },
    language: { type: String, enum: ["vi", "en"], default: "vi", index: true },
    isPublished: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0, index: true }
  },
  { timestamps: true }
);

export default isMemoryDb() ? createMemoryModel("GuideArticle") : mongoose.model("GuideArticle", guideArticleSchema);

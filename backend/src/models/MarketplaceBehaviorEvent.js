import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";
import { marketplaceModel } from "../config/modelFactory.js";

const marketplaceBehaviorEventSchema = new mongoose.Schema(
  {
    eventKey: { type: String, required: true, unique: true, index: true },
    actorKey: { type: String, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, index: true },
    modelId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    assetType: { type: String, enum: ["model", "scene"], required: true, index: true },
    eventType: {
      type: String,
      enum: ["impression", "click", "detail_view", "download"],
      required: true,
      index: true,
    },
    queryId: { type: String, default: "", trim: true, maxlength: 80 },
    position: { type: Number, default: 0, min: 0, max: 1_000 },
    source: { type: String, enum: ["search", "home", "detail", "download", "other"], default: "other" },
    occurredAt: { type: Date, default: Date.now, index: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

marketplaceBehaviorEventSchema.index({ actorKey: 1, occurredAt: -1 });
marketplaceBehaviorEventSchema.index({ modelId: 1, eventType: 1, occurredAt: -1 });
marketplaceBehaviorEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default isMemoryDb()
  ? createMemoryModel("MarketplaceBehaviorEvent")
  : marketplaceModel("MarketplaceBehaviorEvent", marketplaceBehaviorEventSchema);


import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";
import { marketplaceModel } from "../config/modelFactory.js";

const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    actorEmail: { type: String, default: "" },
    action: { type: String, required: true, index: true },
    target: { type: String, default: "" },
    targetId: { type: String, default: "" },
    details: { type: mongoose.Schema.Types.Mixed },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    statusCode: { type: Number }
  },
  { timestamps: true }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

export default isMemoryDb() ? createMemoryModel("AuditLog") : marketplaceModel("AuditLog", auditLogSchema);

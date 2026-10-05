import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const schema = new mongoose.Schema({ _id: String, revision: { type: Number, default: 0 } });
export default isMemoryDb() ? createMemoryModel("PaymentBenefitGuard") : mongoose.model("PaymentBenefitGuard", schema);

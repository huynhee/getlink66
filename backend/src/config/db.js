import mongoose from "mongoose";
import { useMemoryDb } from "./memoryStore.js";

export async function connectDb() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    if (process.env.ALLOW_MEMORY_DB === "true") {
      useMemoryDb();
      console.warn("MONGO_URI missing. Using in-memory dev database.");
      return;
    }
    throw new Error("MONGO_URI is required");
  }

  mongoose.set("strictQuery", true);
  try {
    await mongoose.connect(uri);
    console.log("MongoDB connected");
  } catch (error) {
    if (process.env.ALLOW_MEMORY_DB === "true") {
      useMemoryDb();
      console.warn(`MongoDB unavailable (${error.code || error.message}). Using in-memory dev database.`);
      return;
    }
    throw error;
  }
}

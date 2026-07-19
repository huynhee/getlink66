import mongoose from "mongoose";
import { useMemoryDb } from "./memoryStore.js";

function positiveIntegerEnv(name, fallback) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function allowMemoryDb() {
  const enabled = process.env.ALLOW_MEMORY_DB === "true";
  if (enabled && process.env.NODE_ENV === "production") {
    throw new Error("ALLOW_MEMORY_DB cannot be true in production.");
  }
  return enabled;
}

export function mongoConnectionOptions() {
  return {
    serverSelectionTimeoutMS: positiveIntegerEnv(
      "MONGO_SERVER_SELECTION_TIMEOUT_MS",
      30000,
    ),
    connectTimeoutMS: positiveIntegerEnv("MONGO_CONNECT_TIMEOUT_MS", 10000),
    socketTimeoutMS: positiveIntegerEnv("MONGO_SOCKET_TIMEOUT_MS", 60000),
    maxPoolSize: positiveIntegerEnv("MONGO_MAX_POOL_SIZE", 50),
    minPoolSize: positiveIntegerEnv("MONGO_MIN_POOL_SIZE", 5),
  };
}

export async function connectDb() {
  const uri = process.env.MONGO_URI;
  const canUseMemoryDb = allowMemoryDb();
  if (!uri) {
    if (canUseMemoryDb) {
      useMemoryDb();
      console.warn("MONGO_URI missing. Using in-memory dev database.");
      return;
    }
    throw new Error("MONGO_URI is required");
  }

  mongoose.set("strictQuery", true);
  try {
    await mongoose.connect(uri, mongoConnectionOptions());
    console.log("MongoDB connected");
  } catch (error) {
    if (canUseMemoryDb) {
      useMemoryDb();
      console.warn(`MongoDB unavailable (${error.code || error.message}). Using in-memory dev database.`);
      return;
    }
    throw error;
  }
}

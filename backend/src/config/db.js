import mongoose from "mongoose";
import { useMemoryDb } from "./memoryStore.js";

let marketplaceConnection = null;
let marketplaceUsesCore = true;
let marketplaceDistinct = false;

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

function connectionIdentity(connection) {
  const options = connection?.client?.options || {};
  const hosts = Array.from(options.hosts || [])
    .map((host) => String(host))
    .sort()
    .join(",");
  const server = String(options.srvHost || hosts || connection?.host || "").toLowerCase();
  return `${server}/${String(connection?.name || "").toLowerCase()}`;
}

async function assertMarketplaceTransactions(connection) {
  const required = process.env.MONGO_MARKETPLACE_TRANSACTIONS_REQUIRED === "true"
    || process.env.NODE_ENV === "production";
  if (!required) return;
  const hello = await connection.db.admin().command({ hello: 1 });
  if (!hello?.setName && hello?.msg !== "isdbgrid") {
    throw new Error("Marketplace MongoDB must run as a replica set or sharded cluster for transactions.");
  }
}

export async function connectDb() {
  const uri = process.env.MONGO_CORE_URI || process.env.MONGO_URI;
  const marketplaceUri = String(process.env.MONGO_MARKETPLACE_URI || "").trim();
  const marketplaceTarget = String(process.env.MARKETPLACE_DB_TARGET || "").trim().toLowerCase();
  const canUseMemoryDb = allowMemoryDb();
  if (!uri) {
    if (canUseMemoryDb) {
      useMemoryDb();
      console.warn("MONGO_URI missing. Using in-memory dev database.");
      return;
    }
    throw new Error("MONGO_CORE_URI or MONGO_URI is required");
  }
  if (process.env.NODE_ENV === "production" && marketplaceTarget === "vps" && !marketplaceUri) {
    throw new Error("MONGO_MARKETPLACE_URI is required when MARKETPLACE_DB_TARGET=vps in production.");
  }

  mongoose.set("strictQuery", true);
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: positiveIntegerEnv(
        "MONGO_SERVER_SELECTION_TIMEOUT_MS",
        5000,
      ),
      maxPoolSize: positiveIntegerEnv("MONGO_MAX_POOL_SIZE", 50),
      minPoolSize: positiveIntegerEnv("MONGO_MIN_POOL_SIZE", 5),
    });
    marketplaceUsesCore = !marketplaceUri || marketplaceTarget === "core";
    if (marketplaceUsesCore) {
      marketplaceConnection = mongoose.connection;
      marketplaceDistinct = false;
    } else {
      marketplaceConnection = mongoose.createConnection(marketplaceUri, {
        serverSelectionTimeoutMS: positiveIntegerEnv(
          "MONGO_MARKETPLACE_SERVER_SELECTION_TIMEOUT_MS",
          positiveIntegerEnv("MONGO_SERVER_SELECTION_TIMEOUT_MS", 5000),
        ),
        maxPoolSize: positiveIntegerEnv(
          "MONGO_MARKETPLACE_MAX_POOL_SIZE",
          positiveIntegerEnv("MONGO_MAX_POOL_SIZE", 50),
        ),
        minPoolSize: positiveIntegerEnv(
          "MONGO_MARKETPLACE_MIN_POOL_SIZE",
          positiveIntegerEnv("MONGO_MIN_POOL_SIZE", 5),
        ),
      });
      await marketplaceConnection.asPromise();
      marketplaceDistinct = connectionIdentity(marketplaceConnection) !== connectionIdentity(mongoose.connection);
      if (!marketplaceDistinct) {
        throw new Error("MONGO_CORE_URI and MONGO_MARKETPLACE_URI resolve to the same database.");
      }
    }
    await assertMarketplaceTransactions(marketplaceConnection);
    console.log(`MongoDB connected (core + marketplace:${marketplaceUsesCore ? "core" : "vps"})`);
  } catch (error) {
    await closeDbConnections().catch(() => {});
    if (canUseMemoryDb) {
      useMemoryDb();
      console.warn(`MongoDB unavailable (${error.code || error.message}). Using in-memory dev database.`);
      return;
    }
    throw error;
  }
}

export function coreDbConnection() {
  return mongoose.connection;
}

export function marketplaceDbConnection() {
  return marketplaceConnection || mongoose.connection;
}

export function marketplaceDbUsesCore() {
  return marketplaceUsesCore;
}

export function marketplaceDbIsDistinct() {
  return marketplaceDistinct;
}

export function databaseHealth() {
  return {
    core: mongoose.connection.readyState === 1,
    marketplace: marketplaceDbConnection().readyState === 1,
    marketplaceUsesCore,
    marketplaceDistinct,
  };
}

export async function closeDbConnections() {
  if (marketplaceConnection && !marketplaceUsesCore) {
    await marketplaceConnection.close().catch(() => {});
  }
  marketplaceConnection = null;
  marketplaceUsesCore = true;
  marketplaceDistinct = false;
  await mongoose.disconnect();
}

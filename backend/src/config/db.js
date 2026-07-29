import mongoose from "mongoose";
import { useMemoryDb } from "./memoryStore.js";

let marketplaceConnection = null;
let marketplaceUsesCore = true;
let marketplaceDistinct = false;

function configurationError(message) {
  const error = new Error(message);
  error.code = "DATABASE_CONFIGURATION_INVALID";
  return error;
}

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

export function resolveDatabaseRouting(env = process.env) {
  const coreUri = String(env.MONGO_CORE_URI || env.MONGO_URI || "").trim();
  const marketplaceUri = String(env.MONGO_MARKETPLACE_URI || "").trim();
  const target = String(env.MARKETPLACE_DB_TARGET || (marketplaceUri ? "vps" : "core"))
    .trim()
    .toLowerCase();
  const isTest = env.NODE_ENV === "test";

  if (!["core", "vps"].includes(target)) {
    throw configurationError("MARKETPLACE_DB_TARGET must be either core or vps.");
  }
  if (target === "vps" && !marketplaceUri && !isTest) {
    throw configurationError(
      "MONGO_MARKETPLACE_URI is required when MARKETPLACE_DB_TARGET=vps. "
      + "Set MARKETPLACE_DB_TARGET=core explicitly for a local single-database setup.",
    );
  }
  return {
    coreUri,
    marketplaceUri,
    target,
    usesCore: target === "core" || (isTest && !marketplaceUri),
  };
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

function marketplaceConnectionOptions() {
  const coreOptions = mongoConnectionOptions();
  return {
    serverSelectionTimeoutMS: positiveIntegerEnv(
      "MONGO_MARKETPLACE_SERVER_SELECTION_TIMEOUT_MS",
      coreOptions.serverSelectionTimeoutMS,
    ),
    connectTimeoutMS: positiveIntegerEnv(
      "MONGO_MARKETPLACE_CONNECT_TIMEOUT_MS",
      coreOptions.connectTimeoutMS,
    ),
    socketTimeoutMS: positiveIntegerEnv(
      "MONGO_MARKETPLACE_SOCKET_TIMEOUT_MS",
      coreOptions.socketTimeoutMS,
    ),
    maxPoolSize: positiveIntegerEnv(
      "MONGO_MARKETPLACE_MAX_POOL_SIZE",
      coreOptions.maxPoolSize,
    ),
    minPoolSize: positiveIntegerEnv(
      "MONGO_MARKETPLACE_MIN_POOL_SIZE",
      coreOptions.minPoolSize,
    ),
  };
}

export async function connectDb() {
  const canUseMemoryDb = allowMemoryDb();
  const routing = resolveDatabaseRouting();
  const uri = routing.coreUri;
  const marketplaceUri = routing.marketplaceUri;
  if (!uri) {
    if (canUseMemoryDb) {
      useMemoryDb();
      console.warn("MONGO_URI missing. Using in-memory dev database.");
      return;
    }
    throw new Error("MONGO_CORE_URI or MONGO_URI is required");
  }

  mongoose.set("strictQuery", true);
  try {
    await mongoose.connect(uri, mongoConnectionOptions());
    marketplaceUsesCore = routing.usesCore;
    if (marketplaceUsesCore) {
      marketplaceConnection = mongoose.connection;
      marketplaceDistinct = false;
    } else {
      marketplaceConnection = mongoose.createConnection(
        marketplaceUri,
        marketplaceConnectionOptions(),
      );
      await marketplaceConnection.asPromise();
      marketplaceDistinct = connectionIdentity(marketplaceConnection) !== connectionIdentity(mongoose.connection);
      if (!marketplaceDistinct) {
        throw configurationError("MONGO_CORE_URI and MONGO_MARKETPLACE_URI resolve to the same database.");
      }
    }
    await assertMarketplaceTransactions(marketplaceConnection);
    console.log(`MongoDB connected (core + marketplace:${marketplaceUsesCore ? "core" : "vps"})`);
  } catch (error) {
    await closeDbConnections().catch(() => {});
    if (canUseMemoryDb && error?.code !== "DATABASE_CONFIGURATION_INVALID") {
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

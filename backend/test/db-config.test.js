import assert from "node:assert/strict";
import test from "node:test";
import { mongoConnectionOptions } from "../src/config/db.js";

const ENV_NAMES = [
  "MONGO_SERVER_SELECTION_TIMEOUT_MS",
  "MONGO_CONNECT_TIMEOUT_MS",
  "MONGO_SOCKET_TIMEOUT_MS",
  "MONGO_MAX_POOL_SIZE",
  "MONGO_MIN_POOL_SIZE",
];

test("MongoDB connection options use resilient production defaults", () => {
  const previous = Object.fromEntries(
    ENV_NAMES.map((name) => [name, process.env[name]]),
  );

  try {
    ENV_NAMES.forEach((name) => delete process.env[name]);
    assert.deepEqual(mongoConnectionOptions(), {
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 60000,
      maxPoolSize: 50,
      minPoolSize: 5,
    });
  } finally {
    for (const name of ENV_NAMES) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

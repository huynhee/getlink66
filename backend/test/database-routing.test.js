import test from "node:test";
import assert from "node:assert/strict";
import { resolveDatabaseRouting } from "../src/config/db.js";

test("marketplace VPS routing fails closed when its URI is missing", () => {
  assert.throws(
    () => resolveDatabaseRouting({
      NODE_ENV: "development",
      MONGO_CORE_URI: "mongodb://core.example/core",
      MARKETPLACE_DB_TARGET: "vps",
    }),
    /MONGO_MARKETPLACE_URI is required/,
  );
});

test("single database development requires an explicit core target", () => {
  const routing = resolveDatabaseRouting({
    NODE_ENV: "development",
    MONGO_CORE_URI: "mongodb://core.example/core",
    MARKETPLACE_DB_TARGET: "core",
  });
  assert.equal(routing.usesCore, true);
  assert.equal(routing.target, "core");
});

test("tests can use the in-memory marketplace route without a VPS URI", () => {
  const routing = resolveDatabaseRouting({
    NODE_ENV: "test",
    MONGO_CORE_URI: "mongodb://core.example/core",
    MARKETPLACE_DB_TARGET: "vps",
  });
  assert.equal(routing.usesCore, true);
});

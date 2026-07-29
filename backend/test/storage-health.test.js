import test from "node:test";
import assert from "node:assert/strict";
import { evaluateStorageAlerts } from "../src/utils/storageHealthService.js";

function healthySnapshot(overrides = {}) {
  return {
    databases: {
      core: { connected: true, usagePercent: 40 },
      marketplace: { connected: true, topology: "replica_set" },
      routing: { expectedDistinct: true, distinct: true },
    },
    disk: { usagePercent: 30 },
    backups: {
      core: { status: "verified", ageHours: 2 },
      marketplace: { status: "verified", ageHours: 2 },
    },
    drive: {
      auth: { mode: "oauth_refresh" },
      folders: { backup: { ok: true }, history: { ok: true } },
    },
    workers: {
      driveFailed: 0,
      archiveErrors: 0,
      lastDrivePollAt: new Date(),
    },
    ...overrides,
  };
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("storage alerts accept a split replica-set deployment with fresh backups", () => {
  const previous = process.env.MONGO_MARKETPLACE_TRANSACTIONS_REQUIRED;
  process.env.MONGO_MARKETPLACE_TRANSACTIONS_REQUIRED = "true";
  assert.deepEqual(evaluateStorageAlerts(healthySnapshot()), []);
  restoreEnv("MONGO_MARKETPLACE_TRANSACTIONS_REQUIRED", previous);
});

test("storage alerts flag stale backups, capacity and unsafe routing", () => {
  const snapshot = healthySnapshot({
    databases: {
      core: { connected: true, usagePercent: 86 },
      marketplace: { connected: true, topology: "standalone" },
      routing: { expectedDistinct: true, distinct: false },
    },
    disk: { usagePercent: 96 },
    backups: {
      core: { status: "verified", ageHours: 27 },
      marketplace: null,
    },
  });
  const previous = process.env.MONGO_MARKETPLACE_TRANSACTIONS_REQUIRED;
  process.env.MONGO_MARKETPLACE_TRANSACTIONS_REQUIRED = "true";
  const codes = evaluateStorageAlerts(snapshot).map((alert) => alert.code);
  restoreEnv("MONGO_MARKETPLACE_TRANSACTIONS_REQUIRED", previous);
  assert.ok(codes.includes("DATABASES_NOT_SPLIT"));
  assert.ok(codes.includes("MARKETPLACE_REPLICA_SET_DOWN"));
  assert.ok(codes.includes("ATLAS_CAPACITY"));
  assert.ok(codes.includes("VPS_DISK_CAPACITY"));
  assert.ok(codes.includes("BACKUP_STALE_CORE"));
  assert.ok(codes.includes("BACKUP_STALE_MARKETPLACE"));
});

test("storage alerts clear an older backup failure after a newer verified run", () => {
  const snapshot = healthySnapshot({
    backups: {
      core: {
        kind: "core",
        status: "verified",
        ageHours: 2,
        verifiedAt: new Date("2026-07-29T02:00:00.000Z"),
      },
      marketplace: {
        kind: "marketplace",
        status: "verified",
        ageHours: 2,
        verifiedAt: new Date("2026-07-29T02:30:00.000Z"),
      },
      latestFailure: {
        kind: "core",
        status: "failed",
        verifiedAt: new Date("2026-07-28T02:00:00.000Z"),
        error: "old failure",
      },
    },
  });
  assert.ok(!evaluateStorageAlerts(snapshot).some((alert) => alert.code === "BACKUP_FAILED"));
});

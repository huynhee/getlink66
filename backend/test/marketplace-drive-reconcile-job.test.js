import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: MarketplaceDriveSyncState } = await import("../src/models/MarketplaceDriveSyncState.js");
const {
  cancelMarketplaceDriveReconciliation,
  queueMarketplaceDriveReconciliation,
  runMarketplaceDriveReconcileTick,
} = await import("../src/utils/marketplaceDriveReconcileJob.js");

test("full reconciliation queues once, persists progress and can be canceled", async () => {
  const rootFolderId = `reconcile-root-${Date.now()}`;
  await MarketplaceDriveSyncState.create({
    assetType: "model",
    rootFolderId,
    reconciliationStatus: "canceled",
    reconciliationPageToken: "checkpoint-2",
    reconciliationScanned: 200,
    reconciliationCreated: 190,
  });

  const resumed = await queueMarketplaceDriveReconciliation({
    assetType: "model",
    rootFolderId,
    batchSize: 100,
    reset: false,
  });
  assert.equal(resumed.reconciliationStatus, "queued");
  assert.equal(resumed.reconciliationPageToken, "checkpoint-2");
  assert.equal(resumed.reconciliationScanned, 200);

  await assert.rejects(
    queueMarketplaceDriveReconciliation({ assetType: "model", rootFolderId }),
    (error) => error.code === "MARKETPLACE_RECONCILIATION_ACTIVE",
  );

  const cancelRequested = await cancelMarketplaceDriveReconciliation({
    assetType: "model",
    rootFolderId,
  });
  assert.equal(cancelRequested.reconciliationCancelRequested, true);

  await runMarketplaceDriveReconcileTick();
  const canceled = await MarketplaceDriveSyncState.findOne({ rootFolderId }).lean();
  assert.equal(canceled.reconciliationStatus, "canceled");
  assert.equal(canceled.reconciliationScanned, 200);
});

test("starting from the beginning resets the saved reconciliation counters", async () => {
  const rootFolderId = `reconcile-reset-${Date.now()}`;
  await MarketplaceDriveSyncState.create({
    assetType: "model",
    rootFolderId,
    reconciliationStatus: "complete",
    reconciliationPageToken: "old-checkpoint",
    reconciliationScanned: 7000,
    reconciliationCreated: 6990,
    reconciliationFailed: 10,
  });

  const queued = await queueMarketplaceDriveReconciliation({
    assetType: "model",
    rootFolderId,
    batchSize: 150,
    reset: true,
  });
  assert.equal(queued.reconciliationStatus, "queued");
  assert.equal(queued.reconciliationPageToken, "");
  assert.equal(queued.reconciliationScanned, 0);
  assert.equal(queued.reconciliationCreated, 0);
  assert.equal(queued.reconciliationFailed, 0);
  assert.equal(queued.reconciliationBatchSize, 150);

  await cancelMarketplaceDriveReconciliation({ assetType: "model", rootFolderId });
  await runMarketplaceDriveReconcileTick();
});

test("queuing a new reconciliation state persists the requested asset type", async () => {
  const rootFolderId = `reconcile-new-scene-${Date.now()}`;
  const queued = await queueMarketplaceDriveReconciliation({
    assetType: "scene",
    rootFolderId,
    batchSize: 25,
  });

  assert.equal(queued.assetType, "scene");
  assert.equal(queued.rootFolderId, rootFolderId);
  assert.equal(queued.reconciliationStatus, "queued");
  assert.equal(queued.reconciliationBatchSize, 25);

  await cancelMarketplaceDriveReconciliation({ assetType: "scene", rootFolderId });
  await runMarketplaceDriveReconcileTick();
});

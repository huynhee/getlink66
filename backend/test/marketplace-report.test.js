import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: User } = await import("../src/models/User.js");
const { default: MarketplaceModel } = await import("../src/models/MarketplaceModel.js");
const { default: MarketplaceReport } = await import("../src/models/MarketplaceReport.js");
const { default: Notification } = await import("../src/models/Notification.js");
const {
  adminListMarketplaceReports,
  adminUpdateMarketplaceReport,
  createMarketplaceReport,
  getMarketplaceReportStatus,
  marketplaceReportCountsForAssets,
} = await import("../src/controllers/marketplaceReportController.js");
const {
  adminListMarketplaceModels,
  adminMarketplaceStats,
} = await import("../src/controllers/marketplaceAdminController.js");

let sequence = 0;

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.payload = value;
      return value;
    },
  };
}

async function asset(assetType = "model", values = {}) {
  sequence += 1;
  return MarketplaceModel.create({
    assetType,
    title: `${assetType} report ${sequence}`,
    slug: `${assetType}-report-${sequence}`,
    source: {
      provider: "drive",
      modelId: `report-folder-${sequence}`,
      assetId: `report-asset-${sequence}`,
    },
    isPublished: true,
    desiredPublished: true,
    metadataStatus: "complete",
    fileStatus: "ready",
    deletionStatus: "active",
    downloadCount: 11,
    syncStatus: "synced",
    ...values,
  });
}

async function submitReport({ user, model, body, assetType = model.assetType }) {
  const response = responseRecorder();
  await createMarketplaceReport(
    {
      user,
      params: { id: model._id },
      body,
      marketplaceAssetType: assetType,
    },
    response,
    (error) => { throw error; },
  );
  return response;
}

test("a signed-in user report is idempotent and does not mutate marketplace state", async () => {
  const user = await User.create({ email: `report-${sequence}@example.test`, name: "Reporter" });
  const model = await asset("model");
  const before = await MarketplaceModel.findById(model._id);

  const created = await submitReport({
    user,
    model,
    body: { reason: "metadata_incorrect", message: "Renderer is incorrect." },
  });
  assert.equal(created.statusCode, 201);
  assert.deepEqual(created.payload, { reported: true, alreadyReported: false });

  const duplicate = await submitReport({
    user,
    model,
    body: { reason: "download_failed", message: "Duplicate submission." },
  });
  assert.equal(duplicate.statusCode, 200);
  assert.deepEqual(duplicate.payload, { reported: true, alreadyReported: true });
  assert.equal(await MarketplaceReport.countDocuments({ userId: user._id, modelId: model._id }), 1);

  const status = responseRecorder();
  await getMarketplaceReportStatus(
    { user, params: { id: model._id }, marketplaceAssetType: "model" },
    status,
    (error) => { throw error; },
  );
  assert.deepEqual(status.payload, { reported: true });

  const after = await MarketplaceModel.findById(model._id);
  assert.equal(after.isPublished, before.isPublished);
  assert.equal(after.downloadCount, before.downloadCount);
  assert.equal(after.fileStatus, before.fileStatus);
  assert.equal(after.syncStatus, before.syncStatus);
});

test("report validation rejects invalid input and unavailable assets", async () => {
  const user = await User.create({ email: `validation-${sequence}@example.test`, name: "Validation reporter" });
  const scene = await asset("scene");

  const invalidReason = await submitReport({
    user,
    model: scene,
    body: { reason: "not-a-reason", message: "" },
  });
  assert.equal(invalidReason.statusCode, 400);
  assert.equal(invalidReason.payload.code, "MARKETPLACE_REPORT_REASON_INVALID");

  const missingOtherMessage = await submitReport({
    user,
    model: scene,
    body: { reason: "other", message: "   " },
  });
  assert.equal(missingOtherMessage.statusCode, 400);
  assert.equal(missingOtherMessage.payload.code, "MARKETPLACE_REPORT_MESSAGE_REQUIRED");

  const tooLong = await submitReport({
    user,
    model: scene,
    body: { reason: "other", message: "x".repeat(1001) },
  });
  assert.equal(tooLong.statusCode, 400);
  assert.equal(tooLong.payload.code, "MARKETPLACE_REPORT_MESSAGE_TOO_LONG");

  const validScene = await submitReport({
    user,
    model: scene,
    body: { reason: "missing_files", message: "A texture file is missing." },
  });
  assert.equal(validScene.statusCode, 201);
  assert.equal(await MarketplaceReport.countDocuments({ modelId: scene._id, assetType: "scene" }), 1);

  const trashed = await asset("model", {
    isPublished: false,
    desiredPublished: false,
    deletionStatus: "trashed",
  });
  const unavailable = await submitReport({
    user,
    model: trashed,
    body: { reason: "wrong_asset", message: "" },
  });
  assert.equal(unavailable.statusCode, 404);
});

test("daily limits are enforced across Model and Scene reports", async () => {
  const previousLimit = process.env.MARKETPLACE_REPORT_DAILY_LIMIT;
  process.env.MARKETPLACE_REPORT_DAILY_LIMIT = "1";
  try {
    const user = await User.create({ email: `daily-${sequence}@example.test`, name: "Daily reporter" });
    const model = await asset("model");
    const scene = await asset("scene");
    const first = await submitReport({
      user,
      model,
      body: { reason: "preview_incorrect", message: "" },
    });
    assert.equal(first.statusCode, 201);

    const limited = await submitReport({
      user,
      model: scene,
      body: { reason: "archive_corrupt", message: "" },
    });
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.payload.code, "MARKETPLACE_REPORT_DAILY_LIMIT");
  } finally {
    process.env.MARKETPLACE_REPORT_DAILY_LIMIT = previousLimit;
  }
});

test("admin workflow keeps active badges until all reports are closed", async () => {
  const firstUser = await User.create({ email: `admin-report-a-${sequence}@example.test`, name: "First reporter" });
  const secondUser = await User.create({ email: `admin-report-b-${sequence}@example.test`, name: "Second reporter" });
  const admin = await User.create({ email: `report-admin-${sequence}@example.test`, name: "Report admin", role: "admin" });
  const model = await asset("model", { title: `Reported chair ${sequence}` });
  const baselineStats = responseRecorder();
  await adminMarketplaceStats(
    { marketplaceAssetType: "model" },
    baselineStats,
    (error) => { throw error; },
  );

  await submitReport({
    user: firstUser,
    model,
    body: { reason: "download_failed", message: "The download does not start." },
  });
  await submitReport({
    user: secondUser,
    model,
    body: { reason: "archive_corrupt", message: "The archive cannot be opened." },
  });

  let counts = await marketplaceReportCountsForAssets([model]);
  assert.equal(counts.get(String(model._id)), 2);

  const reportedAssets = responseRecorder();
  await adminListMarketplaceModels(
    { query: { reportedOnly: "true", search: model.title } },
    reportedAssets,
    (error) => { throw error; },
  );
  assert.equal(reportedAssets.payload.models.length, 1);
  assert.equal(reportedAssets.payload.models[0].openReportCount, 2);

  const activeStats = responseRecorder();
  await adminMarketplaceStats(
    { marketplaceAssetType: "model" },
    activeStats,
    (error) => { throw error; },
  );
  assert.equal(activeStats.payload.stats.activeReports, baselineStats.payload.stats.activeReports + 2);
  assert.equal(activeStats.payload.stats.reportedAssets, baselineStats.payload.stats.reportedAssets + 1);

  const list = responseRecorder();
  await adminListMarketplaceReports(
    { query: { assetType: "model", status: "active", search: model.title } },
    list,
    (error) => { throw error; },
  );
  assert.equal(list.payload.reports.length, 2);
  assert.equal(list.payload.reports[0].model.title, model.title);
  assert.ok(list.payload.reports[0].userId.email);

  const [firstReport, secondReport] = await MarketplaceReport.find({
    modelId: model._id,
    isActive: true,
  }).sort({ createdAt: 1 }).lean();

  const investigating = responseRecorder();
  await adminUpdateMarketplaceReport(
    {
      user: admin,
      params: { id: firstReport._id },
      body: { status: "investigating", adminNote: "Checking the Drive archive." },
    },
    investigating,
    (error) => { throw error; },
  );
  assert.equal(investigating.payload.report.isActive, true);
  counts = await marketplaceReportCountsForAssets([model]);
  assert.equal(counts.get(String(model._id)), 2);

  const resolved = responseRecorder();
  await adminUpdateMarketplaceReport(
    {
      user: admin,
      params: { id: firstReport._id },
      body: { status: "resolved", adminNote: "Archive replaced." },
    },
    resolved,
    (error) => { throw error; },
  );
  assert.equal(resolved.payload.report.isActive, false);
  assert.equal(resolved.payload.report.expiresAt, undefined);
  assert.ok(resolved.payload.report.resolvedAt);
  counts = await marketplaceReportCountsForAssets([model]);
  assert.equal(counts.get(String(model._id)), 1);

  const dismissed = responseRecorder();
  await adminUpdateMarketplaceReport(
    {
      user: admin,
      params: { id: secondReport._id },
      body: { status: "dismissed", adminNote: "" },
    },
    dismissed,
    (error) => { throw error; },
  );
  counts = await marketplaceReportCountsForAssets([model]);
  assert.equal(counts.get(String(model._id)) || 0, 0);
  const closedStats = responseRecorder();
  await adminMarketplaceStats(
    { marketplaceAssetType: "model" },
    closedStats,
    (error) => { throw error; },
  );
  assert.equal(closedStats.payload.stats.activeReports, baselineStats.payload.stats.activeReports);
  assert.equal(closedStats.payload.stats.reportedAssets, baselineStats.payload.stats.reportedAssets);
  assert.equal(await Notification.countDocuments({}), 0);
});

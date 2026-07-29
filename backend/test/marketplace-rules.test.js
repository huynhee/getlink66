import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: User } = await import("../src/models/User.js");
const { default: MarketplaceModel } = await import("../src/models/MarketplaceModel.js");
const { default: DailyDownloadQuota } = await import("../src/models/DailyDownloadQuota.js");
const { default: DownloadSession } = await import("../src/models/DownloadSession.js");
const { default: ModelDownload } = await import("../src/models/ModelDownload.js");
const {
  createMarketplaceDownloadSession,
  nextVietnamReset,
  verifyDownloadSession,
  vietnamDayKey,
} = await import("../src/utils/marketplaceDownloadService.js");
const {
  adminUpdateMarketplaceModel,
  adminVerifyMarketplaceFile,
} = await import("../src/controllers/marketplaceAdminController.js");

function requestFor(user) {
  return {
    user,
    ip: "127.0.0.1",
    get(name) {
      return String(name).toLowerCase() === "user-agent" ? "marketplace-test" : "";
    },
  };
}

test("marketplace quota resets at the next Vietnam midnight", () => {
  const duringDay = new Date("2026-07-13T09:17:00.000Z");

  assert.equal(vietnamDayKey(duringDay), "2026-07-13");
  assert.equal(nextVietnamReset(duringDay).toISOString(), "2026-07-13T17:00:00.000Z");
});

test("admin cannot publish a model while its archive is not ready", async () => {
  const model = await MarketplaceModel.create({
    title: "Incomplete archive",
    slug: "incomplete-archive",
    categoryId: "category-leaf",
    styles: ["modern"],
    renderers: ["corona"],
    forms: ["rectangle"],
    colors: ["black"],
    materials: ["metal"],
    metadataStatus: "complete",
    fileStatus: "missing",
    isPublished: false,
  });
  let payload;
  await adminUpdateMarketplaceModel(
    { params: { id: model._id }, body: { isPublished: true } },
    {
      status() { return this; },
      json(value) { payload = value; return value; },
    },
    (error) => { throw error; },
  );

  assert.equal(payload.model.isPublished, false);
});

test("denied quota attempts do not consume extra marketplace downloads", async () => {
  const user = await User.create({ email: "quota@example.test", name: "Quota" });
  const model = await MarketplaceModel.create({
    title: "Free ready model",
    slug: "free-ready-model",
    categoryId: "category-leaf",
    styles: ["modern"],
    renderers: ["corona"],
    forms: ["rectangle"],
    colors: ["black"],
    materials: ["metal"],
    accessType: "free",
    metadataStatus: "complete",
    fileStatus: "ready",
    isPublished: true,
    storageProvider: "google_drive",
    driveFileId: "drive-file-test",
  });
  const req = requestFor(user);

  for (let index = 0; index < 5; index += 1) {
    await createMarketplaceDownloadSession({ req, modelId: model._id });
  }
  await assert.rejects(
    createMarketplaceDownloadSession({ req, modelId: model._id }),
    (error) => error?.status === 429,
  );

  const quota = await DailyDownloadQuota.findOne({
    dayKey: vietnamDayKey(),
    userId: user._id,
    tier: "free",
  });
  assert.equal(quota.count, 5);
});

test("marketplace quota is restored when session logging fails", async () => {
  const user = await User.create({ email: "quota-rollback@example.test", name: "Rollback" });
  const model = await MarketplaceModel.create({
    title: "Rollback model",
    slug: "rollback-model",
    categoryId: "category-leaf",
    styles: ["modern"],
    renderers: ["corona"],
    forms: ["rectangle"],
    colors: ["black"],
    materials: ["metal"],
    accessType: "free",
    metadataStatus: "complete",
    fileStatus: "ready",
    isPublished: true,
    storageProvider: "google_drive",
    driveFileId: "drive-file-rollback",
  });
  const originalCreate = ModelDownload.create;
  ModelDownload.create = async () => {
    throw new Error("simulated log failure");
  };
  try {
    await assert.rejects(
      createMarketplaceDownloadSession({ req: requestFor(user), modelId: model._id }),
      /simulated log failure/,
    );
  } finally {
    ModelDownload.create = originalCreate;
  }

  const quota = await DailyDownloadQuota.findOne({
    dayKey: vietnamDayKey(),
    userId: user._id,
    tier: "free",
  });
  assert.equal(quota.count, 0);
});

async function createMemberModel(slug) {
  return MarketplaceModel.create({
    title: slug,
    slug,
    categorySourceId: "category-leaf",
    styles: ["modern"],
    renderers: ["corona"],
    forms: ["rectangle"],
    colors: ["black"],
    materials: ["metal"],
    accessType: "member",
    metadataStatus: "complete",
    fileStatus: "ready",
    isPublished: true,
    storageProvider: "google_drive",
    driveFileId: `drive-${slug}`,
  });
}

test("Free, expired Pro and admin-without-Pro accounts cannot download Pro assets", async () => {
  const model = await createMemberModel("pro-access-regression");
  const users = [
    await User.create({ email: "free-pro-check@example.test", name: "Free" }),
    await User.create({ email: "expired-pro-check@example.test", name: "Expired", proUntil: new Date(Date.now() - 60_000) }),
    await User.create({ email: "admin-pro-check@example.test", name: "Admin", role: "admin" }),
  ];

  for (const user of users) {
    await assert.rejects(
      createMarketplaceDownloadSession({ req: requestFor(user), modelId: model._id }),
      (error) => error?.status === 403
        && error?.code === "PRO_REQUIRED"
        && error?.details?.assetType === "model",
    );
  }

  assert.equal(await DownloadSession.countDocuments({ modelId: model._id }), 0);
  assert.equal(await ModelDownload.countDocuments({ modelId: model._id }), 0);
  for (const user of users) {
    assert.equal(await DailyDownloadQuota.countDocuments({ userId: user._id }), 0);
  }
});

test("an active Pro account can download a Pro asset and uses member quota", async () => {
  const model = await createMemberModel("active-pro-access");
  const user = await User.create({
    email: "active-pro-check@example.test",
    name: "Active Pro",
    proUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
    proDailyDownloadLimit: 100,
  });
  const result = await createMarketplaceDownloadSession({ req: requestFor(user), modelId: model._id });
  const quota = await DailyDownloadQuota.findOne({ dayKey: vietnamDayKey(), userId: user._id, tier: "member" });

  assert.equal(result.session.accessTier, "member");
  assert.equal(result.quotaCost, 1);
  assert.equal(quota.count, 1);
});

test("banned accounts cannot create marketplace download records or consume quota", async () => {
  const model = await MarketplaceModel.create({
    title: "Blocked account model",
    slug: "blocked-account-model",
    categorySourceId: "category-leaf",
    accessType: "free",
    metadataStatus: "complete",
    fileStatus: "ready",
    isPublished: true,
    storageProvider: "google_drive",
    driveFileId: "drive-blocked-account",
  });
  const user = await User.create({
    email: "blocked-marketplace@example.test",
    name: "Blocked",
    isBanned: true,
    banReason: "Policy violation",
  });

  await assert.rejects(
    createMarketplaceDownloadSession({
      req: requestFor(user),
      modelId: model._id,
    }),
    (error) => error?.status === 403 && error?.code === "ACCOUNT_BANNED",
  );

  assert.equal(await DownloadSession.countDocuments({ modelId: model._id }), 0);
  assert.equal(await ModelDownload.countDocuments({ modelId: model._id }), 0);
  assert.equal(await DailyDownloadQuota.countDocuments({ userId: user._id }), 0);
});

test("marketplace download tokens cannot be redeemed by another account", async () => {
  const owner = await User.create({
    email: "download-owner@example.test",
    name: "Owner",
  });
  const other = await User.create({
    email: "download-other@example.test",
    name: "Other",
  });
  const model = await MarketplaceModel.create({
    title: "Owner-only download",
    slug: "owner-only-download",
    categorySourceId: "category-leaf",
    accessType: "free",
    metadataStatus: "complete",
    fileStatus: "ready",
    isPublished: true,
    storageProvider: "google_drive",
    driveFileId: "drive-owner-only",
  });
  const created = await createMarketplaceDownloadSession({
    req: requestFor(owner),
    modelId: model._id,
  });

  await assert.rejects(
    verifyDownloadSession(created.session._id, created.token, other._id),
    (error) => (
      error?.status === 403
      && error?.code === "DOWNLOAD_SESSION_OWNER_MISMATCH"
    ),
  );
  const verified = await verifyDownloadSession(
    created.session._id,
    created.token,
    owner._id,
  );
  assert.equal(String(verified.userId), String(owner._id));
});

test("admin file verification rejects a missing Drive attachment without creating download records", async () => {
  const model = await MarketplaceModel.create({
    title: "Archive not attached",
    slug: "archive-not-attached",
    assetType: "model",
    storageProvider: "google_drive",
    driveFileId: "",
  });
  let status = 200;
  let payload;
  await adminVerifyMarketplaceFile(
    { params: { id: model._id }, query: {}, body: {} },
    {
      status(code) { status = code; return this; },
      json(value) { payload = value; return value; },
    },
    (error) => { throw error; },
  );

  assert.equal(status, 409);
  assert.equal(payload.code, "DRIVE_ARCHIVE_NOT_ATTACHED");
  assert.equal(await DownloadSession.countDocuments({ modelId: model._id }), 0);
  assert.equal(await ModelDownload.countDocuments({ modelId: model._id }), 0);
});

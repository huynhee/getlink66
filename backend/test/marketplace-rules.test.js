import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: User } = await import("../src/models/User.js");
const { default: MarketplaceModel } = await import("../src/models/MarketplaceModel.js");
const { default: DailyDownloadQuota } = await import("../src/models/DailyDownloadQuota.js");
const { default: ModelDownload } = await import("../src/models/ModelDownload.js");
const {
  createMarketplaceDownloadSession,
  nextVietnamReset,
  vietnamDayKey,
} = await import("../src/utils/marketplaceDownloadService.js");
const { adminUpdateMarketplaceModel } = await import("../src/controllers/marketplaceAdminController.js");

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

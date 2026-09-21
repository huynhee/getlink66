import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();
process.env.GETLINK_JOB_ENABLED = "false";
const { default: User } = await import("../src/models/User.js");
const { default: GetlinkJob } = await import("../src/models/GetlinkJob.js");
const { createJob } = await import("../src/controllers/getlinkJobController.js");
const {
  cancelGetlinkJob,
  ownedGetlinkJob,
  publicGetlinkJob,
} = await import("../src/utils/getlinkJobService.js");
const { publicCachedPreviewImageUrl } = await import("../src/controllers/getlinkController.js");

function response() {
  return { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
}

test("plugin Getlink requires confirmation and captures price, preview and idempotency", async () => {
  const user = await User.create({ email: "plugin-getlink@example.test", credit: 100 });
  const req = { user, pluginSession: {}, body: { modelId: "12345678" }, protocol: "https", get: (name) => name === "Idempotency-Key" ? "plugin_request_test" : "example.test" };
  const missing = response();
  await createJob(req, missing, (error) => { throw error; });
  assert.equal(missing.statusCode, 400);
  req.body.confirmedCreditCost = 28;
  const first = response();
  await createJob(req, first, (error) => { throw error; });
  assert.equal(first.statusCode, 202);
  const stored = await ownedGetlinkJob(user._id, first.body.job.id);
  assert.equal(stored.confirmedCreditCost, 28);
  assert.equal(stored.includePreviewImage, true);
  assert.equal((await User.findById(user._id)).credit, 100);
  const replay = response();
  await createJob(req, replay, (error) => { throw error; });
  assert.equal(replay.body.job.id, first.body.job.id);
  assert.equal(await ownedGetlinkJob("someone-else", stored._id), null);
  await cancelGetlinkJob(user._id, stored._id);
});

test("web cannot inject the plugin-only confirmed price field", async () => {
  const res = response();
  await createJob({ body: { modelId: "12345678", confirmedCreditCost: 0 } }, res, (error) => { throw error; });
  assert.equal(res.statusCode, 400);
});

test("plugin resumes the active Getlink job instead of receiving an unusable conflict", async () => {
  const user = await User.create({ email: "plugin-active-job@example.test", credit: 100 });
  const baseRequest = {
    user,
    pluginSession: {},
    protocol: "https",
    get: (name) => name === "host" ? "example.test" : "",
  };
  const first = response();
  await createJob({
    ...baseRequest,
    body: {
      modelId: "12345678",
      confirmedCreditCost: 28,
      clientRequestId: "plugin_active_first",
    },
  }, first, (error) => { throw error; });
  assert.equal(first.statusCode, 202);

  const second = response();
  await createJob({
    ...baseRequest,
    body: {
      modelId: "87654321",
      confirmedCreditCost: 28,
      clientRequestId: "plugin_active_second",
    },
  }, second, (error) => { throw error; });
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.job.id, first.body.job.id);

  await cancelGetlinkJob(user._id, first.body.job.id);
});

test("plugin Getlink previews use the authenticated plugin route before completion", async () => {
  const user = await User.create({ email: "plugin-job-image@example.test", credit: 100 });
  const job = await GetlinkJob.create({
    userId: user._id,
    activeUserId: user._id,
    clientRequestId: "plugin_image_job",
    input: "12345678",
    productId: "12345678",
    title: "Example model",
    imageUrl: "https://source.example/preview.webp",
    status: "awaiting_format",
    stage: "resolving_format",
  });
  const req = {
    user,
    pluginSession: {},
    protocol: "https",
    get: () => "example.test",
  };

  const publicJob = await publicGetlinkJob(req, job);
  assert.equal(publicJob.imageUrl, "https://example.test/api/plugin/getlink/preview-cache/12345678");
  assert.equal(
    publicCachedPreviewImageUrl(req, "product/id"),
    "https://example.test/api/plugin/getlink/preview-cache/product%2Fid",
  );

  await cancelGetlinkJob(user._id, job._id);
});

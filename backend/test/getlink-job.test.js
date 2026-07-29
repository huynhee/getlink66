import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();
process.env.GETLINK_JOB_ENABLED = "false";

const { default: User } = await import("../src/models/User.js");
const { default: Getlink } = await import("../src/models/Getlink.js");
const { default: GetlinkJob } = await import("../src/models/GetlinkJob.js");
const {
  acknowledgeGetlinkJob,
  cancelGetlinkJob,
  createGetlinkJob,
  latestGetlinkJob,
  ownedGetlinkJob,
  processGetlinkJobQueue,
  publicGetlinkJob,
  selectGetlinkJobFormat,
  stopGetlinkJobWorker,
} = await import("../src/utils/getlinkJobService.js");

function publicRequest(user) {
  return {
    user,
    protocol: "http",
    get(name) {
      return String(name).toLowerCase() === "host" ? "localhost:5000" : "";
    },
  };
}

test("getlink jobs are idempotent and enforce one active job per account", async () => {
  const user = await User.create({ email: "job-idempotent@example.test", name: "Job", credit: 20 });
  const first = await createGetlinkJob({
    userId: user._id,
    body: { modelId: "MODEL123456", clientRequestId: "request_123456" },
  });
  assert.equal(first.created, true);

  const replay = await createGetlinkJob({
    userId: user._id,
    body: { modelId: "MODEL123456", clientRequestId: "request_123456" },
  });
  assert.equal(replay.created, false);
  assert.equal(String(replay.job._id), String(first.job._id));

  await assert.rejects(
    createGetlinkJob({
      userId: user._id,
      body: { modelId: "MODEL999999", clientRequestId: "request_999999" },
    }),
    (error) => error.status === 409 && error.code === "GETLINK_JOB_ACTIVE",
  );

  const other = await User.create({ email: "job-other@example.test", name: "Other", credit: 20 });
  assert.equal(await ownedGetlinkJob(other._id, first.job._id), null);
  const payload = await publicGetlinkJob(publicRequest(user), first.job);
  assert.equal(payload.status, "queued");
  assert.equal("input" in payload, false);
  assert.equal(JSON.stringify(payload).includes("fileUrl"), false);
  await cancelGetlinkJob(user._id, first.job._id);
  await acknowledgeGetlinkJob(user._id, first.job._id);
});

test("format selection resumes the same job and canceled results can be acknowledged", async () => {
  const user = await User.create({ email: "job-format@example.test", name: "Format", credit: 20 });
  const { job } = await createGetlinkJob({
    userId: user._id,
    body: { modelId: "FORMAT123456", clientRequestId: "format_request_1" },
  });
  await GetlinkJob.findByIdAndUpdate(job._id, {
    $set: {
      status: "awaiting_format",
      stage: "resolving_format",
      formatOptions: [
        { key: "1|max2018|4", fileFormat: "1", formatVersion: "max2018", rendererType: "4" },
        { key: "3||", fileFormat: "3" },
      ],
      awaitingFormatExpiresAt: new Date(Date.now() + 60_000),
    },
  });

  await assert.rejects(
    selectGetlinkJobFormat(user._id, job._id, "missing"),
    (error) => error.status === 400,
  );
  const resumed = await selectGetlinkJobFormat(user._id, job._id, "1|max2018|4");
  assert.equal(resumed.status, "queued");
  assert.equal(resumed.requestedFormat.fileFormat, "1");

  const canceled = await cancelGetlinkJob(user._id, job._id);
  assert.equal(canceled.status, "canceled");
  assert.equal(canceled.activeUserId, undefined);
  assert.equal(String((await latestGetlinkJob(user._id))._id), String(job._id));
  await acknowledgeGetlinkJob(user._id, job._id);
  assert.equal(await latestGetlinkJob(user._id), null);
});

test("worker completion stores only history reference and repeated polling does not charge twice", async () => {
  const user = await User.create({ email: "job-worker@example.test", name: "Worker", credit: 10 });
  const { job } = await createGetlinkJob({
    userId: user._id,
    body: { modelId: "WORKER123456", clientRequestId: "worker_request_1", includePreviewImage: true },
  });
  let executions = 0;
  process.env.GETLINK_JOB_ENABLED = "true";
  try {
    await processGetlinkJobQueue({
      executor: async ({ user: executingUser, onProgress }) => {
        executions += 1;
        await onProgress("resolving_download", 65);
        const charged = await User.findByIdAndUpdate(executingUser._id, { $inc: { credit: -2 } }, { new: true });
        const history = await Getlink.create({
          userId: executingUser._id,
          productId: "worker-product",
          fileUrl: "https://download.example.test/file.zip",
          imageUrl: "https://source.example.test/preview.jpg",
          title: "Worker model",
          creditUsed: 2,
        });
        return {
          status: 200,
          payload: {
            historyId: history._id,
            productId: history.productId,
            title: history.title,
            credit: charged.credit,
            creditUsed: 2,
          },
        };
      },
    });
    await processGetlinkJobQueue({ executor: async () => { executions += 1; } });
  } finally {
    process.env.GETLINK_JOB_ENABLED = "false";
  }

  const completed = await GetlinkJob.findById(job._id);
  const freshUser = await User.findById(user._id);
  assert.equal(executions, 1);
  assert.equal(completed.status, "completed");
  assert.equal(freshUser.credit, 8);
  assert.ok(completed.historyId);
  assert.equal(JSON.stringify(completed).includes("https://download.example.test"), false);

  const payload = await publicGetlinkJob(publicRequest(freshUser), completed);
  assert.match(payload.result.downloadUrl, /\/api\/getlink\/download\//);
  assert.match(payload.imageUrl, /\/api\/getlink\/preview-image\//);
  assert.equal(JSON.stringify(payload).includes("source.example.test"), false);
  assert.equal(payload.result.creditUsed, 2);
});

test("failed jobs do not change account credit", async () => {
  const user = await User.create({ email: "job-failed@example.test", name: "Failed", credit: 7 });
  const { job } = await createGetlinkJob({
    userId: user._id,
    body: { modelId: "FAILED123456", clientRequestId: "failed_request_1" },
  });
  process.env.GETLINK_JOB_ENABLED = "true";
  try {
    await processGetlinkJobQueue({
      executor: async () => {
        throw Object.assign(new Error("Invalid model"), { status: 400 });
      },
    });
  } finally {
    process.env.GETLINK_JOB_ENABLED = "false";
  }
  assert.equal((await GetlinkJob.findById(job._id)).status, "failed");
  assert.equal((await User.findById(user._id)).credit, 7);
  assert.equal(await Getlink.countDocuments({ userId: user._id }), 0);
});

test("worker shutdown drains an in-flight getlink job", async () => {
  const user = await User.create({ email: "job-drain@example.test", name: "Drain", credit: 7 });
  const { job } = await createGetlinkJob({
    userId: user._id,
    body: { modelId: "DRAIN123456", clientRequestId: "drain_request_1" },
  });
  let releaseExecutor;
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const release = new Promise((resolve) => {
    releaseExecutor = resolve;
  });

  process.env.GETLINK_JOB_ENABLED = "true";
  const processing = processGetlinkJobQueue({
    executor: async ({ user: executingUser }) => {
      markStarted();
      await release;
      const history = await Getlink.create({
        userId: executingUser._id,
        productId: "drain-product",
        fileUrl: "https://download.example.test/drain.zip",
        title: "Drain model",
        creditUsed: 0,
      });
      return {
        status: 200,
        payload: {
          historyId: history._id,
          productId: "drain-product",
          title: "Drain model",
          credit: 7,
          creditUsed: 0,
        },
      };
    },
  });
  await started;
  const draining = stopGetlinkJobWorker({ timeoutMs: 1_000 });
  releaseExecutor();

  assert.equal(await draining, true);
  await processing;
  process.env.GETLINK_JOB_ENABLED = "false";
  assert.equal((await GetlinkJob.findById(job._id)).status, "completed");
});

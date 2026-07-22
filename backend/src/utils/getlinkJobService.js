import crypto from "node:crypto";
import Getlink from "../models/Getlink.js";
import GetlinkJob from "../models/GetlinkJob.js";
import User from "../models/User.js";
import { executeGetlinkForJob, publicHistoryItem } from "../controllers/getlinkController.js";
import logger from "./logger.js";

const ACTIVE_STATUSES = ["queued", "processing", "awaiting_format"];
const TERMINAL_STATUSES = ["completed", "failed", "canceled"];
const TERMINAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FORMAT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STALE_MS = 30 * 60 * 1000;

let pollTimer = null;
let workerRunning = false;
let stopping = false;

function pollIntervalMs() {
  return Math.min(30_000, Math.max(500, Number(process.env.GETLINK_JOB_POLL_INTERVAL_MS || 1_000)));
}

function staleMs() {
  return Math.max(60_000, Number(process.env.GETLINK_JOB_STALE_MS || DEFAULT_STALE_MS));
}

function maxAttempts() {
  return Math.min(10, Math.max(1, Number(process.env.GETLINK_JOB_MAX_ATTEMPTS || 3)));
}

function jobsEnabled() {
  return String(process.env.GETLINK_JOB_ENABLED || "true").toLowerCase() !== "false";
}

function activeQuery(userId) {
  return { userId, status: { $in: ACTIVE_STATUSES } };
}

function normalizeClientRequestId(value = "") {
  const text = String(value || "").trim();
  if (!text) return crypto.randomUUID();
  if (!/^[a-zA-Z0-9_-]{8,96}$/.test(text)) {
    const error = new Error("clientRequestId is invalid.");
    error.status = 400;
    throw error;
  }
  return text;
}

function normalizeRequestedFormat(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const format = {
    key: String(value.key || "").trim().slice(0, 160),
    fileFormat: String(value.fileFormat || value.file_format || "").trim().slice(0, 40),
    formatVersion: String(value.formatVersion || value.format_version || "").trim().slice(0, 80),
    rendererType: String(value.rendererType || value.renderer_type || "").trim().slice(0, 80),
    rendererLabel: String(value.rendererLabel || value.renderer_label || "").trim().slice(0, 80),
    label: String(value.label || "").trim().slice(0, 120),
    size: String(value.size || "").trim().slice(0, 60),
  };
  return format.key || format.fileFormat ? format : null;
}

function publicError(error = {}) {
  const raw = String(error.message || "Getlink failed.")
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/(?:[\w-]+\.)*3d66\.com/gi, "3D")
    .replace(/3d66/gi, "3D")
    .slice(0, 300);
  const status = Number(error.status || 500);
  return {
    message: raw || "Getlink failed.",
    code: String(error.code || "").slice(0, 80),
    status,
    retryable: status === 409 || status === 429 || status >= 500,
  };
}

function retryDelayMs(attempt) {
  return [10_000, 30_000, 90_000][Math.max(0, Math.min(2, Number(attempt || 1) - 1))];
}

function terminalPurgeAt() {
  return new Date(Date.now() + TERMINAL_TTL_MS);
}

function jobPayload(job) {
  return {
    modelId: job.input,
    includePreviewImage: Boolean(job.includePreviewImage),
    ...(job.requestedFormat ? { downloadFormat: job.requestedFormat } : {}),
  };
}

async function updateProgress(jobId, stage, progress) {
  await GetlinkJob.findOneAndUpdate(
    { _id: jobId, status: "processing" },
    { $set: { stage, progress: Math.max(0, Math.min(99, Number(progress || 0))), heartbeatAt: new Date() } },
    { new: true },
  );
}

async function completeJob(job, payload) {
  if (payload.requiresFormatSelection) {
    return GetlinkJob.findByIdAndUpdate(job._id, {
      $set: {
        status: "awaiting_format",
        stage: "resolving_format",
        progress: 35,
        productId: String(payload.productId || ""),
        title: String(payload.title || ""),
        imageUrl: String(payload.imageUrl || ""),
        creditCost: Number(payload.creditCost || 0),
        formatOptions: Array.isArray(payload.formatOptions) ? payload.formatOptions : [],
        selectedFormat: payload.selectedFormat || null,
        awaitingFormatExpiresAt: new Date(Date.now() + FORMAT_TTL_MS),
        lockedAt: null,
        heartbeatAt: null,
      },
    });
  }

  const historyId = payload.historyId;
  if (!historyId) throw Object.assign(new Error("Getlink completed without a history record."), { status: 500 });
  return GetlinkJob.findByIdAndUpdate(job._id, {
    $set: {
      status: "completed",
      stage: "completed",
      progress: 100,
      productId: String(payload.productId || ""),
      title: String(payload.title || ""),
      imageUrl: String(payload.imageUrl || ""),
      creditCost: Number(payload.creditUsed || 0),
      selectedFormat: payload.selectedFormat || job.requestedFormat || null,
      historyId,
      result: {
        credit: Number(payload.credit || 0),
        creditUsed: Number(payload.creditUsed || 0),
        cached: Boolean(payload.cached),
        freeRedownload: Boolean(payload.freeRedownload),
      },
      completedAt: new Date(),
      purgeAt: terminalPurgeAt(),
      lockedAt: null,
      heartbeatAt: null,
      acknowledgedAt: null,
    },
    $unset: { activeUserId: 1, error: 1, awaitingFormatExpiresAt: 1 },
  });
}

async function failOrRetryJob(job, error) {
  const failure = publicError(error);
  if (failure.retryable && Number(job.attempts || 0) < maxAttempts()) {
    return GetlinkJob.findByIdAndUpdate(job._id, {
      $set: {
        status: "queued",
        stage: "queued",
        progress: 10,
        error: failure,
        nextAttemptAt: new Date(Date.now() + retryDelayMs(job.attempts)),
        lockedAt: null,
        heartbeatAt: null,
      },
    });
  }
  return GetlinkJob.findByIdAndUpdate(job._id, {
    $set: {
      status: "failed",
      stage: "failed",
      progress: 0,
      error: failure,
      failedAt: new Date(),
      purgeAt: terminalPurgeAt(),
      lockedAt: null,
      heartbeatAt: null,
      acknowledgedAt: null,
    },
    $unset: { activeUserId: 1 },
  });
}

async function processClaimedJob(job, { executor = executeGetlinkForJob, userModel = User } = {}) {
  const heartbeat = setInterval(() => {
    GetlinkJob.findOneAndUpdate(
      { _id: job._id, status: "processing" },
      { $set: { heartbeatAt: new Date() } },
      { new: true },
    ).catch(() => {});
  }, 15_000);
  heartbeat.unref?.();

  try {
    const user = await userModel.findById(job.userId);
    if (!user || user.isBanned) {
      throw Object.assign(new Error(user?.banReason || "This account cannot use getlink."), { status: 403 });
    }
    const operation = await executor({
      user,
      body: jobPayload(job),
      onProgress: (stage, progress) => updateProgress(job._id, stage, progress),
    });
    await completeJob(job, operation.payload || {});
  } catch (error) {
    await failOrRetryJob(job, error);
  } finally {
    clearInterval(heartbeat);
  }
}

async function recoverStaleJobs() {
  const staleBefore = new Date(Date.now() - staleMs());
  await GetlinkJob.findOneAndUpdate(
    { status: "processing", heartbeatAt: { $lt: staleBefore } },
    {
      $set: {
        status: "queued",
        stage: "queued",
        progress: 10,
        nextAttemptAt: new Date(),
        lockedAt: null,
        heartbeatAt: null,
      },
    },
    { new: true, sort: { heartbeatAt: 1 } },
  );
  await GetlinkJob.findOneAndUpdate(
    { status: "awaiting_format", awaitingFormatExpiresAt: { $lt: new Date() } },
    {
      $set: {
        status: "failed",
        stage: "failed",
        progress: 0,
        error: { message: "File format selection expired.", code: "FORMAT_SELECTION_EXPIRED", status: 410, retryable: true },
        failedAt: new Date(),
        purgeAt: terminalPurgeAt(),
        acknowledgedAt: null,
      },
      $unset: { activeUserId: 1 },
    },
    { new: true, sort: { awaitingFormatExpiresAt: 1 } },
  );
}

export async function processGetlinkJobQueue(dependencies = {}) {
  if (workerRunning || stopping || !jobsEnabled()) return null;
  workerRunning = true;
  try {
    await recoverStaleJobs();
    const now = new Date();
    const job = await GetlinkJob.findOneAndUpdate(
      { status: "queued", nextAttemptAt: { $lte: now } },
      {
        $set: {
          status: "processing",
          stage: "validating",
          progress: 20,
          lockedAt: now,
          heartbeatAt: now,
          startedAt: now,
        },
        $inc: { attempts: 1 },
      },
      { new: true, sort: { createdAt: 1 } },
    );
    if (!job) return null;
    await processClaimedJob(job, dependencies);
    return job._id;
  } finally {
    workerRunning = false;
  }
}

export function wakeGetlinkJobWorker() {
  if (!jobsEnabled()) return;
  setTimeout(() => processGetlinkJobQueue().catch((error) => logger.error({ err: error }, "Getlink job worker failed")), 0).unref?.();
}

export function startGetlinkJobWorker() {
  if (!jobsEnabled() || pollTimer) return;
  stopping = false;
  wakeGetlinkJobWorker();
  pollTimer = setInterval(() => {
    processGetlinkJobQueue().catch((error) => logger.error({ err: error }, "Getlink job worker failed"));
  }, pollIntervalMs());
  pollTimer.unref?.();
  logger.info({ pollIntervalMs: pollIntervalMs() }, "Getlink job worker started");
}

export function stopGetlinkJobWorker() {
  stopping = true;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

export async function createGetlinkJob({ userId, body = {} }) {
  const clientRequestId = normalizeClientRequestId(body.clientRequestId);
  const input = String(body.modelId || body.url || "").trim();
  if (!input || input.length > 2_048) {
    const error = new Error("3D model link or model ID is required.");
    error.status = 400;
    throw error;
  }

  const idempotent = await GetlinkJob.findOne({ userId, clientRequestId });
  if (idempotent) return { job: idempotent, created: false };
  const active = await GetlinkJob.findOne(activeQuery(userId));
  if (active) {
    const error = new Error("Another getlink request is already processing.");
    error.status = 409;
    error.code = "GETLINK_JOB_ACTIVE";
    error.activeJob = active;
    throw error;
  }

  let job;
  try {
    job = await GetlinkJob.create({
      userId,
      activeUserId: userId,
      clientRequestId,
      input,
      includePreviewImage: Boolean(body.includePreviewImage),
      requestedFormat: normalizeRequestedFormat(body.downloadFormat),
      status: "queued",
      stage: "queued",
      progress: 10,
      attempts: 0,
      nextAttemptAt: new Date(),
      formatOptions: [],
      acknowledgedAt: null,
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const existing = await GetlinkJob.findOne({ $or: [{ userId, clientRequestId }, activeQuery(userId)] });
    if (existing && String(existing.clientRequestId) === clientRequestId) return { job: existing, created: false };
    const conflict = new Error("Another getlink request is already processing.");
    conflict.status = 409;
    conflict.code = "GETLINK_JOB_ACTIVE";
    conflict.activeJob = existing;
    throw conflict;
  }

  const previousResults = await GetlinkJob.find({
    userId,
    status: { $in: TERMINAL_STATUSES },
    acknowledgedAt: null,
    _id: { $ne: job._id },
  }).limit(100);
  await Promise.all(previousResults.map((item) =>
    GetlinkJob.findByIdAndUpdate(item._id, { $set: { acknowledgedAt: new Date() } }),
  ));
  wakeGetlinkJobWorker();
  return { job, created: true };
}

export async function latestGetlinkJob(userId) {
  const active = await GetlinkJob.findOne(activeQuery(userId)).sort({ createdAt: -1 });
  if (active) return active;
  return GetlinkJob.findOne({ userId, status: { $in: TERMINAL_STATUSES }, acknowledgedAt: null }).sort({ createdAt: -1 });
}

export async function ownedGetlinkJob(userId, jobId) {
  return GetlinkJob.findOne({ _id: jobId, userId });
}

export async function selectGetlinkJobFormat(userId, jobId, formatKey) {
  const job = await ownedGetlinkJob(userId, jobId);
  if (!job) return null;
  if (job.status !== "awaiting_format") throw Object.assign(new Error("This getlink job is not waiting for a format."), { status: 409 });
  if (job.awaitingFormatExpiresAt && new Date(job.awaitingFormatExpiresAt) <= new Date()) {
    throw Object.assign(new Error("File format selection expired."), { status: 410 });
  }
  const selected = (Array.isArray(job.formatOptions) ? job.formatOptions : []).find((option) => String(option?.key || "") === String(formatKey || ""));
  if (!selected) throw Object.assign(new Error("Selected file format is invalid."), { status: 400 });
  const updated = await GetlinkJob.findOneAndUpdate({ _id: job._id, userId, status: "awaiting_format" }, {
    $set: {
      requestedFormat: normalizeRequestedFormat(selected),
      selectedFormat: selected,
      status: "queued",
      stage: "queued",
      progress: 10,
      attempts: 0,
      nextAttemptAt: new Date(),
      lockedAt: null,
      heartbeatAt: null,
    },
    $unset: { awaitingFormatExpiresAt: 1, error: 1 },
  }, { new: true });
  if (!updated) throw Object.assign(new Error("This getlink job is no longer waiting for a format."), { status: 409 });
  wakeGetlinkJobWorker();
  return updated;
}

export async function retryGetlinkJob(userId, jobId) {
  const job = await ownedGetlinkJob(userId, jobId);
  if (!job) return null;
  if (job.status !== "failed") throw Object.assign(new Error("Only failed getlink jobs can be retried."), { status: 409 });
  const active = await GetlinkJob.findOne(activeQuery(userId));
  if (active) {
    const error = new Error("Another getlink request is already processing.");
    error.status = 409;
    error.code = "GETLINK_JOB_ACTIVE";
    error.activeJob = active;
    throw error;
  }
  let updated;
  try {
    updated = await GetlinkJob.findOneAndUpdate(
      { _id: job._id, userId, status: "failed" },
      {
        $set: {
          activeUserId: userId,
          status: "queued",
          stage: "queued",
          progress: 10,
          attempts: 0,
          nextAttemptAt: new Date(),
          failedAt: null,
          purgeAt: null,
          acknowledgedAt: null,
          lockedAt: null,
          heartbeatAt: null,
        },
        $unset: { error: 1 },
      },
      { new: true },
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const conflict = new Error("Another getlink request is already processing.");
    conflict.status = 409;
    conflict.code = "GETLINK_JOB_ACTIVE";
    conflict.activeJob = await GetlinkJob.findOne(activeQuery(userId));
    throw conflict;
  }
  if (!updated) throw Object.assign(new Error("This getlink job can no longer be retried."), { status: 409 });
  wakeGetlinkJobWorker();
  return updated;
}

export async function cancelGetlinkJob(userId, jobId) {
  const job = await ownedGetlinkJob(userId, jobId);
  if (!job) return null;
  if (!["queued", "awaiting_format"].includes(job.status)) {
    throw Object.assign(new Error("This getlink job can no longer be canceled."), { status: 409 });
  }
  const canceled = await GetlinkJob.findOneAndUpdate(
    { _id: job._id, userId, status: { $in: ["queued", "awaiting_format"] } },
    {
      $set: {
        status: "canceled",
        stage: "canceled",
        progress: 0,
        canceledAt: new Date(),
        purgeAt: terminalPurgeAt(),
        acknowledgedAt: null,
      },
      $unset: { activeUserId: 1, lockedAt: 1, heartbeatAt: 1 },
    },
    { new: true },
  );
  if (!canceled) throw Object.assign(new Error("This getlink job can no longer be canceled."), { status: 409 });
  return canceled;
}

export async function acknowledgeGetlinkJob(userId, jobId) {
  const job = await ownedGetlinkJob(userId, jobId);
  if (!job) return null;
  if (!TERMINAL_STATUSES.includes(job.status)) {
    throw Object.assign(new Error("An active getlink job cannot be dismissed."), { status: 409 });
  }
  return GetlinkJob.findByIdAndUpdate(job._id, { $set: { acknowledgedAt: new Date() } });
}

export async function publicGetlinkJob(req, job) {
  if (!job) return null;
  const doc = job.toObject ? job.toObject() : job;
  let download = null;
  if (doc.status === "completed" && doc.historyId) {
    const history = await Getlink.findOne({ _id: doc.historyId, userId: req.user._id }).lean();
    if (history) download = publicHistoryItem(req, history);
  }
  return {
    id: String(doc._id),
    status: doc.status,
    stage: doc.stage,
    progress: Number(doc.progress || 0),
    productId: doc.productId || "",
    title: doc.title || "",
    imageUrl: download?.previewImageDownloadUrl || "",
    creditCost: Number(doc.creditCost || 0),
    includePreviewImage: Boolean(doc.includePreviewImage),
    formatOptions: Array.isArray(doc.formatOptions) ? doc.formatOptions : [],
    selectedFormat: doc.selectedFormat || null,
    attempts: Number(doc.attempts || 0),
    error: doc.error?.message ? doc.error : null,
    result: doc.status === "completed"
      ? {
          credit: Number(doc.result?.credit || 0),
          creditUsed: Number(doc.result?.creditUsed || 0),
          cached: Boolean(doc.result?.cached),
          freeRedownload: Boolean(doc.result?.freeRedownload),
          downloadUrl: download?.downloadUrl || null,
          previewImageDownloadUrl: doc.includePreviewImage ? download?.previewImageDownloadUrl || null : null,
          canRedownload: Boolean(download?.canRedownload),
        }
      : null,
    canCancel: ["queued", "awaiting_format"].includes(doc.status),
    canRetry: doc.status === "failed",
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    completedAt: doc.completedAt || null,
  };
}

export const getlinkJobStatuses = { active: ACTIVE_STATUSES, terminal: TERMINAL_STATUSES };

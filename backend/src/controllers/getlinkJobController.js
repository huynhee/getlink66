import {
  acknowledgeGetlinkJob,
  cancelGetlinkJob,
  createGetlinkJob,
  latestGetlinkJob,
  ownedGetlinkJob,
  publicGetlinkJob,
  retryGetlinkJob,
  selectGetlinkJobFormat,
} from "../utils/getlinkJobService.js";
import { isSafeId, rejectUnknownKeys } from "../utils/validators.js";

function validJobId(req, res) {
  const id = String(req.params.id || "").trim();
  if (!isSafeId(id)) {
    res.status(400).json({ message: "Invalid getlink job ID." });
    return "";
  }
  return id;
}

async function sendJob(req, res, job, status = 200) {
  if (!job) return res.status(404).json({ message: "Getlink job not found." });
  return res.status(status).json({ job: await publicGetlinkJob(req, job) });
}

export async function createJob(req, res, next) {
  try {
    const unknownKey = rejectUnknownKeys(req.body, ["url", "modelId", "includePreviewImage", "downloadFormat", "clientRequestId"]);
    if (unknownKey) return res.status(400).json({ message: "Invalid getlink job request." });
    const result = await createGetlinkJob({ userId: req.user._id, body: req.body });
    return sendJob(req, res, result.job, result.created ? 202 : 200);
  } catch (error) {
    if (error.code === "GETLINK_JOB_ACTIVE" && error.activeJob) {
      return res.status(409).json({
        message: error.message,
        code: error.code,
        job: await publicGetlinkJob(req, error.activeJob),
      });
    }
    next(error);
  }
}

export async function latestJob(req, res, next) {
  try {
    const job = await latestGetlinkJob(req.user._id);
    res.json({ job: await publicGetlinkJob(req, job) });
  } catch (error) {
    next(error);
  }
}

export async function getJob(req, res, next) {
  try {
    const id = validJobId(req, res);
    if (!id) return;
    return sendJob(req, res, await ownedGetlinkJob(req.user._id, id));
  } catch (error) {
    next(error);
  }
}

export async function chooseJobFormat(req, res, next) {
  try {
    const id = validJobId(req, res);
    if (!id) return;
    const unknownKey = rejectUnknownKeys(req.body, ["formatKey"]);
    if (unknownKey) return res.status(400).json({ message: "Invalid format selection request." });
    const formatKey = String(req.body.formatKey || "").trim();
    if (!formatKey) return res.status(400).json({ message: "File format is required." });
    return sendJob(req, res, await selectGetlinkJobFormat(req.user._id, id, formatKey));
  } catch (error) {
    next(error);
  }
}

export async function retryJob(req, res, next) {
  try {
    const id = validJobId(req, res);
    if (!id) return;
    return sendJob(req, res, await retryGetlinkJob(req.user._id, id));
  } catch (error) {
    if (error.code === "GETLINK_JOB_ACTIVE" && error.activeJob) {
      return res.status(409).json({ message: error.message, code: error.code, job: await publicGetlinkJob(req, error.activeJob) });
    }
    next(error);
  }
}

export async function cancelJob(req, res, next) {
  try {
    const id = validJobId(req, res);
    if (!id) return;
    return sendJob(req, res, await cancelGetlinkJob(req.user._id, id));
  } catch (error) {
    next(error);
  }
}

export async function acknowledgeJob(req, res, next) {
  try {
    const id = validJobId(req, res);
    if (!id) return;
    return sendJob(req, res, await acknowledgeGetlinkJob(req.user._id, id));
  } catch (error) {
    next(error);
  }
}

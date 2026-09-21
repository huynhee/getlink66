import { Router } from "express";
import {
  deviceStart,
  deviceToken,
  logout,
  me,
  refresh,
  releaseManifest,
} from "../controllers/pluginAuthController.js";
import {
  createDownloadSession,
  downloadSessionFile,
  getDownloadOptions,
} from "../controllers/marketplaceController.js";
import { createRateLimit } from "../middleware/rateLimit.js";
import { pluginBearerAuth } from "../middleware/pluginBearerAuth.js";
import { pluginAccountEvents } from "../controllers/pluginAccountEventController.js";
import { pluginDownloadChallenge } from "../middleware/pluginDownloadChallenge.js";
import {
  downloadGetlink,
  downloadGetlinkPreviewImage,
  getlinkHistory,
  prepareRedownload,
  previewGetlink,
  proxyCachedGetlinkPreviewImage,
} from "../controllers/getlinkController.js";
import { createJob, latestJob, getJob, chooseJobFormat, retryJob, cancelJob, acknowledgeJob } from "../controllers/getlinkJobController.js";

const router = Router();
const startLimit = createRateLimit({
  keyPrefix: "plugin-device-start-ip",
  windowMs: 60_000,
  max: 10,
  keyGenerator: (req) => req.ip,
});
const tokenLimit = createRateLimit({
  keyPrefix: "plugin-device-token",
  windowMs: 60_000,
  max: 30,
  keyGenerator: (req) => `${req.ip}:${String(req.body?.deviceCode || "").slice(0, 16)}`,
});
const refreshLimit = createRateLimit({
  keyPrefix: "plugin-refresh",
  windowMs: 60_000,
  max: 20,
  keyGenerator: (req) => `${req.ip}:${String(req.body?.refreshToken || "").slice(0, 16)}`,
});
const privateLimit = createRateLimit({
  keyPrefix: "plugin-private",
  windowMs: 60_000,
  max: 120,
  keyGenerator: (req) => `${req.user?._id}:${req.pluginSession?._id}:${req.ip}`,
});
const downloadLimit = createRateLimit({
  keyPrefix: "plugin-download-session",
  windowMs: 60_000,
  max: 30,
  keyGenerator: (req) => `${req.user?._id}:${req.pluginSession?._id}:${req.ip}`,
});

function sceneCatalog(req, _res, next) {
  req.marketplaceAssetType = "scene";
  next();
}

router.post("/auth/device/start", startLimit, deviceStart);
router.post("/auth/device/token", tokenLimit, deviceToken);
router.post("/auth/refresh", refreshLimit, refresh);
router.get("/release", releaseManifest);
router.delete("/auth/session", pluginBearerAuth, privateLimit, logout);
router.get("/me", pluginBearerAuth, privateLimit, me);
router.get("/account/events", pluginBearerAuth, privateLimit, pluginAccountEvents);
// Reuse web billing/jobs, but never accept a shared download token as ownership.
router.use("/getlink", pluginBearerAuth, privateLimit, (req, res, next) => {
  if (req.pluginSession.riskChallengeRequired) {
    return res.status(403).json({ code: "DEVICE_REAUTH_REQUIRED", message: "Sign in again to verify this device before using Getlink." });
  }
  req.query = { ...req.query, t: "" };
  return next();
});
router.post("/getlink/preview", downloadLimit, previewGetlink);
router.post("/getlink/jobs", downloadLimit, createJob);
router.get("/getlink/jobs/latest", latestJob);
router.get("/getlink/jobs/:id", getJob);
router.post("/getlink/jobs/:id/format", downloadLimit, chooseJobFormat);
router.post("/getlink/jobs/:id/retry", downloadLimit, retryJob);
router.post("/getlink/jobs/:id/cancel", cancelJob);
router.post("/getlink/jobs/:id/acknowledge", acknowledgeJob);
router.get("/getlink/history", getlinkHistory);
router.post("/getlink/redownload/:id", downloadLimit, prepareRedownload);
router.get("/getlink/download/:id", downloadLimit, downloadGetlink);
router.get("/getlink/preview-image/:id", downloadLimit, downloadGetlinkPreviewImage);
router.get("/getlink/preview-cache/:productId", downloadLimit, proxyCachedGetlinkPreviewImage);
router.get(
  "/models/:id/download-options",
  pluginBearerAuth,
  privateLimit,
  getDownloadOptions,
);
router.get(
  "/scenes/:id/download-options",
  pluginBearerAuth,
  privateLimit,
  sceneCatalog,
  getDownloadOptions,
);
router.get(
  "/download/session/:id/file",
  pluginBearerAuth,
  downloadLimit,
  downloadSessionFile,
);
router.post(
  "/models/:id/download-session",
  pluginBearerAuth,
  downloadLimit,
  pluginDownloadChallenge,
  createDownloadSession,
);
router.post(
  "/scenes/:id/download-session",
  pluginBearerAuth,
  downloadLimit,
  sceneCatalog,
  pluginDownloadChallenge,
  createDownloadSession,
);

export default router;

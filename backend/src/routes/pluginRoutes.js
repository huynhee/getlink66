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
import { pluginDownloadChallenge } from "../middleware/pluginDownloadChallenge.js";

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

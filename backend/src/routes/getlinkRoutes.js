import { Router } from "express";
import {
  downloadGetlink,
  downloadGetlinkPreviewImage,
  getLink,
  getlinkHistory,
  inspectGetlink,
  prepareRedownload,
  previewGetlink,
  proxyCachedGetlinkPreviewImage,
} from "../controllers/getlinkController.js";
import {
  acknowledgeJob,
  cancelJob,
  chooseJobFormat,
  createJob,
  getJob,
  latestJob,
  retryJob,
} from "../controllers/getlinkJobController.js";
import { adminOnly } from "../middleware/adminOnly.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireNotBanned } from "../middleware/requireNotBanned.js";
import { createRateLimit } from "../middleware/rateLimit.js";

const router = Router();
const previewLimit = createRateLimit({ keyPrefix: "getlink-preview", windowMs: 60_000, max: 30 });
const getlinkLimit = createRateLimit({ keyPrefix: "getlink-create", windowMs: 60_000, max: 10 });
const downloadLimit = createRateLimit({ keyPrefix: "getlink-download", windowMs: 60_000, max: 30 });
const previewIpLimit = createRateLimit({
  keyPrefix: "getlink-preview-ip",
  windowMs: 60_000,
  max: Number(process.env.GETLINK_PREVIEW_IP_RATE_LIMIT || 180),
  keyGenerator: (req) => req.ip,
});
const getlinkIpLimit = createRateLimit({
  keyPrefix: "getlink-create-ip",
  windowMs: 60_000,
  max: Number(process.env.GETLINK_CREATE_IP_RATE_LIMIT || 60),
  keyGenerator: (req) => req.ip,
});

router.post("/getlink/preview", requireAuth, requireNotBanned, previewLimit, previewIpLimit, previewGetlink);
router.post("/getlink/inspect", requireAuth, adminOnly, previewLimit, inspectGetlink);
router.post("/getlink/jobs", requireAuth, requireNotBanned, getlinkLimit, getlinkIpLimit, createJob);
router.get("/getlink/jobs/latest", requireAuth, latestJob);
router.get("/getlink/jobs/:id", requireAuth, getJob);
router.post("/getlink/jobs/:id/format", requireAuth, requireNotBanned, getlinkLimit, chooseJobFormat);
router.post("/getlink/jobs/:id/retry", requireAuth, requireNotBanned, getlinkLimit, retryJob);
router.post("/getlink/jobs/:id/cancel", requireAuth, cancelJob);
router.post("/getlink/jobs/:id/acknowledge", requireAuth, acknowledgeJob);
router.post("/getlink", requireAuth, requireNotBanned, getlinkLimit, getlinkIpLimit, getLink);
router.post("/getlink/redownload/:id", requireAuth, requireNotBanned, getlinkLimit, getlinkIpLimit, prepareRedownload);
router.get("/getlink/download/:id", downloadLimit, downloadGetlink);
router.get("/getlink/preview-image/:id", downloadLimit, downloadGetlinkPreviewImage);
router.get("/getlink/preview-cache/:productId", requireAuth, downloadLimit, proxyCachedGetlinkPreviewImage);
router.get("/getlink/history", requireAuth, getlinkHistory);

export default router;

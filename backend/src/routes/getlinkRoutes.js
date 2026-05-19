import { Router } from "express";
import { downloadGetlink, getLink, getlinkHistory, inspectGetlink, previewGetlink } from "../controllers/getlinkController.js";
import { adminOnly } from "../middleware/adminOnly.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { createRateLimit } from "../middleware/rateLimit.js";

const router = Router();
const previewLimit = createRateLimit({ keyPrefix: "getlink-preview", windowMs: 60_000, max: 30 });
const getlinkLimit = createRateLimit({ keyPrefix: "getlink-create", windowMs: 60_000, max: 10 });
const downloadLimit = createRateLimit({ keyPrefix: "getlink-download", windowMs: 60_000, max: 30 });

router.post("/getlink/preview", requireAuth, previewLimit, previewGetlink);
router.post("/getlink/inspect", requireAuth, adminOnly, previewLimit, inspectGetlink);
router.post("/getlink", requireAuth, getlinkLimit, getLink);
router.get("/getlink/download/:id", downloadLimit, downloadGetlink);
router.get("/getlink/history", requireAuth, getlinkHistory);

export default router;

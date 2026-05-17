import { Router } from "express";
import { getPublishedGuide, listPublishedGuides } from "../controllers/guideController.js";

const router = Router();

router.get("/guides", listPublishedGuides);
router.get("/guides/:slug", getPublishedGuide);

export default router;

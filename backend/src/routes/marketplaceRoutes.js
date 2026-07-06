import { Router } from "express";
import {
  createDownloadSession,
  downloadSessionFile,
  getMarketplaceModel,
  listMarketplaceCategories,
  listMarketplaceFilters,
  listMarketplaceModels,
  searchMarketplaceByImage,
  streamMarketplaceCover,
  streamMarketplacePreview,
} from "../controllers/marketplaceController.js";
import { createRateLimit } from "../middleware/rateLimit.js";

const router = Router();
const downloadSessionLimit = createRateLimit({
  keyPrefix: "marketplace-download-session",
  windowMs: 60_000,
  max: 30,
});
const imageSearchLimit = createRateLimit({
  keyPrefix: "marketplace-image-search",
  windowMs: 60_000,
  max: 20,
});

router.get("/marketplace/categories", listMarketplaceCategories);
router.get("/marketplace/filters", listMarketplaceFilters);
router.get("/marketplace/models", listMarketplaceModels);
router.post("/marketplace/image-search", imageSearchLimit, searchMarketplaceByImage);
router.get("/marketplace/models/:id/cover", streamMarketplaceCover);
router.get("/marketplace/models/:id/preview/:index", streamMarketplacePreview);
router.get("/marketplace/models/:slug", getMarketplaceModel);
router.post("/marketplace/models/:id/download-session", downloadSessionLimit, createDownloadSession);
router.post("/plugin/models/:id/download-session", downloadSessionLimit, createDownloadSession);
router.get("/download/session/:id/file", downloadSessionFile);

export default router;

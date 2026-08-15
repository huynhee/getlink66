import { Router } from "express";
import {
  createDownloadSession,
  downloadSessionFile,
  getMarketplaceModel,
  listMarketplaceHomeRecommendations,
  listMarketplaceModelRecommendations,
  listMarketplaceCategories,
  listMarketplaceFilters,
  listMarketplaceModels,
  listMarketplaceSearchSuggestions,
  searchMarketplaceByImage,
  streamMarketplaceCover,
  streamMarketplacePreview,
} from "../controllers/marketplaceController.js";
import { createRateLimit } from "../middleware/rateLimit.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireNotBanned } from "../middleware/requireNotBanned.js";
import { exportMarketplaceTaxonomy } from "../controllers/marketplaceTaxonomyExportController.js";
import {
  createMarketplaceReport,
  getMarketplaceReportStatus,
} from "../controllers/marketplaceReportController.js";
import { createMarketplaceBehavior } from "../controllers/marketplaceBehaviorController.js";

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
const marketplaceReportLimit = createRateLimit({
  keyPrefix: "marketplace-report",
  windowMs: 10 * 60_000,
  max: 10,
  keyGenerator: (req) => req.user?._id || req.ip,
});
const marketplaceBehaviorLimit = createRateLimit({
  keyPrefix: "marketplace-behavior",
  windowMs: 60_000,
  max: 120,
  keyGenerator: (req) => req.user?._id || req.ip,
});

function sceneCatalog(req, _res, next) {
  req.marketplaceAssetType = "scene";
  next();
}

router.get("/marketplace/categories", listMarketplaceCategories);
router.get("/marketplace/taxonomy/export", exportMarketplaceTaxonomy);
router.get("/marketplace/recommendations/home", listMarketplaceHomeRecommendations);
router.post("/marketplace/behavior", marketplaceBehaviorLimit, createMarketplaceBehavior);
router.get("/marketplace/filters", listMarketplaceFilters);
router.get("/marketplace/models", listMarketplaceModels);
router.get("/marketplace/search/suggestions", listMarketplaceSearchSuggestions);
router.post("/marketplace/image-search", imageSearchLimit, searchMarketplaceByImage);
router.get("/marketplace/scenes/categories", sceneCatalog, listMarketplaceCategories);
router.get("/marketplace/scenes/filters", sceneCatalog, listMarketplaceFilters);
router.get("/marketplace/scenes", sceneCatalog, listMarketplaceModels);
router.get("/marketplace/scenes/search/suggestions", sceneCatalog, listMarketplaceSearchSuggestions);
router.post("/marketplace/scenes/image-search", sceneCatalog, imageSearchLimit, searchMarketplaceByImage);
router.get("/marketplace/scenes/:id/cover", sceneCatalog, streamMarketplaceCover);
router.get("/marketplace/scenes/:id/preview/:index", sceneCatalog, streamMarketplacePreview);
router.get("/marketplace/scenes/:slug/recommendations", sceneCatalog, listMarketplaceModelRecommendations);
router.get("/marketplace/scenes/:slug", sceneCatalog, getMarketplaceModel);
router.get("/marketplace/scenes/:id/report-status", requireAuth, requireNotBanned, sceneCatalog, getMarketplaceReportStatus);
router.post("/marketplace/scenes/:id/reports", requireAuth, requireNotBanned, sceneCatalog, marketplaceReportLimit, createMarketplaceReport);
router.post("/marketplace/scenes/:id/download-session", requireAuth, requireNotBanned, sceneCatalog, downloadSessionLimit, createDownloadSession);
router.get("/marketplace/models/:id/cover", streamMarketplaceCover);
router.get("/marketplace/models/:id/preview/:index", streamMarketplacePreview);
router.get("/marketplace/models/:slug/recommendations", listMarketplaceModelRecommendations);
router.get("/marketplace/models/:slug", getMarketplaceModel);
router.get("/marketplace/models/:id/report-status", requireAuth, requireNotBanned, getMarketplaceReportStatus);
router.post("/marketplace/models/:id/reports", requireAuth, requireNotBanned, marketplaceReportLimit, createMarketplaceReport);
router.post("/marketplace/models/:id/download-session", requireAuth, requireNotBanned, downloadSessionLimit, createDownloadSession);
router.get("/download/session/:id/file", requireAuth, requireNotBanned, downloadSessionFile);

export default router;

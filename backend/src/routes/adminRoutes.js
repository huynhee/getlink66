import { Router } from "express";
import { 
  adminAddCredit, 
  adminSetCredit,
  banUser,
  getOverview,
  createVoucher, 
  updateVoucher,
  listVouchers,
  deleteVoucher,
  listUsers, 
  saveCookie,
  unbanUser,
  cookiePoolStatus,
  testCookie,
  listCookies,
  listGetlinkRecords,
  listTopupRecords,
  listSystemLogs,
  deleteCookie,
  testSavedCookie,
  listTopupPackages,
  createTopupPackage,
  updateTopupPackage,
  reorderTopupPackages,
  deleteTopupPackage,
  listReferrals,
} from "../controllers/adminController.js";
import {
  adminAdjustUserPro,
  adminApproveMembershipOrder,
  adminApproveTopup,
  adminCancelMembershipOrder,
  adminCancelTopup,
  adminCreateMembershipPlan,
  adminDashboard,
  adminDeleteMembershipPlan,
  adminListMembershipPlans,
  adminReorderMembershipPlans,
  adminTransactions,
  adminUpdateMembershipPlan,
  adminUserProfile,
  adminUserQuota,
  adminUserTimeline,
} from "../controllers/adminV1Controller.js";
import {
  adminAttachMarketplaceAssets,
  adminAttachMarketplaceFile,
  adminBulkMarketplaceModels,
  adminCleanupMarketplaceRaw,
  adminImportDriveFolderModels,
  adminImport3dskyModel,
  adminListMarketplaceDownloadSessions,
  adminListMarketplaceDownloads,
  adminListMarketplaceModels,
  adminMarketplaceStats,
  adminMigrateMarketplaceDriveMetadata,
  adminPurgeMarketplaceAsset,
  adminReconcileMarketplaceDrive,
  adminRestoreMarketplaceAsset,
  adminRescanMarketplaceModelDriveFolder,
  adminStreamMarketplaceCover,
  adminStreamMarketplacePreview,
  adminSyncMarketplaceDriveFolder,
  adminTrashMarketplaceAsset,
  adminUpdateMarketplaceMetadata,
  adminUpdateMarketplaceModel,
  adminUpdateMarketplaceState,
  adminVerifyMarketplaceFile,
} from "../controllers/marketplaceAdminController.js";
import {
  adminMarketplaceDriveSyncState,
  adminRunMarketplaceDriveSync,
} from "../controllers/marketplaceSyncController.js";
import {
  adminCreateNotification,
  adminDeleteNotification,
  adminListNotifications,
  adminUpdateNotification
} from "../controllers/notificationController.js";
import {
  createAdminArticle,
  deleteAdminArticle,
  listAdminArticles,
  updateAdminArticle
} from "../controllers/guideController.js";
import { adminOnly } from "../middleware/adminOnly.js";
import { auditAdmin, listAuditLogs } from "../middleware/auditLog.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireNotBanned } from "../middleware/requireNotBanned.js";
import { createRateLimit } from "../middleware/rateLimit.js";
import {
  adminCreateMarketplaceCategory,
  adminCreateMarketplaceFilterOption,
  adminListMarketplaceTaxonomy,
  adminUpdateMarketplaceCategory,
  adminUpdateMarketplaceFilterOption,
} from "../controllers/marketplaceTaxonomyAdminController.js";
import { adminExportMarketplaceTaxonomy } from "../controllers/marketplaceTaxonomyExportController.js";
import {
  adminListMarketplaceReports,
  adminUpdateMarketplaceReport,
} from "../controllers/marketplaceReportController.js";
import { adminStorageHealth } from "../controllers/storageController.js";

const router = Router();
const adminWriteLimit = createRateLimit({ keyPrefix: "admin-write", windowMs: 60_000, max: 30, keyGenerator: (req) => req.user?._id || req.ip });

function sceneAdmin(req, _res, next) {
  req.marketplaceAssetType = "scene";
  next();
}

router.use(requireAuth, requireNotBanned, adminOnly);
router.get("/dashboard", adminDashboard);
router.get("/storage-health", adminStorageHealth);
router.get("/overview", getOverview);
router.get("/users", listUsers);
router.get("/users/:id/profile", adminUserProfile);
router.get("/users/:id/timeline", adminUserTimeline);
router.get("/users/:id/quota", adminUserQuota);
router.post("/users/:id/pro-adjust", adminWriteLimit, auditAdmin("ADJUST_USER_PRO"), adminAdjustUserPro);
router.post("/users/:id/ban", adminWriteLimit, auditAdmin("BAN_USER"), banUser);
router.post("/users/:id/unban", adminWriteLimit, auditAdmin("UNBAN_USER"), unbanUser);
router.get("/referrals", listReferrals);
router.get("/audit-logs", listAuditLogs);
router.get("/system-logs", listSystemLogs);
router.get("/getlinks", listGetlinkRecords);
router.get("/topups", listTopupRecords);
router.get("/transactions", adminTransactions);
router.post("/topups/:id/approve", adminWriteLimit, auditAdmin("APPROVE_TOPUP"), adminApproveTopup);
router.post("/topups/:id/cancel", adminWriteLimit, auditAdmin("CANCEL_TOPUP"), adminCancelTopup);
router.post("/membership-orders/:id/approve", adminWriteLimit, auditAdmin("APPROVE_MEMBERSHIP_ORDER"), adminApproveMembershipOrder);
router.post("/membership-orders/:id/cancel", adminWriteLimit, auditAdmin("CANCEL_MEMBERSHIP_ORDER"), adminCancelMembershipOrder);
router.post("/add-credit", adminWriteLimit, auditAdmin("ADD_CREDIT"), adminAddCredit);
router.post("/set-credit", adminWriteLimit, auditAdmin("SET_CREDIT"), adminSetCredit);
router.get("/cookies", listCookies);
router.get("/cookies/status", cookiePoolStatus);
router.post("/cookie", adminWriteLimit, auditAdmin("SAVE_COOKIE"), saveCookie);
router.post("/cookie/test", adminWriteLimit, testCookie);
router.post("/cookies/:id/test", adminWriteLimit, testSavedCookie);
router.delete("/cookies/:id", adminWriteLimit, auditAdmin("DELETE_COOKIE"), deleteCookie);
router.post("/voucher", adminWriteLimit, auditAdmin("CREATE_VOUCHER"), createVoucher);
router.get("/vouchers", listVouchers);
router.put("/vouchers/:id", adminWriteLimit, auditAdmin("UPDATE_VOUCHER"), updateVoucher);
router.delete("/vouchers/:id", adminWriteLimit, auditAdmin("ARCHIVE_OR_DELETE_VOUCHER"), deleteVoucher);

router.get("/notifications", adminListNotifications);
router.post("/notifications", adminWriteLimit, auditAdmin("CREATE_NOTIFICATION"), adminCreateNotification);
router.put("/notifications/:id", adminWriteLimit, auditAdmin("UPDATE_NOTIFICATION"), adminUpdateNotification);
router.delete("/notifications/:id", adminWriteLimit, auditAdmin("DELETE_NOTIFICATION"), adminDeleteNotification);

router.get("/topup-packages", listTopupPackages);
router.post("/topup-packages", adminWriteLimit, auditAdmin("CREATE_PACKAGE"), createTopupPackage);
router.post("/topup-packages/reorder", adminWriteLimit, auditAdmin("REORDER_PACKAGES"), reorderTopupPackages);
router.put("/topup-packages/:id", adminWriteLimit, auditAdmin("UPDATE_PACKAGE"), updateTopupPackage);
router.delete("/topup-packages/:id", adminWriteLimit, auditAdmin("DELETE_PACKAGE"), deleteTopupPackage);

router.get("/membership-plans", adminListMembershipPlans);
router.post("/membership-plans", adminWriteLimit, auditAdmin("CREATE_MEMBERSHIP_PLAN"), adminCreateMembershipPlan);
router.post("/membership-plans/reorder", adminWriteLimit, auditAdmin("REORDER_MEMBERSHIP_PLANS"), adminReorderMembershipPlans);
router.put("/membership-plans/:id", adminWriteLimit, auditAdmin("UPDATE_MEMBERSHIP_PLAN"), adminUpdateMembershipPlan);
router.delete("/membership-plans/:id", adminWriteLimit, auditAdmin("DELETE_MEMBERSHIP_PLAN"), adminDeleteMembershipPlan);

router.get("/marketplace/models", adminListMarketplaceModels);
router.get("/marketplace/models/:id/cover", adminStreamMarketplaceCover);
router.get("/marketplace/models/:id/preview/:index", adminStreamMarketplacePreview);
router.get("/marketplace/taxonomy", adminListMarketplaceTaxonomy);
router.get("/marketplace/taxonomy/export", adminExportMarketplaceTaxonomy);
router.post("/marketplace/categories", adminWriteLimit, auditAdmin("CREATE_MARKETPLACE_CATEGORY"), adminCreateMarketplaceCategory);
router.patch("/marketplace/categories/:id", adminWriteLimit, auditAdmin("UPDATE_MARKETPLACE_CATEGORY_LABEL"), adminUpdateMarketplaceCategory);
router.post("/marketplace/filter-options", adminWriteLimit, auditAdmin("CREATE_MARKETPLACE_FILTER_OPTION"), adminCreateMarketplaceFilterOption);
router.patch("/marketplace/filter-options/:id", adminWriteLimit, auditAdmin("UPDATE_MARKETPLACE_FILTER_LABEL"), adminUpdateMarketplaceFilterOption);
router.get("/marketplace/stats", adminMarketplaceStats);
router.get("/marketplace/downloads", adminListMarketplaceDownloads);
router.get("/marketplace/download-sessions", adminListMarketplaceDownloadSessions);
router.get("/marketplace/reports", adminListMarketplaceReports);
router.patch("/marketplace/reports/:id", adminWriteLimit, auditAdmin("UPDATE_MARKETPLACE_REPORT"), adminUpdateMarketplaceReport);
router.post("/marketplace/cleanup-raw", adminWriteLimit, auditAdmin("CLEANUP_MARKETPLACE_RAW"), adminCleanupMarketplaceRaw);
router.post("/marketplace/import-drive-folder", adminWriteLimit, auditAdmin("IMPORT_DRIVE_MARKETPLACE_FOLDER"), adminImportDriveFolderModels);
router.post("/marketplace/models/import-metadata", adminWriteLimit, auditAdmin("IMPORT_MARKETPLACE_METADATA"), adminImport3dskyModel);
router.post("/marketplace/models/import-3dsky", adminWriteLimit, auditAdmin("IMPORT_3DSKY_MODEL"), adminImport3dskyModel);
router.post("/marketplace/models/bulk", adminWriteLimit, auditAdmin("BULK_MARKETPLACE_MODELS"), adminBulkMarketplaceModels);
router.get("/marketplace/sync-state", adminMarketplaceDriveSyncState);
router.post("/marketplace/sync-run", adminWriteLimit, auditAdmin("RUN_MARKETPLACE_DRIVE_SYNC"), adminRunMarketplaceDriveSync);
router.put("/marketplace/models/:id", adminWriteLimit, auditAdmin("UPDATE_MARKETPLACE_MODEL"), adminUpdateMarketplaceModel);
router.put("/marketplace/models/:id/metadata", adminWriteLimit, auditAdmin("UPDATE_MARKETPLACE_DRIVE_METADATA"), adminUpdateMarketplaceMetadata);
router.patch("/marketplace/models/:id/state", adminWriteLimit, auditAdmin("UPDATE_MARKETPLACE_MODEL_STATE"), adminUpdateMarketplaceState);
router.post("/marketplace/models/:id/rescan-drive", adminWriteLimit, auditAdmin("RESCAN_MARKETPLACE_MODEL_DRIVE"), adminRescanMarketplaceModelDriveFolder);
router.post("/marketplace/models/:id/verify-file", adminWriteLimit, auditAdmin("VERIFY_MARKETPLACE_MODEL_FILE"), adminVerifyMarketplaceFile);
router.delete("/marketplace/models/:id", adminWriteLimit, auditAdmin("TRASH_MARKETPLACE_MODEL"), adminTrashMarketplaceAsset);
router.post("/marketplace/models/:id/restore", adminWriteLimit, auditAdmin("RESTORE_MARKETPLACE_MODEL"), adminRestoreMarketplaceAsset);
router.delete("/marketplace/models/:id/permanent", adminWriteLimit, auditAdmin("PURGE_MARKETPLACE_MODEL"), adminPurgeMarketplaceAsset);
router.post("/marketplace/drive/sync-folder", adminWriteLimit, auditAdmin("SYNC_MARKETPLACE_DRIVE_FOLDER"), adminSyncMarketplaceDriveFolder);
router.post("/marketplace/drive/reconcile", adminWriteLimit, auditAdmin("RECONCILE_MARKETPLACE_DRIVE"), adminReconcileMarketplaceDrive);
router.post("/marketplace/drive/migrate-metadata", adminWriteLimit, auditAdmin("MIGRATE_MARKETPLACE_DRIVE_METADATA"), adminMigrateMarketplaceDriveMetadata);
router.post("/marketplace/models/:id/attach-file", adminWriteLimit, auditAdmin("ATTACH_MARKETPLACE_FILE"), adminAttachMarketplaceFile);
router.post("/marketplace/models/:id/attach-assets", adminWriteLimit, auditAdmin("ATTACH_MARKETPLACE_ASSETS"), adminAttachMarketplaceAssets);

router.get("/marketplace/scenes", sceneAdmin, adminListMarketplaceModels);
router.get("/marketplace/scenes/:id/cover", sceneAdmin, adminStreamMarketplaceCover);
router.get("/marketplace/scenes/:id/preview/:index", sceneAdmin, adminStreamMarketplacePreview);
router.get("/marketplace/scenes/stats", sceneAdmin, adminMarketplaceStats);
router.post("/marketplace/scenes/bulk", sceneAdmin, adminWriteLimit, auditAdmin("BULK_MARKETPLACE_SCENES"), adminBulkMarketplaceModels);
router.get("/marketplace/scenes/sync-state", sceneAdmin, adminMarketplaceDriveSyncState);
router.post("/marketplace/scenes/sync-run", sceneAdmin, adminWriteLimit, auditAdmin("RUN_SCENES_DRIVE_SYNC"), adminRunMarketplaceDriveSync);
router.post("/marketplace/scenes/drive/sync-folder", sceneAdmin, adminWriteLimit, auditAdmin("SYNC_SCENE_DRIVE_FOLDER"), adminSyncMarketplaceDriveFolder);
router.post("/marketplace/scenes/drive/reconcile", sceneAdmin, adminWriteLimit, auditAdmin("RECONCILE_SCENES_DRIVE"), adminReconcileMarketplaceDrive);
router.post("/marketplace/scenes/drive/migrate-metadata", sceneAdmin, adminWriteLimit, auditAdmin("MIGRATE_SCENE_DRIVE_METADATA"), adminMigrateMarketplaceDriveMetadata);
router.put("/marketplace/scenes/:id", sceneAdmin, adminWriteLimit, auditAdmin("UPDATE_MARKETPLACE_SCENE"), adminUpdateMarketplaceModel);
router.put("/marketplace/scenes/:id/metadata", sceneAdmin, adminWriteLimit, auditAdmin("UPDATE_SCENE_DRIVE_METADATA"), adminUpdateMarketplaceMetadata);
router.patch("/marketplace/scenes/:id/state", sceneAdmin, adminWriteLimit, auditAdmin("UPDATE_MARKETPLACE_SCENE_STATE"), adminUpdateMarketplaceState);
router.post("/marketplace/scenes/:id/rescan-drive", sceneAdmin, adminWriteLimit, auditAdmin("RESCAN_SCENE_DRIVE"), adminRescanMarketplaceModelDriveFolder);
router.post("/marketplace/scenes/:id/verify-file", sceneAdmin, adminWriteLimit, auditAdmin("VERIFY_SCENE_FILE"), adminVerifyMarketplaceFile);
router.delete("/marketplace/scenes/:id", sceneAdmin, adminWriteLimit, auditAdmin("TRASH_MARKETPLACE_SCENE"), adminTrashMarketplaceAsset);
router.post("/marketplace/scenes/:id/restore", sceneAdmin, adminWriteLimit, auditAdmin("RESTORE_MARKETPLACE_SCENE"), adminRestoreMarketplaceAsset);
router.delete("/marketplace/scenes/:id/permanent", sceneAdmin, adminWriteLimit, auditAdmin("PURGE_MARKETPLACE_SCENE"), adminPurgeMarketplaceAsset);
router.post("/marketplace/scenes/:id/attach-file", sceneAdmin, adminWriteLimit, auditAdmin("ATTACH_SCENE_FILE"), adminAttachMarketplaceFile);
router.post("/marketplace/scenes/:id/attach-assets", sceneAdmin, adminWriteLimit, auditAdmin("ATTACH_SCENE_ASSETS"), adminAttachMarketplaceAssets);

router.get("/articles", listAdminArticles);
router.post("/articles", adminWriteLimit, auditAdmin("CREATE_ARTICLE"), createAdminArticle);
router.put("/articles/:id", adminWriteLimit, auditAdmin("UPDATE_ARTICLE"), updateAdminArticle);
router.delete("/articles/:id", adminWriteLimit, auditAdmin("DELETE_ARTICLE"), deleteAdminArticle);

export default router;

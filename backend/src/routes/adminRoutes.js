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
  getUserCreditHistory,
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
import {
  get3D66WarpStatus,
  test3D66Warp,
} from "../controllers/3d66ProxyController.js";
import { adminOnly } from "../middleware/adminOnly.js";
import { auditAdmin, listAuditLogs } from "../middleware/auditLog.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { createRateLimit } from "../middleware/rateLimit.js";

const router = Router();
const adminWriteLimit = createRateLimit({ keyPrefix: "admin-write", windowMs: 60_000, max: 30, keyGenerator: (req) => req.user?._id || req.ip });

router.use(requireAuth, adminOnly);
router.get("/overview", getOverview);
router.get("/users", listUsers);
router.get("/users/:id/credit-history", getUserCreditHistory);
router.post("/users/:id/ban", adminWriteLimit, auditAdmin("BAN_USER"), banUser);
router.post("/users/:id/unban", adminWriteLimit, auditAdmin("UNBAN_USER"), unbanUser);
router.get("/referrals", listReferrals);
router.get("/audit-logs", listAuditLogs);
router.get("/system-logs", listSystemLogs);
router.get("/getlinks", listGetlinkRecords);
router.get("/topups", listTopupRecords);
router.post("/add-credit", adminWriteLimit, auditAdmin("ADD_CREDIT"), adminAddCredit);
router.post("/set-credit", adminWriteLimit, auditAdmin("SET_CREDIT"), adminSetCredit);
router.get("/cookies", listCookies);
router.get("/cookies/status", cookiePoolStatus);
router.get("/warp/status", get3D66WarpStatus);
router.post("/warp/test", adminWriteLimit, test3D66Warp);
router.post("/cookie", adminWriteLimit, auditAdmin("SAVE_COOKIE"), saveCookie);
router.post("/cookie/test", adminWriteLimit, testCookie);
router.post("/cookies/:id/test", adminWriteLimit, testSavedCookie);
router.delete("/cookies/:id", adminWriteLimit, auditAdmin("DELETE_COOKIE"), deleteCookie);
router.post("/voucher", adminWriteLimit, auditAdmin("CREATE_VOUCHER"), createVoucher);
router.get("/vouchers", listVouchers);
router.put("/vouchers/:id", adminWriteLimit, auditAdmin("UPDATE_VOUCHER"), updateVoucher);
router.delete("/vouchers/:id", adminWriteLimit, auditAdmin("DELETE_VOUCHER"), deleteVoucher);

router.get("/notifications", adminListNotifications);
router.post("/notifications", adminWriteLimit, auditAdmin("CREATE_NOTIFICATION"), adminCreateNotification);
router.put("/notifications/:id", adminWriteLimit, auditAdmin("UPDATE_NOTIFICATION"), adminUpdateNotification);
router.delete("/notifications/:id", adminWriteLimit, auditAdmin("DELETE_NOTIFICATION"), adminDeleteNotification);

router.get("/topup-packages", listTopupPackages);
router.post("/topup-packages", adminWriteLimit, auditAdmin("CREATE_PACKAGE"), createTopupPackage);
router.post("/topup-packages/reorder", adminWriteLimit, auditAdmin("REORDER_PACKAGES"), reorderTopupPackages);
router.put("/topup-packages/:id", adminWriteLimit, auditAdmin("UPDATE_PACKAGE"), updateTopupPackage);
router.delete("/topup-packages/:id", adminWriteLimit, auditAdmin("DELETE_PACKAGE"), deleteTopupPackage);

router.get("/articles", listAdminArticles);
router.post("/articles", adminWriteLimit, auditAdmin("CREATE_ARTICLE"), createAdminArticle);
router.put("/articles/:id", adminWriteLimit, auditAdmin("UPDATE_ARTICLE"), updateAdminArticle);
router.delete("/articles/:id", adminWriteLimit, auditAdmin("DELETE_ARTICLE"), deleteAdminArticle);

export default router;

import { Router } from "express";
import { 
  adminAddCredit, 
  adminSetCredit,
  getOverview,
  createVoucher, 
  listVouchers,
  deleteVoucher,
  listUsers, 
  saveCookie,
  testCookie,
  listCookies,
  deleteCookie,
  testSavedCookie,
  listTopupPackages,
  createTopupPackage,
  updateTopupPackage,
  reorderTopupPackages,
  deleteTopupPackage,
  listPendingTopups,
  approveTopup,
  rejectTopup
} from "../controllers/adminController.js";
import {
  createAdminArticle,
  deleteAdminArticle,
  listAdminArticles,
  updateAdminArticle
} from "../controllers/guideController.js";
import { adminOnly } from "../middleware/adminOnly.js";
import { auditAdmin, listAuditLogs } from "../middleware/auditLog.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { createRateLimit } from "../middleware/rateLimit.js";

const router = Router();
const adminWriteLimit = createRateLimit({ keyPrefix: "admin-write", windowMs: 60_000, max: 30, keyGenerator: (req) => req.user?._id || req.ip });

router.use(requireAuth, adminOnly);
router.get("/overview", getOverview);
router.get("/users", listUsers);
router.get("/audit-logs", listAuditLogs);
router.post("/add-credit", adminWriteLimit, auditAdmin("ADD_CREDIT"), adminAddCredit);
router.post("/set-credit", adminWriteLimit, auditAdmin("SET_CREDIT"), adminSetCredit);
router.get("/cookies", listCookies);
router.post("/cookie", adminWriteLimit, auditAdmin("SAVE_COOKIE"), saveCookie);
router.post("/cookie/test", adminWriteLimit, testCookie);
router.post("/cookies/:id/test", adminWriteLimit, testSavedCookie);
router.delete("/cookies/:id", adminWriteLimit, auditAdmin("DELETE_COOKIE"), deleteCookie);
router.post("/voucher", adminWriteLimit, auditAdmin("CREATE_VOUCHER"), createVoucher);
router.get("/vouchers", listVouchers);
router.delete("/vouchers/:id", adminWriteLimit, auditAdmin("DELETE_VOUCHER"), deleteVoucher);

router.get("/topup-packages", listTopupPackages);
router.post("/topup-packages", adminWriteLimit, auditAdmin("CREATE_PACKAGE"), createTopupPackage);
router.post("/topup-packages/reorder", adminWriteLimit, auditAdmin("REORDER_PACKAGES"), reorderTopupPackages);
router.put("/topup-packages/:id", adminWriteLimit, auditAdmin("UPDATE_PACKAGE"), updateTopupPackage);
router.delete("/topup-packages/:id", adminWriteLimit, auditAdmin("DELETE_PACKAGE"), deleteTopupPackage);

router.get("/topups/pending", listPendingTopups);
router.post("/topups/:id/approve", adminWriteLimit, auditAdmin("APPROVE_TOPUP"), approveTopup);
router.post("/topups/:id/reject", adminWriteLimit, auditAdmin("REJECT_TOPUP"), rejectTopup);

router.get("/articles", listAdminArticles);
router.post("/articles", adminWriteLimit, auditAdmin("CREATE_ARTICLE"), createAdminArticle);
router.put("/articles/:id", adminWriteLimit, auditAdmin("UPDATE_ARTICLE"), updateAdminArticle);
router.delete("/articles/:id", adminWriteLimit, auditAdmin("DELETE_ARTICLE"), deleteAdminArticle);

export default router;

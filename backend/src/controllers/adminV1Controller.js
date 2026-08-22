import User from "../models/User.js";
import Topup from "../models/Topup.js";
import Getlink from "../models/Getlink.js";
import MembershipOrder from "../models/MembershipOrder.js";
import MembershipPlan from "../models/MembershipPlan.js";
import MarketplaceModel from "../models/MarketplaceModel.js";
import ModelDownload from "../models/ModelDownload.js";
import DownloadSession from "../models/DownloadSession.js";
import DailyDownloadQuota from "../models/DailyDownloadQuota.js";
import DailyImageSearchQuota from "../models/DailyImageSearchQuota.js";
import SystemLog from "../models/SystemLog.js";
import AuditLog from "../models/AuditLog.js";
import MarketplaceReport from "../models/MarketplaceReport.js";
import { approvePendingTopup } from "../utils/topupApprovalService.js";
import { approvePendingMembershipOrder, isProActive, nextVietnamReset, normalizeProUntil, vietnamDayKey } from "../utils/membershipService.js";
import { buildUserTimeline } from "../utils/timelineService.js";
import { isSafeId, limitedString, rejectUnknownKeys } from "../utils/validators.js";
import { hydrateAtlasUserField } from "../utils/crossDatabaseHydration.js";
import { marketplacePublicDeletionQuery } from "../utils/marketplaceDeletionService.js";

const ADMIN_PAGE_SIZE = 20;

function safePage(value) {
  const number = Number(value || 1);
  return Number.isInteger(number) && number > 0 ? number : 1;
}

function safeLimit(value, fallback = ADMIN_PAGE_SIZE, max = 100) {
  const number = Number(value || fallback);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(max, Math.floor(number));
}

function escapedRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

export function adminDashboardDateRange(query = {}, now = new Date()) {
  const explicitFrom = parseDate(query.from);
  const explicitTo = parseDate(query.to);
  if (explicitFrom || explicitTo) {
    return {
      from: explicitFrom || new Date(0),
      to: explicitTo || now,
    };
  }
  const period = String(query.period || "week");
  if (period === "day") {
    const nextReset = nextVietnamReset(now);
    return {
      from: new Date(nextReset.getTime() - 24 * 60 * 60 * 1000),
      to: new Date(nextReset.getTime() - 1),
    };
  }
  const days = period === "day" ? 1 : period === "month" ? 30 : 7;
  return {
    from: new Date(now.getTime() - days * 24 * 60 * 60 * 1000),
    to: now,
  };
}

function dateRange(req) {
  return adminDashboardDateRange(req.query, new Date());
}

function rangeQuery(field, range) {
  return { [field]: { $gte: range.from, $lte: range.to } };
}

function publicUser(user) {
  if (!user) return null;
  const doc = user.toObject ? user.toObject() : user;
  return {
    _id: doc._id,
    name: doc.name || "",
    email: doc.email || "",
    avatar: doc.avatar || "",
    role: doc.role || "user",
    credit: Number(doc.credit || 0),
    isBanned: Boolean(doc.isBanned),
    banReason: doc.banReason || "",
    bannedAt: doc.bannedAt || null,
    proUntil: doc.proUntil || null,
    proActivatedAt: doc.proActivatedAt || null,
    proPlanId: doc.proPlanId || null,
    proDailyDownloadLimit: Number(doc.proDailyDownloadLimit || 100),
    isPro: isProActive(doc),
    referralCode: doc.referralCode || "",
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function transactionUser(user) {
  if (!user) return null;
  return {
    _id: user._id,
    name: user.name || "",
    email: user.email || "",
    avatar: user.avatar || "",
    credit: Number(user.credit || 0),
    role: user.role || "user",
  };
}

function topupTransaction(item) {
  return {
    id: `credit:${item._id}`,
    kind: "credit",
    rawId: item._id,
    user: transactionUser(item.userId),
    title: item.packageId?.name || (item.type === "manual" ? "Admin credit adjustment" : "Credit topup"),
    amount: Number(item.amount || 0),
    originalAmount: Number(item.originalAmount || item.amount || 0),
    discountAmount: Number(item.discountAmount || 0),
    credit: Number(item.credit || 0),
    isManualAdjustment: item.type === "manual",
    manualBalanceBefore: item.manualBalanceBefore == null ? null : Number(item.manualBalanceBefore),
    manualBalanceAfter: item.manualBalanceAfter == null ? null : Number(item.manualBalanceAfter),
    status: item.status,
    paymentCode: item.paymentCode || "",
    gatewayProvider: item.gatewayProvider || item.type || "",
    gatewayTransactionId: item.gatewayTransactionId || "",
    voucherCode: item.voucherCode || "",
    rejectionReason: item.rejectionReason || "",
    createdAt: item.createdAt,
    paidAt: item.paidAt || null,
    canceledAt: item.canceledAt || null,
    expiresAt: item.expiresAt || null,
  };
}

function membershipTransaction(item) {
  return {
    id: `pro:${item._id}`,
    kind: "pro",
    rawId: item._id,
    user: transactionUser(item.userId),
    title: item.isQuotaAddon ? `Daily add-on - ${item.planName || item.planCode}` : item.planName || item.planCode || "Pro",
    amount: Number(item.amount || 0),
    originalAmount: Number(item.originalAmount || item.amount || 0),
    discountAmount: Number(item.discountAmount || 0),
    credit: 0,
    status: item.status,
    paymentCode: item.paymentCode || "",
    gatewayProvider: item.gatewayProvider || "",
    gatewayTransactionId: item.gatewayTransactionId || "",
    voucherCode: item.voucherCode || "",
    rejectionReason: item.rejectionReason || "",
    durationDays: Number(item.durationDays || 0),
    dailyDownloadLimit: Number(item.dailyDownloadLimit || 0),
    activatedUntil: item.activatedUntil || null,
    isQuotaAddon: Boolean(item.isQuotaAddon),
    quotaBoostAmount: Number(item.quotaBoostAmount || 0),
    createdAt: item.createdAt,
    paidAt: item.paidAt || null,
    canceledAt: item.canceledAt || null,
    expiresAt: item.expiresAt || null,
  };
}

function transactionDate(item) {
  return new Date(item.paidAt || item.createdAt || 0).getTime();
}

async function userIdsForSearch(search) {
  const text = String(search || "").trim();
  if (!text) return null;
  const regex = new RegExp(escapedRegex(text), "i");
  const users = await User.find({ $or: [{ email: regex }, { name: regex }] }).select("_id").limit(500).lean();
  return users.map((user) => user._id);
}

export async function adminDashboard(req, res, next) {
  try {
    const range = dateRange(req);
    const approvedTopupQuery = { status: "approved", ...rangeQuery("paidAt", range) };
    const approvedProQuery = { status: "approved", ...rangeQuery("paidAt", range) };
    const [
      creditRevenueRows,
      proRevenueRows,
      pendingCredit,
      pendingPro,
      newUsers,
      totalUsers,
      activePro,
      getlinks,
      marketplaceDownloads,
      modelDownloads,
      sceneDownloads,
      missingModels,
      missingScenes,
      incompleteModels,
      incompleteScenes,
      readyModels,
      readyScenes,
      sessions,
      activeMarketplaceReports,
      reportedModelIds,
      reportedSceneIds,
      recentSystemLogs,
      recentAuditLogs,
    ] = await Promise.all([
      Topup.find(approvedTopupQuery).select("amount credit paidAt createdAt").lean(),
      MembershipOrder.find(approvedProQuery).select("amount paidAt createdAt").lean(),
      Topup.countDocuments({ status: "pending" }),
      MembershipOrder.countDocuments({ status: "pending" }),
      User.countDocuments(rangeQuery("createdAt", range)),
      User.countDocuments({}),
      User.countDocuments({ proUntil: { $gt: new Date() } }),
      Getlink.countDocuments(rangeQuery("createdAt", range)),
      ModelDownload.countDocuments(rangeQuery("createdAt", range)),
      ModelDownload.countDocuments({ assetType: { $ne: "scene" }, ...rangeQuery("createdAt", range) }),
      ModelDownload.countDocuments({ assetType: "scene", ...rangeQuery("createdAt", range) }),
      MarketplaceModel.countDocuments({ assetType: "model", fileStatus: { $ne: "ready" }, ...marketplacePublicDeletionQuery() }),
      MarketplaceModel.countDocuments({ assetType: "scene", fileStatus: { $ne: "ready" }, ...marketplacePublicDeletionQuery() }),
      MarketplaceModel.countDocuments({ assetType: "model", metadataStatus: "incomplete", ...marketplacePublicDeletionQuery() }),
      MarketplaceModel.countDocuments({ assetType: "scene", metadataStatus: "incomplete", ...marketplacePublicDeletionQuery() }),
      MarketplaceModel.countDocuments({ assetType: "model", fileStatus: "ready", ...marketplacePublicDeletionQuery() }),
      MarketplaceModel.countDocuments({ assetType: "scene", fileStatus: "ready", ...marketplacePublicDeletionQuery() }),
      DownloadSession.countDocuments(rangeQuery("createdAt", range)),
      MarketplaceReport.countDocuments({ isActive: true }),
      MarketplaceReport.distinct("modelId", { assetType: "model", isActive: true }),
      MarketplaceReport.distinct("modelId", { assetType: "scene", isActive: true }),
      SystemLog.find().sort({ createdAt: -1 }).limit(8).lean(),
      AuditLog.find().sort({ createdAt: -1 }).limit(8).lean(),
    ]);
    await hydrateAtlasUserField(recentAuditLogs, "actor", "name email");
    const creditRevenue = creditRevenueRows.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const proRevenue = proRevenueRows.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const creditIssued = creditRevenueRows.reduce((sum, item) => sum + Number(item.credit || 0), 0);
    res.json({
      dashboard: {
        range,
        kpis: {
          creditRevenue,
          proRevenue,
          totalRevenue: creditRevenue + proRevenue,
          pendingPayments: pendingCredit + pendingPro,
          pendingCredit,
          pendingPro,
          newUsers,
          totalUsers,
          activePro,
          creditIssued,
          getlinks,
          marketplaceDownloads,
          modelDownloads,
          sceneDownloads,
          missingModels,
          missingScenes,
          incompleteModels,
          incompleteScenes,
          readyModels,
          readyScenes,
          sessions,
          activeMarketplaceReports,
          reportedModels: reportedModelIds.length,
          reportedScenes: reportedSceneIds.length,
        },
        recentSystemLogs,
        recentAuditLogs,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function adminUserProfile(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) return res.status(400).json({ message: "Invalid user id" });
    const user = await User.findById(req.params.id).populate("proPlanId", "code name price durationDays").lean();
    if (!user) return res.status(404).json({ message: "User not found" });
    const [getlinks, topups, proOrders, modelDownloads, sceneDownloads, auditLogs] = await Promise.all([
      Getlink.countDocuments({ userId: user._id }),
      Topup.countDocuments({ userId: user._id }),
      MembershipOrder.countDocuments({ userId: user._id }),
      ModelDownload.countDocuments({ userId: user._id, assetType: { $ne: "scene" } }),
      ModelDownload.countDocuments({ userId: user._id, assetType: "scene" }),
      AuditLog.find({ $or: [{ target: String(user._id) }, { targetId: String(user._id) }] })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
    ]);
    await hydrateAtlasUserField(auditLogs, "actor", "name email");
    res.json({
      user: publicUser(user),
      stats: { getlinks, topups, proOrders, modelDownloads, sceneDownloads },
      auditLogs,
    });
  } catch (error) {
    next(error);
  }
}

export async function adminUserTimeline(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) return res.status(400).json({ message: "Invalid user id" });
    const user = await User.findById(req.params.id).select("_id").lean();
    if (!user) return res.status(404).json({ message: "User not found" });
    const data = await buildUserTimeline({
      userId: user._id,
      type: req.query.type,
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json(data);
  } catch (error) {
    next(error);
  }
}

export async function adminUserQuota(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) return res.status(400).json({ message: "Invalid user id" });
    const user = await User.findById(req.params.id).lean();
    if (!user) return res.status(404).json({ message: "User not found" });
    const dayKey = vietnamDayKey();
    const tier = isProActive(user) ? "member" : "free";
    const [downloadQuota, imageQuota] = await Promise.all([
      DailyDownloadQuota.findOne({ dayKey, userId: user._id, tier }).lean(),
      DailyImageSearchQuota.findOne({ dayKey, userId: user._id, tier: tier === "member" ? "member" : "free" }).lean(),
    ]);
    const baseDownloadLimit = tier === "member" ? Number(user.proDailyDownloadLimit || 100) : 5;
    const downloadLimit = baseDownloadLimit + Number(downloadQuota?.bonusLimit || 0);
    const imageLimit = tier === "member" ? 150 : 10;
    res.json({
      quota: {
        dayKey,
        tier,
        resetAt: nextVietnamReset(),
        downloads: {
          used: Number(downloadQuota?.count || 0),
          baseLimit: baseDownloadLimit,
          bonusLimit: Number(downloadQuota?.bonusLimit || 0),
          limit: downloadLimit,
          remaining: Math.max(0, downloadLimit - Number(downloadQuota?.count || 0)),
        },
        imageSearch: {
          used: Number(imageQuota?.count || 0),
          limit: imageLimit,
          remaining: Math.max(0, imageLimit - Number(imageQuota?.count || 0)),
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function adminAdjustUserPro(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) return res.status(400).json({ message: "Invalid user id" });
    const unknownKey = rejectUnknownKeys(req.body, ["proUntil", "proDailyDownloadLimit", "clearPro"]);
    if (unknownKey) return res.status(400).json({ message: "Invalid pro adjustment request" });
    const patch = {};
    if (req.body.clearPro) {
      patch.proUntil = null;
      patch.proPlanId = null;
      patch.proDailyDownloadLimit = 100;
    } else {
      if (req.body.proUntil !== undefined) {
        const proUntil = parseDate(req.body.proUntil);
        if (!proUntil) return res.status(400).json({ message: "Invalid Pro expiry" });
        patch.proUntil = normalizeProUntil(proUntil);
        patch.proActivatedAt = new Date();
      }
      if (req.body.proDailyDownloadLimit !== undefined) {
        const daily = Number(req.body.proDailyDownloadLimit);
        if (!Number.isInteger(daily) || daily < 0 || daily > 100000) {
          return res.status(400).json({ message: "Invalid daily download limit" });
        }
        patch.proDailyDownloadLimit = daily;
      }
    }
    const user = await User.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true });
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
}

export async function adminTransactions(req, res, next) {
  try {
    const kind = ["credit", "pro", "all"].includes(String(req.query.kind)) ? String(req.query.kind) : "all";
    const status = ["pending", "approved", "rejected"].includes(String(req.query.status)) ? String(req.query.status) : "";
    const page = safePage(req.query.page);
    const limit = safeLimit(req.query.limit);
    const search = String(req.query.search || "").trim();
    const userIds = await userIdsForSearch(search);
    const regex = search ? new RegExp(escapedRegex(search), "i") : null;
    const sourceLimit = page * limit;
    const tasks = [];
    const countTasks = [];

    if (kind === "all" || kind === "credit") {
      const query = {};
      if (status) query.status = status;
      if (regex) {
        query.$or = [
          { paymentCode: regex },
          { voucherCode: regex },
          { gatewayTransactionId: regex },
          ...(userIds?.length ? [{ userId: { $in: userIds } }] : []),
        ];
      }
      tasks.push(
        Topup.find(query)
          .sort({ createdAt: -1 })
          .limit(sourceLimit)
          .populate("userId", "name email avatar credit role")
          .populate("packageId", "name credit price badge")
          .lean()
          .then((items) => items.map(topupTransaction)),
      );
      countTasks.push(Topup.countDocuments(query));
    }

    if (kind === "all" || kind === "pro") {
      const query = {};
      if (status) query.status = status;
      if (regex) {
        query.$or = [
          { paymentCode: regex },
          { voucherCode: regex },
          { gatewayTransactionId: regex },
          { planName: regex },
          { planCode: regex },
          ...(userIds?.length ? [{ userId: { $in: userIds } }] : []),
        ];
      }
      tasks.push(
        MembershipOrder.find(query)
          .sort({ createdAt: -1 })
          .limit(sourceLimit)
          .populate("userId", "name email avatar credit role")
          .lean()
          .then((items) => items.map(membershipTransaction)),
      );
      countTasks.push(MembershipOrder.countDocuments(query));
    }

    const [sourceRows, sourceCounts] = await Promise.all([
      Promise.all(tasks),
      Promise.all(countTasks),
    ]);
    const rows = sourceRows.flat().sort((a, b) => transactionDate(b) - transactionDate(a));
    const total = sourceCounts.reduce((sum, count) => sum + Number(count || 0), 0);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePageNumber = Math.min(page, totalPages);
    const start = (safePageNumber - 1) * limit;
    res.json({
      transactions: rows.slice(start, start + limit),
      pagination: { page: safePageNumber, pageSize: limit, total, totalPages },
    });
  } catch (error) {
    next(error);
  }
}

export async function adminApproveTopup(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) return res.status(400).json({ message: "Invalid topup id" });
    const topup = await Topup.findOne({ _id: req.params.id, status: "pending" });
    if (!topup) return res.status(404).json({ message: "Pending topup not found" });
    const result = await approvePendingTopup(topup, { approvedByAdminId: req.user._id });
    if (!result) return res.status(409).json({ message: "Topup is no longer pending" });
    res.json({ topup: result.topup, user: result.user });
  } catch (error) {
    next(error);
  }
}

export async function adminCancelTopup(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) return res.status(400).json({ message: "Invalid topup id" });
    const topup = await Topup.findOneAndUpdate(
      { _id: req.params.id, status: "pending" },
      { $set: { status: "rejected", canceledAt: new Date(), rejectionReason: limitedString(req.body?.reason || "admin_cancel", 120) } },
      { new: true },
    );
    if (!topup) return res.status(404).json({ message: "Pending topup not found" });
    res.json({ topup });
  } catch (error) {
    next(error);
  }
}

export async function adminApproveMembershipOrder(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) return res.status(400).json({ message: "Invalid membership order id" });
    const order = await MembershipOrder.findOne({ _id: req.params.id, status: "pending" });
    if (!order) return res.status(404).json({ message: "Pending membership order not found" });
    const result = await approvePendingMembershipOrder(order, { approvedByAdminId: req.user._id });
    if (!result) return res.status(409).json({ message: "Membership order is no longer pending" });
    res.json({ order: result.order, user: result.user });
  } catch (error) {
    next(error);
  }
}

export async function adminCancelMembershipOrder(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) return res.status(400).json({ message: "Invalid membership order id" });
    const order = await MembershipOrder.findOneAndUpdate(
      { _id: req.params.id, status: "pending" },
      { $set: { status: "rejected", canceledAt: new Date(), rejectionReason: limitedString(req.body?.reason || "admin_cancel", 120) } },
      { new: true },
    );
    if (!order) return res.status(404).json({ message: "Pending membership order not found" });
    res.json({ order });
  } catch (error) {
    next(error);
  }
}

function normalizePlanPayload(body = {}) {
  const code = String(body.code || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32);
  const name = limitedString(body.name, 80);
  const price = Math.max(0, Math.round(Number(body.price || 0)));
  const durationDays = Math.max(1, Math.round(Number(body.durationDays || 1)));
  const dailyDownloadLimit = Math.max(1, Math.round(Number(body.dailyDownloadLimit || 100)));
  const maxPurchasesPerUser = Math.max(0, Math.round(Number(body.maxPurchasesPerUser || 0)));
  const features = Array.isArray(body.features)
    ? body.features
    : String(body.features || "").split(/\n|,/);
  return {
    code,
    name,
    price,
    durationDays,
    expiresEndOfDay: true,
    tier: "member",
    dailyDownloadLimit,
    maxPurchasesPerUser,
    badge: limitedString(body.badge, 40),
    features: features.map((item) => limitedString(item, 120)).filter(Boolean).slice(0, 20),
    isActive: body.isActive !== false,
    sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
  };
}

export async function adminListMembershipPlans(_req, res, next) {
  try {
    const plans = await MembershipPlan.find().sort({ sortOrder: 1, price: 1 }).lean();
    res.json({ plans });
  } catch (error) {
    next(error);
  }
}

export async function adminCreateMembershipPlan(req, res, next) {
  try {
    const unknownKey = rejectUnknownKeys(req.body, ["code", "name", "price", "durationDays", "dailyDownloadLimit", "maxPurchasesPerUser", "badge", "features", "isActive", "sortOrder"]);
    if (unknownKey) return res.status(400).json({ message: "Invalid membership plan request" });
    const payload = normalizePlanPayload(req.body);
    if (!payload.code || !payload.name) return res.status(400).json({ message: "Plan code and name are required" });
    const plan = await MembershipPlan.create(payload);
    res.json({ plan });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: "Membership plan code already exists" });
    next(error);
  }
}

export async function adminUpdateMembershipPlan(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) return res.status(400).json({ message: "Invalid membership plan id" });
    const unknownKey = rejectUnknownKeys(req.body, ["code", "name", "price", "durationDays", "dailyDownloadLimit", "maxPurchasesPerUser", "badge", "features", "isActive", "sortOrder"]);
    if (unknownKey) return res.status(400).json({ message: "Invalid membership plan request" });
    const payload = normalizePlanPayload(req.body);
    delete payload.code;
    if (!payload.name) return res.status(400).json({ message: "Plan name is required" });
    const plan = await MembershipPlan.findByIdAndUpdate(req.params.id, { $set: payload }, { new: true });
    if (!plan) return res.status(404).json({ message: "Membership plan not found" });
    res.json({ plan });
  } catch (error) {
    next(error);
  }
}

export async function adminDeleteMembershipPlan(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) return res.status(400).json({ message: "Invalid membership plan id" });
    const plan = await MembershipPlan.findByIdAndUpdate(req.params.id, { $set: { isActive: false } }, { new: true });
    if (!plan) return res.status(404).json({ message: "Membership plan not found" });
    res.json({ plan });
  } catch (error) {
    next(error);
  }
}

export async function adminReorderMembershipPlans(req, res, next) {
  try {
    const orderedIds = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds : [];
    if (!orderedIds.length || orderedIds.some((id) => !isSafeId(id))) {
      return res.status(400).json({ message: "orderedIds is required" });
    }
    await Promise.all(
      orderedIds.map((id, index) =>
        MembershipPlan.findByIdAndUpdate(id, { $set: { sortOrder: (index + 1) * 10 } }),
      ),
    );
    const plans = await MembershipPlan.find().sort({ sortOrder: 1, price: 1 }).lean();
    res.json({ plans });
  } catch (error) {
    next(error);
  }
}

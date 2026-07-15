import mongoose from "mongoose";
import Getlink from "../models/Getlink.js";
import Topup from "../models/Topup.js";
import MembershipOrder from "../models/MembershipOrder.js";
import ModelDownload from "../models/ModelDownload.js";
import ModelPurchase from "../models/ModelPurchase.js";
import Referral from "../models/Referral.js";

const TIMELINE_TYPES = new Set(["all", "credit", "pro", "getlink", "model", "scene", "referral", "voucher"]);

function safeLimit(value, fallback = 20, max = 100) {
  const number = Number(value || fallback);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(max, Math.max(1, Math.floor(number)));
}

function safePage(value) {
  const number = Number(value || 1);
  if (!Number.isFinite(number) || number <= 0) return 1;
  return Math.floor(number);
}

function redownloadWindowDays() {
  const days = Number(process.env.GETLINK_REDOWNLOAD_DAYS || 3);
  return Number.isFinite(days) && days > 0 ? days : 3;
}

function redownloadLimit() {
  const limit = Number(process.env.GETLINK_REDOWNLOAD_LIMIT || 5);
  return Number.isFinite(limit) && limit > 0 ? limit : 5;
}

function redownloadExpiresAt(item) {
  const created = item?.createdAt ? new Date(item.createdAt).getTime() : 0;
  if (!created) return null;
  return new Date(created + redownloadWindowDays() * 24 * 60 * 60 * 1000);
}

function canRedownload(item) {
  const expiresAt = redownloadExpiresAt(item);
  return Boolean(
    expiresAt &&
      expiresAt.getTime() > Date.now() &&
      Number(item?.redownloadCount || 0) < redownloadLimit(),
  );
}

function objectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || "")) ? new mongoose.Types.ObjectId(String(value)) : null;
}

function dateValue(value) {
  const date = value ? new Date(value) : new Date(0);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function userSummary(user) {
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

function moneyAmount(value) {
  return Number(value || 0);
}

function eventBase(id, type, title, amount, status, createdAt, metadata = {}) {
  return {
    id: String(id),
    type,
    title,
    amount,
    status: status || "",
    createdAt,
    metadata,
  };
}

function mapTopup(item) {
  const isApproved = item.status === "approved";
  return eventBase(
    `topup:${item._id}`,
    "credit",
    item.type === "manual" ? "Admin cộng credit" : `Nạp credit${item.packageId?.name ? ` - ${item.packageId.name}` : ""}`,
    isApproved ? Number(item.credit || 0) : 0,
    item.status,
    item.paidAt || item.createdAt,
    {
      topupId: item._id,
      amountMoney: moneyAmount(item.amount),
      creditAmount: Number(item.credit || 0),
      originalAmount: moneyAmount(item.originalAmount),
      discountAmount: moneyAmount(item.discountAmount),
      voucherCode: item.voucherCode || "",
      paymentCode: item.paymentCode || "",
      gatewayProvider: item.gatewayProvider || item.type || "",
      package: item.packageId ? {
        _id: item.packageId._id,
        name: item.packageId.name || "",
        credit: Number(item.packageId.credit || 0),
      } : null,
      user: userSummary(item.userId),
    },
  );
}

function mapGetlink(item) {
  const expiresAt = redownloadExpiresAt(item);
  return eventBase(
    `getlink:${item._id}`,
    "getlink",
    item.title || `3D ${item.productId || ""}`.trim(),
    -Number(item.creditUsed || 0),
    "approved",
    item.createdAt,
    {
      historyId: item._id,
      productId: item.productId || "",
      creditUsed: Number(item.creditUsed || 0),
      downloadFormat: item.downloadFormat || null,
      canRedownload: canRedownload(item),
      redownloadExpiresAt: expiresAt,
      redownloadCount: Number(item.redownloadCount || 0),
      redownloadLimit: redownloadLimit(),
      redownloadRemaining: Math.max(0, redownloadLimit() - Number(item.redownloadCount || 0)),
      user: userSummary(item.userId),
    },
  );
}

function mapMembership(item) {
  const isAddon = Boolean(item.isQuotaAddon);
  const isApproved = item.status === "approved";
  return eventBase(
    `membership:${item._id}`,
    "pro",
    isAddon ? `Thêm lượt Pro hôm nay - ${item.planName || item.planCode || "Daily"}` : `Mua Pro - ${item.planName || item.planCode || ""}`.trim(),
    isApproved ? -moneyAmount(item.amount) : 0,
    item.status,
    item.paidAt || item.createdAt,
    {
      orderId: item._id,
      planId: item.planId,
      planCode: item.planCode || "",
      planName: item.planName || "",
      durationDays: Number(item.durationDays || 0),
      dailyDownloadLimit: Number(item.dailyDownloadLimit || 0),
      activatedUntil: item.activatedUntil || null,
      isQuotaAddon: isAddon,
      quotaBoostAmount: Number(item.quotaBoostAmount || 0),
      quotaBoostDayKey: item.quotaBoostDayKey || "",
      amountMoney: moneyAmount(item.amount),
      voucherCode: item.voucherCode || "",
      paymentCode: item.paymentCode || "",
      gatewayProvider: item.gatewayProvider || "",
      user: userSummary(item.userId),
    },
  );
}

function modelSummary(model) {
  if (!model) return null;
  return {
    _id: model._id,
    assetType: model.assetType || "model",
    title: model.title || "",
    slug: model.slug || "",
    accessType: model.accessType || "",
    fileStatus: model.fileStatus || "",
  };
}

function mapModelDownload(item) {
  const assetType = item.assetType || item.modelId?.assetType || "model";
  const quotaCost = item.quotaCharged ? Number(item.quotaCost || 1) : 0;
  const event = eventBase(
    `model-download:${item._id}`,
    "model",
    `Tải model${item.modelId?.title ? ` - ${item.modelId.title}` : ""}`,
    item.quotaCharged ? -1 : 0,
    "downloaded",
    item.createdAt,
    {
      downloadId: item._id,
      model: modelSummary(item.modelId),
      clientType: item.clientType || "web",
      accessTier: item.accessTier || "",
      quotaCharged: Boolean(item.quotaCharged),
      quotaCost,
      assetType,
      guestKey: item.guestKey || "",
      user: userSummary(item.userId),
    },
  );
  event.id = `${assetType}-download:${item._id}`;
  event.type = assetType;
  event.title = `${assetType === "scene" ? "Tải scene" : "Tải model"}${item.modelId?.title ? ` - ${item.modelId.title}` : ""}`;
  event.amount = -quotaCost;
  return event;
}

function mapModelPurchase(item) {
  return eventBase(
    `model-purchase:${item._id}`,
    "model",
    `Mua model${item.modelId?.title ? ` - ${item.modelId.title}` : ""}`,
    -Number(item.creditPaid || 0),
    "approved",
    item.createdAt,
    {
      purchaseId: item._id,
      model: modelSummary(item.modelId),
      creditPaid: Number(item.creditPaid || 0),
      user: userSummary(item.userId),
    },
  );
}

function mapReferral(item, userId) {
  const isReferrer = String(item.referrerId?._id || item.referrerId) === String(userId);
  const rewardType = item.rewardType || "credit";
  const credit = isReferrer
    ? Number(item.referrerRewardCredit ?? item.rewardCredit ?? 0)
    : Number(item.referredRewardCredit ?? item.rewardCredit ?? 0);
  const proDays = isReferrer
    ? Number(item.referrerRewardProDays || 0)
    : Number(item.referredRewardProDays || 0);
  const proUntil = isReferrer ? item.referrerProUntil : item.referredProUntil;
  const otherUser = isReferrer ? item.referredUserId : item.referrerId;
  return eventBase(
    `referral:${item._id}:${isReferrer ? "referrer" : "referred"}`,
    "referral",
    rewardType === "pro"
      ? (isReferrer ? "Thưởng Pro khi mời bạn" : "Pro chào mừng từ lời mời")
      : (isReferrer ? "Mời bạn bè" : "Được mời"),
    item.status === "rewarded" && rewardType === "credit" ? credit : 0,
    item.status,
    item.rewardedAt || item.createdAt,
    {
      referralId: item._id,
      role: isReferrer ? "referrer" : "referred",
      referralCode: item.referralCode || "",
      rewardType,
      proDays: rewardType === "pro" ? proDays : 0,
      proUntil: rewardType === "pro" ? proUntil : null,
      otherUser: userSummary(otherUser),
    },
  );
}

function mapTopupVoucher(item) {
  return eventBase(
    `topup-voucher:${item._id}`,
    "voucher",
    `Dùng voucher ${item.voucherCode || ""}`.trim(),
    0,
    "used",
    item.paidAt || item.createdAt,
    {
      topupId: item._id,
      voucherCode: item.voucherCode || "",
      discountAmount: moneyAmount(item.discountAmount),
      creditBonus: Number(item.voucherCreditBonus || 0),
      creditAmount: Number(item.credit || 0),
      targetKind: "credit",
      user: userSummary(item.userId),
    },
  );
}

function mapMembershipVoucher(item) {
  return eventBase(
    `membership-voucher:${item._id}`,
    "voucher",
    `Dùng voucher ${item.voucherCode || ""}`.trim(),
    0,
    "used",
    item.paidAt || item.createdAt,
    {
      membershipOrderId: item._id,
      voucherCode: item.voucherCode || "",
      discountAmount: moneyAmount(item.discountAmount),
      targetKind: "pro",
      user: userSummary(item.userId),
    },
  );
}

async function fetchTimelineSources({ userId, type, sourceLimit }) {
  const userObjectId = objectId(userId);
  if (!userObjectId) return [];
  const tasks = [];

  if (type === "all" || type === "credit") {
    tasks.push(
      Topup.find({ userId: userObjectId })
        .sort({ createdAt: -1 })
        .limit(sourceLimit)
        .populate("packageId", "name credit price badge")
        .populate("userId", "name email avatar credit role")
        .lean()
        .then((items) => items.map(mapTopup)),
    );
  }

  if (type === "all" || type === "getlink") {
    tasks.push(
      Getlink.find({ userId: userObjectId })
        .sort({ createdAt: -1 })
        .limit(sourceLimit)
        .populate("userId", "name email avatar credit role")
        .lean()
        .then((items) => items.map(mapGetlink)),
    );
  }

  if (type === "all" || type === "pro") {
    tasks.push(
      MembershipOrder.find({ userId: userObjectId })
        .sort({ createdAt: -1 })
        .limit(sourceLimit)
        .populate("userId", "name email avatar credit role")
        .lean()
        .then((items) => items.map(mapMembership)),
    );
  }

  if (type === "all" || type === "model" || type === "scene") {
    const downloadQuery = { userId: userObjectId };
    if (type === "model") downloadQuery.assetType = { $ne: "scene" };
    if (type === "scene") downloadQuery.assetType = "scene";
    tasks.push(
      ModelDownload.find(downloadQuery)
        .sort({ createdAt: -1 })
        .limit(sourceLimit)
        .populate("modelId", "assetType title slug accessType fileStatus source")
        .populate("userId", "name email avatar credit role")
        .lean()
        .then((items) => items.map(mapModelDownload)),
    );
    if (type !== "scene") tasks.push(
      ModelPurchase.find({ userId: userObjectId })
        .sort({ createdAt: -1 })
        .limit(sourceLimit)
        .populate("modelId", "assetType title slug accessType fileStatus source")
        .populate("userId", "name email avatar credit role")
        .lean()
        .then((items) => items.map(mapModelPurchase)),
    );
  }

  if (type === "all" || type === "referral") {
    tasks.push(
      Referral.find({
        $or: [{ referrerId: userObjectId }, { referredUserId: userObjectId }],
      })
        .sort({ createdAt: -1 })
        .limit(sourceLimit)
        .populate("referrerId", "name email avatar credit role")
        .populate("referredUserId", "name email avatar credit role")
        .lean()
        .then((items) => items.map((item) => mapReferral(item, userId))),
    );
  }

  // Voucher rows project their parent Credit/Pro transaction. Keeping this
  // focused prevents one checkout from appearing twice in the "all" view.
  if (type === "voucher") {
    tasks.push(
      Topup.find({
        userId: userObjectId,
        status: "approved",
        voucherCode: { $nin: ["", null] },
      })
        .sort({ createdAt: -1 })
        .limit(sourceLimit)
        .populate("userId", "name email avatar credit role")
        .lean()
        .then((items) => items.map(mapTopupVoucher)),
    );
    tasks.push(
      MembershipOrder.find({
        userId: userObjectId,
        status: "approved",
        voucherCode: { $nin: ["", null] },
      })
        .sort({ createdAt: -1 })
        .limit(sourceLimit)
        .populate("userId", "name email avatar credit role")
        .lean()
        .then((items) => items.map(mapMembershipVoucher)),
    );
  }

  const groups = await Promise.all(tasks);
  return groups.flat();
}

async function countTimelineSources({ userId, type }) {
  const userObjectId = objectId(userId);
  if (!userObjectId) return 0;
  const tasks = [];
  if (type === "all" || type === "credit") tasks.push(Topup.countDocuments({ userId: userObjectId }));
  if (type === "all" || type === "getlink") tasks.push(Getlink.countDocuments({ userId: userObjectId }));
  if (type === "all" || type === "pro") tasks.push(MembershipOrder.countDocuments({ userId: userObjectId }));
  if (type === "all" || type === "model" || type === "scene") {
    const downloadQuery = { userId: userObjectId };
    if (type === "model") downloadQuery.assetType = { $ne: "scene" };
    if (type === "scene") downloadQuery.assetType = "scene";
    tasks.push(ModelDownload.countDocuments(downloadQuery));
    if (type !== "scene") tasks.push(ModelPurchase.countDocuments({ userId: userObjectId }));
  }
  if (type === "all" || type === "referral") {
    tasks.push(Referral.countDocuments({
      $or: [{ referrerId: userObjectId }, { referredUserId: userObjectId }],
    }));
  }
  if (type === "voucher") {
    tasks.push(Topup.countDocuments({
      userId: userObjectId,
      status: "approved",
      voucherCode: { $nin: ["", null] },
    }));
    tasks.push(MembershipOrder.countDocuments({
      userId: userObjectId,
      status: "approved",
      voucherCode: { $nin: ["", null] },
    }));
  }
  const counts = await Promise.all(tasks);
  return counts.reduce((sum, count) => sum + Number(count || 0), 0);
}

export async function buildUserTimeline({ userId, type = "all", page = 1, limit = 20 } = {}) {
  const normalizedType = TIMELINE_TYPES.has(String(type || "").toLowerCase())
    ? String(type || "all").toLowerCase()
    : "all";
  const safePageNumber = safePage(page);
  const safeLimitNumber = safeLimit(limit);
  const sourceLimit = safePageNumber * safeLimitNumber;
  const [events, total] = await Promise.all([
    fetchTimelineSources({ userId, type: normalizedType, sourceLimit }),
    countTimelineSources({ userId, type: normalizedType }),
  ]);
  const sorted = events.sort((a, b) => dateValue(b.createdAt) - dateValue(a.createdAt));
  const totalPages = Math.max(1, Math.ceil(total / safeLimitNumber));
  const pageNumber = Math.min(safePageNumber, totalPages);
  const start = (pageNumber - 1) * safeLimitNumber;
  return {
    events: sorted.slice(start, start + safeLimitNumber),
    pagination: {
      page: pageNumber,
      pageSize: safeLimitNumber,
      total,
      totalPages,
    },
    type: normalizedType,
  };
}


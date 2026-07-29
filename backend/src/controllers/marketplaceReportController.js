import MarketplaceModel from "../models/MarketplaceModel.js";
import MarketplaceReport, {
  MARKETPLACE_REPORT_REASONS,
  MARKETPLACE_REPORT_STATUSES,
} from "../models/MarketplaceReport.js";
import User from "../models/User.js";
import { normalizeAssetType } from "../data/marketplaceCatalogs.js";
import { marketplaceActiveDeletionQuery } from "../utils/marketplaceDeletionService.js";
import { hydrateAtlasUserFields } from "../utils/crossDatabaseHydration.js";
import {
  isSafeId,
  rejectUnknownKeys,
  sanitizeString,
} from "../utils/validators.js";

const ACTIVE_REPORT_STATUSES = ["open", "investigating"];
const DEFAULT_PAGE_SIZE = 20;

function escapedRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function requestedAssetType(req) {
  return normalizeAssetType(req?.marketplaceAssetType || req?.query?.assetType || "model");
}

function safePage(value) {
  const number = Number(value || 1);
  return Number.isInteger(number) && number > 0 ? number : 1;
}

function safeLimit(value) {
  const number = Number(value || DEFAULT_PAGE_SIZE);
  return Number.isFinite(number) && number > 0
    ? Math.min(100, Math.floor(number))
    : DEFAULT_PAGE_SIZE;
}

function reportDailyLimit() {
  const value = Number(process.env.MARKETPLACE_REPORT_DAILY_LIMIT || 20);
  return Number.isFinite(value) ? Math.min(200, Math.max(1, Math.floor(value))) : 20;
}

function vietnamDayStart(now = new Date()) {
  const shifted = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return new Date(Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  ) - 7 * 60 * 60 * 1000);
}

async function reportableAsset(id, assetType) {
  if (!isSafeId(id)) return null;
  return MarketplaceModel.findOne({
    _id: id,
    assetType,
    isPublished: true,
    $and: [marketplaceActiveDeletionQuery()],
  }).select("_id assetType title slug isPublished deletionStatus").lean();
}

function normalizedReportInput(body = {}) {
  const reason = String(body.reason || "").trim().toLowerCase();
  const rawMessage = typeof body.message === "string" ? body.message.trim() : "";
  return {
    reason,
    message: sanitizeString(rawMessage, 1000),
    rawMessageLength: rawMessage.length,
  };
}

async function activeReportFor(userId, modelId) {
  return MarketplaceReport.findOne({
    userId,
    modelId,
    isActive: true,
  }).select("_id status").lean();
}

export async function getMarketplaceReportStatus(req, res, next) {
  try {
    const assetType = requestedAssetType(req);
    const asset = await reportableAsset(req.params.id, assetType);
    if (!asset) return res.status(404).json({ message: `${assetType === "scene" ? "Scene" : "Model"} not found` });
    const report = await activeReportFor(req.user._id, asset._id);
    return res.json({ reported: Boolean(report) });
  } catch (error) {
    return next(error);
  }
}

export async function createMarketplaceReport(req, res, next) {
  try {
    const unknownKey = rejectUnknownKeys(req.body, ["reason", "message"]);
    if (unknownKey) return res.status(400).json({ message: "Invalid marketplace report request" });
    const assetType = requestedAssetType(req);
    const asset = await reportableAsset(req.params.id, assetType);
    if (!asset) return res.status(404).json({ message: `${assetType === "scene" ? "Scene" : "Model"} not found` });

    const existing = await activeReportFor(req.user._id, asset._id);
    if (existing) return res.json({ reported: true, alreadyReported: true });

    const input = normalizedReportInput(req.body);
    if (!MARKETPLACE_REPORT_REASONS.includes(input.reason)) {
      return res.status(400).json({ message: "Invalid report reason", code: "MARKETPLACE_REPORT_REASON_INVALID" });
    }
    if (input.rawMessageLength > 1000) {
      return res.status(400).json({ message: "Report message must not exceed 1000 characters", code: "MARKETPLACE_REPORT_MESSAGE_TOO_LONG" });
    }
    if (input.reason === "other" && !input.message) {
      return res.status(400).json({ message: "Please describe the issue", code: "MARKETPLACE_REPORT_MESSAGE_REQUIRED" });
    }

    const usedToday = await MarketplaceReport.countDocuments({
      userId: req.user._id,
      createdAt: { $gte: vietnamDayStart() },
    });
    if (usedToday >= reportDailyLimit()) {
      return res.status(429).json({
        message: "You have reached the daily report limit",
        code: "MARKETPLACE_REPORT_DAILY_LIMIT",
      });
    }

    try {
      await MarketplaceReport.create({
        modelId: asset._id,
        assetType,
        userId: req.user._id,
        reason: input.reason,
        message: input.message,
        status: "open",
        isActive: true,
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      return res.json({ reported: true, alreadyReported: true });
    }

    return res.status(201).json({ reported: true, alreadyReported: false });
  } catch (error) {
    return next(error);
  }
}

export async function marketplaceReportCountsForAssets(models = []) {
  const ids = models.map((model) => model?._id).filter(Boolean);
  if (!ids.length) return new Map();
  const reports = await MarketplaceReport.find({
    modelId: { $in: ids },
    isActive: true,
  }).select("modelId").lean();
  const counts = new Map();
  for (const report of reports) {
    const key = String(report.modelId?._id || report.modelId || "");
    counts.set(key, Number(counts.get(key) || 0) + 1);
  }
  return counts;
}

export async function marketplaceReportStats(assetType = "") {
  const query = { isActive: true };
  if (["model", "scene"].includes(assetType)) query.assetType = assetType;
  const [activeReports, assetIds] = await Promise.all([
    MarketplaceReport.countDocuments(query),
    MarketplaceReport.distinct("modelId", query),
  ]);
  return {
    activeReports,
    reportedAssets: assetIds.length,
  };
}

async function reportSearchQuery(search, assetType) {
  const text = String(search || "").trim().slice(0, 120);
  if (!text) return null;
  const regex = new RegExp(escapedRegex(text), "i");
  const [assets, users] = await Promise.all([
    MarketplaceModel.find({
      ...(assetType ? { assetType } : {}),
      $or: [
        { title: regex },
        { slug: regex },
        { "source.assetId": regex },
        { "source.modelId": regex },
        { driveFolderName: regex },
      ],
    }).select("_id").limit(500).lean(),
    User.find({ $or: [{ name: regex }, { email: regex }] }).select("_id").limit(500).lean(),
  ]);
  const clauses = [];
  if (assets.length) clauses.push({ modelId: { $in: assets.map((item) => item._id) } });
  if (users.length) clauses.push({ userId: { $in: users.map((item) => item._id) } });
  if (isSafeId(text)) {
    clauses.push({ _id: text }, { modelId: text }, { userId: text });
  }
  return clauses.length ? { $or: clauses } : { _id: { $in: [] } };
}

export async function adminListMarketplaceReports(req, res, next) {
  try {
    const requestedType = String(req.query.assetType || "").trim().toLowerCase();
    const assetType = ["model", "scene"].includes(requestedType) ? requestedType : "";
    const status = String(req.query.status || "active").trim().toLowerCase();
    const reason = String(req.query.reason || "").trim().toLowerCase();
    const requestedPage = safePage(req.query.page);
    const limit = safeLimit(req.query.limit);
    const query = {};
    if (assetType) query.assetType = assetType;
    if (status === "active") query.isActive = true;
    else if (MARKETPLACE_REPORT_STATUSES.includes(status)) query.status = status;
    if (MARKETPLACE_REPORT_REASONS.includes(reason)) query.reason = reason;
    const searchQuery = await reportSearchQuery(req.query.search, assetType);
    if (searchQuery) query.$and = [searchQuery];

    const total = await MarketplaceReport.countDocuments(query);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(requestedPage, totalPages);
    const reports = await MarketplaceReport.find(query)
      .sort({ isActive: -1, updatedAt: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const modelIds = [...new Set(reports.map((item) => String(item.modelId || "")).filter(Boolean))];
    const models = modelIds.length
      ? await MarketplaceModel.find({ _id: { $in: modelIds } })
        .select("_id assetType title slug coverImage previewImages deletionStatus isPublished fileStatus")
        .lean()
      : [];
    const modelById = new Map(models.map((model) => [String(model._id), model]));
    await hydrateAtlasUserFields(reports, ["userId", "resolvedBy"]);

    return res.json({
      reports: reports.map((report) => ({
        ...report,
        model: modelById.get(String(report.modelId)) || null,
      })),
      pagination: { page, pageSize: limit, total, totalPages },
    });
  } catch (error) {
    return next(error);
  }
}

export async function adminUpdateMarketplaceReport(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) return res.status(400).json({ message: "Invalid marketplace report id" });
    const unknownKey = rejectUnknownKeys(req.body, ["status", "adminNote"]);
    if (unknownKey) return res.status(400).json({ message: "Invalid marketplace report update" });
    const status = String(req.body.status || "").trim().toLowerCase();
    if (!MARKETPLACE_REPORT_STATUSES.includes(status)) {
      return res.status(400).json({ message: "Invalid marketplace report status" });
    }
    const rawAdminNote = typeof req.body.adminNote === "string" ? req.body.adminNote.trim() : "";
    if (rawAdminNote.length > 1000) {
      return res.status(400).json({ message: "Admin note must not exceed 1000 characters" });
    }
    const report = await MarketplaceReport.findById(req.params.id).lean();
    if (!report) return res.status(404).json({ message: "Marketplace report not found" });
    const isActive = ACTIVE_REPORT_STATUSES.includes(status);
    if (isActive && !report.isActive) {
      const conflict = await MarketplaceReport.findOne({
        _id: { $ne: report._id },
        userId: report.userId,
        modelId: report.modelId,
        isActive: true,
      }).select("_id").lean();
      if (conflict) {
        return res.status(409).json({
          message: "This user already has another active report for the asset",
          code: "MARKETPLACE_REPORT_ACTIVE_CONFLICT",
        });
      }
    }

    const now = new Date();
    const update = {
      $set: {
        status,
        isActive,
        adminNote: sanitizeString(rawAdminNote, 1000),
      },
    };
    if (isActive) {
      update.$unset = { resolvedBy: "", resolvedAt: "", expiresAt: "" };
    } else {
      update.$set.resolvedBy = req.user._id;
      update.$set.resolvedAt = now;
      update.$unset = { expiresAt: "" };
    }
    const updated = await MarketplaceReport.findByIdAndUpdate(report._id, update, { new: true });
    req.auditDetails = {
      assetType: report.assetType,
      modelId: String(report.modelId),
      previousStatus: report.status,
      status,
      reason: report.reason,
    };
    return res.json({ report: updated });
  } catch (error) {
    return next(error);
  }
}

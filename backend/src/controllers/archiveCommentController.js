import SiteSetting from "../models/SiteSetting.js";
import User from "../models/User.js";
import MarketplaceModel from "../models/MarketplaceModel.js";
import ModelDownload from "../models/ModelDownload.js";
import { archiveTraceKeyConfigured, readArchiveTrace, validArchiveComment } from "../utils/archiveTrace.js";
import { rejectUnknownKeys } from "../utils/validators.js";

export async function adminArchiveCommentSettings(_req, res, next) {
  try {
    const settings = await SiteSetting.findOne({ key: "homepage" }).select("archiveCommentEnabled archiveCommentText").lean();
    res.setHeader("cache-control", "no-store");
    res.json({ enabled: settings?.archiveCommentEnabled === true, text: settings?.archiveCommentText ?? "3dipl.org",
      keyConfigured: archiveTraceKeyConfigured() });
  } catch (error) { next(error); }
}

export async function adminUpdateArchiveCommentSettings(req, res, next) {
  try {
    const body = req.body || {};
    if (rejectUnknownKeys(body, ["enabled", "text"]) || typeof body.enabled !== "boolean" || !validArchiveComment(body.text)) {
      return res.status(400).json({ code: "ARCHIVE_COMMENT_INVALID", message: "Comment must be plain text, up to 4096 UTF-8 bytes, without control characters." });
    }
    if (body.enabled && !archiveTraceKeyConfigured()) {
      return res.status(409).json({ code: "ARCHIVE_TRACE_KEY_REQUIRED", message: "Configure ARCHIVE_TRACE_SECRET on the backend before enabling archive comments." });
    }
    await SiteSetting.findOneAndUpdate({ key: "homepage" }, { $set: {
      archiveCommentEnabled: body.enabled, archiveCommentText: body.text.replace(/\r\n?/g, "\n"),
    } }, { upsert: true, new: true });
    return adminArchiveCommentSettings(req, res, next);
  } catch (error) { next(error); }
}

export async function adminLookupArchiveTrace(req, res, next) {
  try {
    const body = req.body || {};
    if (rejectUnknownKeys(body, ["token"])) return res.status(400).json({ message: "Invalid trace lookup request." });
    const trace = readArchiveTrace(body.token);
    const [user, asset, download] = await Promise.all([
      User.findById(trace.userId).select("name email isBanned").lean(),
      MarketplaceModel.findById(trace.modelId).select("title slug assetType").lean(),
      ModelDownload.findOne({ sessionId: trace.sessionId, userId: trace.userId, modelId: trace.modelId })
        .select("status downloadedAt clientType").lean(),
    ]);
    req.auditDetails = { tracedUserId: trace.userId, modelId: trace.modelId, sessionId: trace.sessionId };
    res.setHeader("cache-control", "no-store");
    res.json({ trace, user: user || null, asset: asset || null, download: download || null });
  } catch (error) { next(error); }
}

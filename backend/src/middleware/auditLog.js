import AuditLog from "../models/AuditLog.js";
import { auditEvent } from "../utils/logger.js";

const SENSITIVE_KEYS = new Set([
  "password",
  "secret",
  "token",
  "cookie",
  "value",
  "cookievalue",
  "threed66proxyurl",
  "expectedmetadatahash",
  "expecteddriveversion",
  "drivefileid",
  "metadatadrivefileid",
  "coverdrivefileid",
  "drivefolderid",
  "rootfolderid",
]);

/**
 * Removes sensitive fields from request body before storing in audit log.
 */
function sanitizeBody(body = {}, depth = 0) {
  if (!body || typeof body !== "object" || depth > 5) return {};
  const result = Array.isArray(body) ? [] : {};
  for (const [key, value] of Object.entries(body)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = "[REDACTED]";
    } else if (value && typeof value === "object") {
      result[key] = sanitizeBody(value, depth + 1);
    } else if (typeof value === "string" && value.length > 200) {
      result[key] = value.slice(0, 200) + "...[truncated]";
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Middleware factory: automatically logs admin actions to AuditLog collection.
 * Wraps res.json to capture the response status code.
 *
 * Usage: router.post("/add-credit", auditAdmin("ADD_CREDIT"), adminAddCredit);
 */
export function auditAdmin(action) {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);

    res.json = (data) => {
      const statusCode = res.statusCode;

      if (statusCode < 400) {
        const logEntry = {
          actor: req.user?._id,
          actorEmail: req.user?.email || "",
          action,
          target: req.params?.id || req.body?.userId || "",
          targetId: req.params?.id || "",
          details: sanitizeBody(req.body),
          ip: req.ip || "",
          userAgent: String(req.get("user-agent") || "").slice(0, 256),
          statusCode
        };

        AuditLog.create(logEntry).catch(() => {});
        auditEvent(action, {
          actor: req.user?.email,
          target: logEntry.target,
          ip: req.ip
        });
      }

      return originalJson(data);
    };

    next();
  };
}

/**
 * Controller: list recent audit logs (admin only).
 */
export async function listAuditLogs(req, res, next) {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const requestedPage = Math.max(1, Math.floor(Number(req.query.page) || 1));
    const actionFilter = typeof req.query.action === "string" ? req.query.action.trim() : "";
    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 120) : "";
    const target = typeof req.query.target === "string" ? req.query.target.trim().slice(0, 160) : "";
    const query = {};
    if (actionFilter) query.action = actionFilter;
    if (target) query.$or = [{ target }, { targetId: target }];
    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$and = [
        ...(query.$and || []),
        { $or: [{ action: regex }, { actorEmail: regex }, { target: regex }, { targetId: regex }] },
      ];
    }
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    if ((from && !Number.isNaN(from.getTime())) || (to && !Number.isNaN(to.getTime()))) {
      query.createdAt = {};
      if (from && !Number.isNaN(from.getTime())) query.createdAt.$gte = from;
      if (to && !Number.isNaN(to.getTime())) query.createdAt.$lte = to;
    }
    const total = await AuditLog.countDocuments(query);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(requestedPage, totalPages);
    const logs = await AuditLog.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("actor", "email name");

    res.json({ logs, pagination: { page, pageSize: limit, total, totalPages } });
  } catch (error) {
    next(error);
  }
}

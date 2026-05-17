import AuditLog from "../models/AuditLog.js";
import { auditEvent } from "../utils/logger.js";

const SENSITIVE_KEYS = new Set(["password", "secret", "token", "cookie", "value", "cookieValue"]);

/**
 * Removes sensitive fields from request body before storing in audit log.
 */
function sanitizeBody(body = {}) {
  if (!body || typeof body !== "object") return {};
  const result = {};
  for (const [key, value] of Object.entries(body)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = "[REDACTED]";
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
    const actionFilter = typeof req.query.action === "string" ? req.query.action.trim() : "";

    const query = actionFilter ? { action: actionFilter } : {};
    const logs = await AuditLog.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("actor", "email name");

    res.json({ logs });
  } catch (error) {
    next(error);
  }
}

import SystemLog from "../models/SystemLog.js";
import logger from "./logger.js";

function safeDetails(details = {}) {
  const output = { ...details };
  delete output.cookie;
  delete output.cookieValue;
  delete output.fileUrl;
  delete output.headers;
  return output;
}

export async function writeSystemLog({
  type = "system",
  level = "error",
  message,
  userId,
  productId,
  historyId,
  status,
  ip,
  path,
  details = {},
}) {
  const payload = {
    type,
    level,
    message: String(message || "System event").slice(0, 500),
    userId,
    productId,
    historyId,
    status,
    ip,
    path,
    details: safeDetails(details),
  };

  logger[level === "error" ? "error" : level === "warn" ? "warn" : "info"]({
    type: "SYSTEM_LOG",
    ...payload,
  });

  try {
    await SystemLog.create(payload);
  } catch (error) {
    logger.warn({ type: "SYSTEM_LOG_WRITE_FAILED", error: error.message });
  }
}

import logger from "./logger.js";

const TELEGRAM_API = "https://api.telegram.org";
const recentNotifications = new Map();

function dedupeWindowMs() {
  const value = Number(process.env.TELEGRAM_DEDUP_WINDOW_MS || 60_000);
  return Number.isFinite(value) && value >= 0 ? value : 60_000;
}

function shouldSend(message, dedupeKey = "") {
  const text = String(message || "").trim();
  if (!text) return false;

  const windowMs = dedupeWindowMs();
  if (windowMs <= 0) return true;

  const now = Date.now();
  const key = String(dedupeKey || text);
  const previous = recentNotifications.get(key) || 0;
  if (now - previous < windowMs) return false;

  recentNotifications.set(key, now);
  for (const [key, sentAt] of recentNotifications) {
    if (now - sentAt >= windowMs) recentNotifications.delete(key);
  }
  return true;
}

function isEnabled() {
  return process.env.TELEGRAM_NOTIFICATIONS_ENABLED !== "false";
}

function chatIds() {
  return String(process.env.TELEGRAM_CHAT_ID || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function money(value) {
  const number = Number(value || 0);
  return `${new Intl.NumberFormat("vi-VN").format(number)} VND`;
}

function shortId(value = "") {
  return String(value || "").slice(-8) || "-";
}

export async function sendTelegramNotification(message, options = {}) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const targets = chatIds();
  const text = String(message || "").trim();
  if (!isEnabled() || !token || !targets.length || !shouldSend(text, options.dedupeKey)) return;

  await Promise.allSettled(
    targets.map(async (chatId) => {
      const response = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Telegram send failed: ${response.status} ${body.slice(0, 200)}`);
      }
    }),
  ).then((results) => {
    const rejected = results.filter((item) => item.status === "rejected");
    if (rejected.length) {
      logger.warn({ count: rejected.length }, "Telegram notification failed");
    }
  });
}

export function notifyTopupApproved({ topup, user, source = "System" } = {}) {
  const lines = [
    "<b>Top-up approved</b>",
    `Source: ${escapeHtml(source)}`,
    `User: ${escapeHtml(user?.email || user?.name || String(topup?.userId || "-"))}`,
    `Amount: ${money(topup?.amount)}`,
    `Credit added: ${Number(topup?.credit || 0)}`,
    `User credit: ${Number(user?.credit || 0)}`,
    `Payment code: <code>${escapeHtml(topup?.paymentCode || "-")}</code>`,
  ];

  sendTelegramNotification(lines.join("\n")).catch(() => {});
}

export function notifyTopupRejected({ topup, actor } = {}) {
  const lines = [
    "<b>Top-up rejected</b>",
    `Actor: ${escapeHtml(actor?.email || actor?.name || "Admin")}`,
    `Amount: ${money(topup?.amount)}`,
    `Credit: ${Number(topup?.credit || 0)}`,
    `Payment code: <code>${escapeHtml(topup?.paymentCode || "-")}</code>`,
    `Topup: <code>${escapeHtml(shortId(topup?._id))}</code>`,
  ];

  sendTelegramNotification(lines.join("\n")).catch(() => {});
}

export function notifyServerError({ error, req, status } = {}) {
  const path = `${req?.method || ""} ${req?.originalUrl || req?.url || ""}`.trim();
  const normalizedMessage = String(error?.message || "Unknown error")
    .replace(/\s*\([A-Z0-9]{12,}\)\s*$/i, "")
    .trim();
  const lines = [
    "<b>Server error</b>",
    `Status: ${Number(status || 500)}`,
    `Path: <code>${escapeHtml(path)}</code>`,
    `Message: ${escapeHtml(error?.message || "Unknown error")}`,
    `IP: ${escapeHtml(req?.ip || "-")}`,
  ];

  sendTelegramNotification(lines.join("\n"), {
    dedupeKey: `server-error:${Number(status || 500)}:${path}:${normalizedMessage}`,
  }).catch(() => {});
}

export function notify3D66CookiesUnavailable({ reason, error, stats } = {}) {
  const lines = [
    "<b>3D66 cookies unavailable</b>",
    `Reason: ${escapeHtml(reason || "All cookies failed or are cooling down")}`,
    `Total: ${Number(stats?.total || 0)}`,
    `Active: ${Number(stats?.active || 0)}`,
    `Warning: ${Number(stats?.warning || 0)}`,
    `Cooldown: ${Number(stats?.cooldown || 0)}`,
    `Disabled: ${Number(stats?.disabled || 0)}`,
    `Invalid/missing keys: ${Number(stats?.invalid || 0)}`,
  ];

  if (error?.message) {
    lines.push(`Last error: ${escapeHtml(error.message).slice(0, 500)}`);
  }

  sendTelegramNotification(lines.join("\n")).catch(() => {});
}

export function notify3D66ProxyFallback({ stage, proxy, error } = {}) {
  const lines = [
    "<b>3D66 proxy fallback</b>",
    `Stage: ${escapeHtml(stage || "-")}`,
    `Proxy: <code>${escapeHtml(proxy || "-")}</code>`,
    `Reason: ${escapeHtml(error?.message || error || "Proxy request failed").slice(0, 500)}`,
    "Action: switched to default VPS route for this request",
  ];

  sendTelegramNotification(lines.join("\n"), {
    dedupeKey: `3d66-proxy-fallback:${stage || "-"}:${proxy || "-"}`,
  }).catch(() => {});
}

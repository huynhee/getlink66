import logger from "./logger.js";

const methods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const resourceTypes = new Set(["document", "stylesheet", "image", "media", "font", "script", "xhr", "fetch", "websocket", "other"]);
const domains = ["3d66.com", "alicdn.com", "aliyuncs.com", "aliyun.com"];

export function create3D66VerificationDiagnostics(entry, {
  report = event => logger.warn(event, "Manual Getlink verification network diagnostic"), now = Date.now,
} = {}) {
  let closed = false;
  let windowStart = now();
  const seen = new Set();

  function record(kind, request, code) {
    try {
      if (closed || entry.closed || entry.status !== "pending") return;
      const url = new URL(request.url());
      const host = domains.some(domain => url.hostname === domain || url.hostname.endsWith("." + domain))
        ? url.hostname : "external";
      const method = methods.has(request.method()) ? request.method() : "OTHER";
      const resourceType = resourceTypes.has(request.resourceType()) ? request.resourceType() : "other";
      if (now() - windowStart >= 60_000) { seen.clear(); windowStart = now(); }
      const signature = JSON.stringify([kind, host, method, resourceType, code]);
      if (seen.has(signature) || seen.size >= 20) return;
      seen.add(signature);
      const result = report({ type: "GETLINK_VERIFICATION", event: "THREED66_VERIFICATION_NETWORK",
        sessionId: entry.id, kind, host, method, resourceType, code });
      result?.catch?.(() => {});
    } catch { /* Diagnostics must never alter routing or expose raw Playwright errors. */ }
  }

  const failed = request => {
    let code = "REQUEST_FAILED";
    try {
      const error = request.failure()?.errorText;
      if (/^net::ERR_[A-Z0-9_]+$/.test(error)) code = error;
    } catch { /* Keep the generic safe code. */ }
    record("request_failed", request, code);
  };
  const response = reply => {
    try {
      const status = reply.status();
      const request = reply.request();
      if (!Number.isSafeInteger(status) || status < 100 || status > 599) return;
      if (status >= 400 || ["xhr", "fetch"].includes(request.resourceType())) {
        record(status >= 400 ? "http_error" : "response", request, status);
      }
    } catch { /* No headers, body, or full URL are collected. */ }
  };
  function close() {
    if (closed) return;
    closed = true;
    seen.clear();
    entry.context.off?.("requestfailed", failed);
    entry.context.off?.("response", response);
    entry.context.off?.("close", close);
  }
  entry.context.on?.("requestfailed", failed);
  entry.context.on?.("response", response);
  entry.context.on?.("close", close);
  return { blocked: request => record("policy_blocked", request, "POLICY_BLOCKED"), close };
}

import { getlinkLanguage, isPublicGetlinkPath, publicGetlinkError, publicGetlinkJobData } from "./utils/getlinkErrors.js";

const configuredApiUrl = String(import.meta.env?.VITE_API_URL || "").replace(/\/+$/, "");
export const API_URL = configuredApiUrl || (import.meta.env?.PROD ? "" : "http://localhost:5000");
let csrfToken = "";
const publicGetCache = new Map();
const PUBLIC_GET_CACHE_MAX_ENTRIES = 100;

export function marketplaceSessionId() {
  if (typeof window === "undefined") return "";
  const storageKey = "3dipl.marketplace.session";
  let value = window.localStorage.getItem(storageKey) || "";
  if (!/^[A-Za-z0-9_-]{20,160}$/.test(value)) {
    value = typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(storageKey, value);
  }
  return value;
}

export function buildApiUrl(path) {
  return `${API_URL}${path}`;
}

function isMutatingMethod(method = "GET") {
  return !["GET", "HEAD", "OPTIONS"].includes(String(method).toUpperCase());
}

async function getCsrfToken(signal) {
  signal?.throwIfAborted();
  if (csrfToken) return csrfToken;
  const response = await fetch(`${API_URL}/api/auth/csrf`, {
    credentials: "include",
    signal,
  });
  const data = await response.json().catch(() => ({}));
  signal?.throwIfAborted();
  if (!response.ok || !data.csrfToken) {
    throw new Error(data.message || "Cannot initialize security token");
  }
  csrfToken = data.csrfToken;
  return csrfToken;
}

async function readResponseData(response) {
  const rawText = await response.text().catch(() => "");
  if (!rawText) return {};

  try {
    return JSON.parse(rawText);
  } catch {
    return { rawText };
  }
}

function responseErrorMessage(response, data = {}) {
  if (data.code === "PAYMENT_PROVIDER_CHANGED") {
    let english = false;
    try { english = typeof window !== "undefined" && window.localStorage.getItem("language") === "en"; } catch { /* Keep the default locale. */ }
    return english ? "The payment method has changed. Refresh this page before creating a new order."
      : "Cổng thanh toán đã thay đổi. Vui lòng tải lại trang trước khi tạo đơn mới.";
  }
  if (["PAYPAL_API_ERROR", "PAYPAL_API_TIMEOUT", "PAYPAL_CONNECTION_FAILED"].includes(data.code)) {
    let english = false;
    try { english = typeof window !== "undefined" && window.localStorage.getItem("language") === "en"; } catch { /* Keep the fallback locale when storage is unavailable. */ }
    if (data.code === "PAYPAL_API_TIMEOUT") {
      return english
        ? "PayPal did not respond in time. Check your payment history before trying again."
        : "PayPal chưa phản hồi kịp thời. Kiểm tra lịch sử thanh toán trước khi thử lại.";
    }
    return english
      ? "PayPal payment could not be processed. Please try again later or contact support."
      : "Chưa thể xử lý thanh toán PayPal. Vui lòng thử lại sau hoặc liên hệ hỗ trợ.";
  }
  if (data.message) return data.message;

  if ([502, 503, 504].includes(response.status)) {
    return `HTTP ${response.status}: Gateway hoặc dịch vụ phía sau đang gặp lỗi. Vui lòng thử lại sau.`;
  }

  const statusText = String(response.statusText || "").trim();
  return `HTTP ${response.status}${statusText ? `: ${statusText}` : ""}`;
}

function getlinkHeaders(path, headers) {
  if (!isPublicGetlinkPath(path)) return headers;
  return {
    ...Object.fromEntries(Object.entries(headers).filter(([key]) => key.toLowerCase() !== "accept-language")),
    "Accept-Language": getlinkLanguage(),
  };
}

async function sendRequest(path, signal, send) {
  try {
    return await send();
  } catch (error) {
    if (!isPublicGetlinkPath(path) || signal?.aborted || error?.name === "AbortError") throw error;
    const safe = publicGetlinkError({ code: "GETLINK_UNAVAILABLE" });
    throw Object.assign(new Error(safe.message), { code: safe.code });
  }
}

function responseError(path, response, data) {
  const safe = isPublicGetlinkPath(path) ? publicGetlinkError(data) : {
    code: data.code || "", message: responseErrorMessage(response, data),
  };
  return Object.assign(new Error(safe.message), {
    status: response.status,
    code: safe.code,
    data: isPublicGetlinkPath(path) ? { ...publicGetlinkJobData(data), ...safe } : data,
  });
}

export async function api(path, options = {}) {
  const method = options.method || "GET";
  const mutating = isMutatingMethod(method);

  async function send() {
    const headers = getlinkHeaders(path, {
      "Content-Type": "application/json",
      ...(String(path || "").startsWith("/api/marketplace")
        ? { "x-marketplace-session-id": marketplaceSessionId() }
        : {}),
      ...(options.headers || {})
    });

    if (mutating) {
      headers["x-csrf-token"] = await getCsrfToken(options.signal);
    }

    options.signal?.throwIfAborted();
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      credentials: "include",
      headers
    });
    const data = await readResponseData(response);
    options.signal?.throwIfAborted();
    return { response, data };
  }

  let { response, data } = await sendRequest(path, options.signal, send);
  if (response.status === 403 && data.message === "Invalid CSRF token") {
    csrfToken = "";
    if (mutating) {
      ({ response, data } = await sendRequest(path, options.signal, send));
    }
  }
  if (!response.ok) {
    throw responseError(path, response, data);
  }

  return isPublicGetlinkPath(path) ? publicGetlinkJobData(data) : data;
}

export async function apiBinary(path, body, options = {}) {
  const method = options.method || "POST";

  async function send() {
    const headers = getlinkHeaders(path, { ...(options.headers || {}) });
    headers["x-csrf-token"] = await getCsrfToken(options.signal);
    options.signal?.throwIfAborted();
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      method,
      body,
      credentials: "include",
      headers,
    });
    const data = await readResponseData(response);
    options.signal?.throwIfAborted();
    return { response, data };
  }

  let { response, data } = await sendRequest(path, options.signal, send);
  if (response.status === 403 && data.message === "Invalid CSRF token") {
    csrfToken = "";
    ({ response, data } = await sendRequest(path, options.signal, send));
  }
  if (!response.ok) {
    throw responseError(path, response, data);
  }
  return isPublicGetlinkPath(path) ? publicGetlinkJobData(data) : data;
}

function trimPublicGetCache() {
  while (publicGetCache.size > PUBLIC_GET_CACHE_MAX_ENTRIES) {
    const oldestKey = publicGetCache.keys().next().value;
    publicGetCache.delete(oldestKey);
  }
}

export function apiCached(path, { ttlMs = 60_000, force = false } = {}) {
  const key = String(path || "");
  const now = Date.now();
  const current = publicGetCache.get(key);
  if (!force && current?.data && current.expiresAt > now) {
    return Promise.resolve(current.data);
  }
  if (!force && current?.promise) return current.promise;

  const promise = api(key)
    .then((data) => {
      if (publicGetCache.get(key)?.promise !== promise) return data;
      publicGetCache.delete(key);
      publicGetCache.set(key, {
        data,
        expiresAt: Date.now() + Math.max(1_000, Number(ttlMs) || 60_000),
      });
      trimPublicGetCache();
      return data;
    })
    .catch((error) => {
      if (publicGetCache.get(key)?.promise === promise) publicGetCache.delete(key);
      throw error;
    });

  publicGetCache.set(key, { promise, expiresAt: 0 });
  trimPublicGetCache();
  return promise;
}

export function prefetchApi(path, options) {
  return apiCached(path, options).catch(() => null);
}

export function invalidateApiCache(prefix = "") {
  const normalizedPrefix = String(prefix || "");
  for (const key of publicGetCache.keys()) {
    if (!normalizedPrefix || key.startsWith(normalizedPrefix)) publicGetCache.delete(key);
  }
}

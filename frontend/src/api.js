const configuredApiUrl = String(import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
export const API_URL = configuredApiUrl || (import.meta.env.PROD ? "" : "http://localhost:5000");
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

async function getCsrfToken() {
  if (csrfToken) return csrfToken;
  const response = await fetch(`${API_URL}/api/auth/csrf`, {
    credentials: "include"
  });
  const data = await response.json().catch(() => ({}));
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
  if (data.message) return data.message;

  if ([502, 503, 504].includes(response.status)) {
    return `HTTP ${response.status}: Gateway không nhận được phản hồi kịp thời từ backend.`;
  }

  const statusText = String(response.statusText || "").trim();
  return `HTTP ${response.status}${statusText ? `: ${statusText}` : ""}`;
}

export async function api(path, options = {}) {
  const method = options.method || "GET";
  const mutating = isMutatingMethod(method);

  async function send() {
    const headers = {
      "Content-Type": "application/json",
      ...(String(path || "").startsWith("/api/marketplace")
        ? { "x-marketplace-session-id": marketplaceSessionId() }
        : {}),
      ...(options.headers || {})
    };

    if (mutating) {
      headers["x-csrf-token"] = await getCsrfToken();
    }

    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      credentials: "include",
      headers
    });
    const data = await readResponseData(response);
    return { response, data };
  }

  let { response, data } = await send();
  if (response.status === 403 && data.message === "Invalid CSRF token") {
    csrfToken = "";
    if (mutating) {
      ({ response, data } = await send());
    }
  }
  if (!response.ok) {
    const error = new Error(responseErrorMessage(response, data));
    error.status = response.status;
    error.code = data.code || "";
    error.data = data;
    throw error;
  }

  return data;
}

export async function apiBinary(path, body, options = {}) {
  const method = options.method || "POST";

  async function send() {
    const headers = { ...(options.headers || {}) };
    headers["x-csrf-token"] = await getCsrfToken();
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      method,
      body,
      credentials: "include",
      headers,
    });
    const data = await readResponseData(response);
    return { response, data };
  }

  let { response, data } = await send();
  if (response.status === 403 && data.message === "Invalid CSRF token") {
    csrfToken = "";
    ({ response, data } = await send());
  }
  if (!response.ok) {
    const error = new Error(responseErrorMessage(response, data));
    error.status = response.status;
    error.code = data.code || "";
    error.data = data;
    throw error;
  }
  return data;
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

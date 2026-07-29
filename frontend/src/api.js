const configuredApiUrl = String(import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
export const API_URL = configuredApiUrl || (import.meta.env.PROD ? "" : "http://localhost:5000");
let csrfToken = "";

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

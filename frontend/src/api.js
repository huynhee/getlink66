export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
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

export async function api(path, options = {}) {
  const method = options.method || "GET";
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (isMutatingMethod(method)) {
    headers["x-csrf-token"] = await getCsrfToken();
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers
  });

  const data = await response.json().catch(() => ({}));
  if (response.status === 403 && data.message === "Invalid CSRF token") {
    csrfToken = "";
  }
  if (!response.ok) {
    throw new Error(data.message || "Request failed");
  }

  return data;
}

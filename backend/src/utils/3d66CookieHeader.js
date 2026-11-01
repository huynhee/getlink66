const REQUIRED_COOKIE_KEYS = ["PHPSESSID", "login_sign"];

export function parse3D66CookieHeader(value = "") {
  const text = String(value || "");
  if (/[\r\n\0]/.test(text)) return new Map();
  const cookies = new Map();
  for (const part of text.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    if (name) cookies.set(name, part.slice(separator + 1).trim());
  }
  return cookies;
}

export function inspect3D66CookieHeader(value) {
  const cookies = parse3D66CookieHeader(value);
  const missingKeys = REQUIRED_COOKIE_KEYS.filter((key) => !cookies.get(key));
  return { keyCount: cookies.size, missingKeys, hasRequiredKeys: missingKeys.length === 0 };
}

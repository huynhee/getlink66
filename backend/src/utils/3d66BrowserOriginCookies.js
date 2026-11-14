import { parse3D66CookieHeader } from "./3d66CookieHeader.js";
import { is3D66FootprintModelPage } from "./3d66RewrittenFootprintResolver.js";

const AUTH_NAMES = ["PHPSESSID", "login_sign", "login_token"];

export function missing3D66OriginAuthCookies(existing, header, value) {
  if (!is3D66FootprintModelPage(value)) return [];
  const url = new URL(value);
  if (url.hostname === "3d.3d66.com") return [];
  const applies = cookie => {
    const domain = String(cookie.domain || "").toLowerCase();
    // A root host-only cookie is not sent to subdomains, despite sharing a suffix.
    return (domain.startsWith(".") ? url.hostname === domain.slice(1) || url.hostname.endsWith(domain)
      : url.hostname === domain) && (cookie.path || "/") === "/";
  };
  const available = existing.filter(applies);
  if (["PHPSESSID", "login_sign"].every(name => available.some(cookie => cookie.name === name && cookie.value))) return [];
  const hostAuth = available.filter(cookie => cookie.domain === url.hostname && AUTH_NAMES.includes(cookie.name));
  const raw = parse3D66CookieHeader(header);
  const preserved = new Set(hostAuth.map(cookie => cookie.name));
  if (!hostAuth.length) {
    for (const cookie of available) if (cookie.name !== "PHPSESSID") preserved.add(cookie.name);
  }
  return AUTH_NAMES.filter(name => raw.has(name) && !preserved.has(name))
    .map(name => ({ name, value: raw.get(name), url: url.origin }));
}

import { securityEvent } from "../utils/logger.js";

const BLOCKED_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function findUnsafeKey(value, path = "payload", seen = new WeakSet()) {
  if (!value || typeof value !== "object") return "";
  if (seen.has(value)) return "";
  seen.add(value);

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const unsafe = findUnsafeKey(value[index], `${path}[${index}]`, seen);
      if (unsafe) return unsafe;
    }
    return "";
  }

  for (const key of Object.keys(value)) {
    if (key.startsWith("$") || key.includes(".") || BLOCKED_KEYS.has(key)) {
      return `${path}.${key}`;
    }

    const unsafe = findUnsafeKey(value[key], `${path}.${key}`, seen);
    if (unsafe) return unsafe;
  }

  return "";
}

export function requestGuard(req, res, next) {
  const unsafeBodyKey = findUnsafeKey(req.body, "body");
  if (unsafeBodyKey) {
    securityEvent("PROTOTYPE_POLLUTION_ATTEMPT", { ip: req.ip, path: req.path, key: unsafeBodyKey, source: "body" });
    return res.status(400).json({ message: "Invalid request payload" });
  }

  const unsafeQueryKey = findUnsafeKey(req.query, "query");
  if (unsafeQueryKey) {
    securityEvent("NOSQL_INJECTION_ATTEMPT", { ip: req.ip, path: req.path, key: unsafeQueryKey, source: "query" });
    return res.status(400).json({ message: "Invalid request query" });
  }

  return next();
}

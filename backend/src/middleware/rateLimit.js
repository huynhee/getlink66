import { securityEvent } from "../utils/logger.js";

const buckets = new Map();

function cleanup(now) {
  for (const [key, value] of buckets.entries()) {
    if (value.resetAt <= now) buckets.delete(key);
  }
}

export function createRateLimit({
  windowMs = 60_000,
  max = 60,
  keyPrefix = "global",
  keyGenerator = (req) => req.user?._id || req.ip
} = {}) {
  return (req, res, next) => {
    const now = Date.now();
    cleanup(now);

    const rawKey = keyGenerator(req);
    const key = `${keyPrefix}:${String(rawKey || "anonymous")}`;
    const bucket = buckets.get(key) || { count: 0, resetAt: now + windowMs };
    bucket.count += 1;
    buckets.set(key, bucket);

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader("x-ratelimit-limit", String(max));
    res.setHeader("x-ratelimit-remaining", String(remaining));
    res.setHeader("x-ratelimit-reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      securityEvent("RATE_LIMIT_HIT", { ip: req.ip, key, path: req.path, count: bucket.count });
      res.setHeader("retry-after", String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ message: "Too many requests. Please try again later." });
    }

    return next();
  };
}

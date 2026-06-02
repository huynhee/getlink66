import { securityEvent } from "../utils/logger.js";

const buckets = new Map();
const MAX_BUCKETS = Number(process.env.RATE_LIMIT_MAX_BUCKETS || 10000);

function maxBuckets() {
  return Number.isFinite(MAX_BUCKETS) && MAX_BUCKETS > 0
    ? Math.floor(MAX_BUCKETS)
    : 10000;
}

function cleanup(now) {
  for (const [key, value] of buckets.entries()) {
    if (value.resetAt <= now) buckets.delete(key);
  }
}

function evictOverflow() {
  const limit = maxBuckets();
  while (buckets.size > limit) {
    const oldestKey = buckets.keys().next().value;
    if (!oldestKey) return;
    buckets.delete(oldestKey);
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
    if (buckets.has(key)) buckets.delete(key);
    buckets.set(key, bucket);
    evictOverflow();

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader("x-ratelimit-limit", String(max));
    res.setHeader("x-ratelimit-remaining", String(remaining));
    res.setHeader("x-ratelimit-reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      securityEvent("RATE_LIMIT_HIT", { ip: req.ip, key, path: req.path, count: bucket.count });
      res.setHeader("retry-after", String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ message: "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút." });
    }

    return next();
  };
}

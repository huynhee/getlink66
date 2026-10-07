import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const DOWNLOAD_STREAM_BUFFER_BYTES = 256 * 1024;

function positiveInteger(env, name, fallback) {
  const value = Number(env[name] || fallback);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function isSingleByteRange(value) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(value || "").trim());
  if (!match || (!match[1] && !match[2])) return false;
  const start = match[1] ? Number(match[1]) : null;
  const end = match[2] ? Number(match[2]) : null;
  if (start !== null && !Number.isSafeInteger(start)) return false;
  if (end !== null && !Number.isSafeInteger(end)) return false;
  return start === null ? end > 0 : end === null || end >= start;
}

export function normalizeDownloadRange(value) {
  const range = String(value || "").trim();
  if (!range) return "";
  if (range.length > 128 || !isSingleByteRange(range)) {
    const error = new Error("Invalid byte range.");
    error.status = 416;
    error.code = "INVALID_BYTE_RANGE";
    throw error;
  }
  return range.replace(/^bytes=/i, "bytes=");
}

export function createDownloadLimiter(env = process.env) {
  let global = 0;
  const users = new Map();
  const ips = new Map();
  const count = (map, key) => map.get(key) || { total: 0, full: 0 };
  const change = (map, key, delta, full) => {
    const previous = count(map, key);
    const next = { total: previous.total + delta, full: previous.full + (full ? delta : 0) };
    if (!next.total) map.delete(key);
    else map.set(key, next);
  };

  return {
    acquire({ userId, ip, range = "" }) {
      const userKey = String(userId || "anonymous");
      const ipKey = String(ip || "unknown");
      const full = !isSingleByteRange(range);
      const maxGlobal = positiveInteger(env, "MAX_GLOBAL_DOWNLOADS", 20);
      const maxFullUser = positiveInteger(env, "MAX_DOWNLOADS_PER_USER", 2);
      const maxFullIp = positiveInteger(env, "MAX_DOWNLOADS_PER_IP", 4);
      const maxUser = Math.max(maxFullUser, positiveInteger(env, "MAX_DOWNLOAD_RANGE_CONNECTIONS_PER_USER", 6));
      const maxIp = Math.max(maxFullIp, positiveInteger(env, "MAX_DOWNLOAD_RANGE_CONNECTIONS_PER_IP", 12));
      const userCount = count(users, userKey);
      const ipCount = count(ips, ipKey);

      let message = "";
      if (global >= maxGlobal) message = "System has too many active downloads. Please retry later.";
      else if (userCount.total >= maxUser || (full && userCount.full >= maxFullUser)) {
        message = `Account limit: ${maxFullUser} full downloads or ${maxUser} total download connections.`;
      } else if (ipCount.total >= maxIp || (full && ipCount.full >= maxFullIp)) {
        message = `IP limit: ${maxFullIp} full downloads or ${maxIp} total download connections.`;
      }
      if (message) return { ok: false, status: 429, message };

      global += 1;
      change(users, userKey, 1, full);
      change(ips, ipKey, 1, full);
      let released = false;
      return {
        ok: true,
        release() {
          if (released) return;
          released = true;
          global -= 1;
          change(users, userKey, -1, full);
          change(ips, ipKey, -1, full);
        },
      };
    },
  };
}

export const downloadTransferLimiter = createDownloadLimiter();

export async function streamDownloadFile(body, destination, { signal, onMetrics = () => {} } = {}) {
  const startedAt = performance.now();
  let receivedBytes = 0;
  let firstByteMs = null;
  let completed = false;
  const meter = new Transform({
    highWaterMark: DOWNLOAD_STREAM_BUFFER_BYTES,
    transform(chunk, _encoding, callback) {
      if (firstByteMs === null) firstByteMs = Math.round(performance.now() - startedAt);
      receivedBytes += chunk.length;
      callback(null, chunk);
    },
  });

  try {
    const source = typeof body?.getReader === "function"
      ? Readable.fromWeb(body, { highWaterMark: DOWNLOAD_STREAM_BUFFER_BYTES }) : body;
    await pipeline(source, meter, destination, { signal });
    completed = true;
  } finally {
    const elapsed = performance.now() - startedAt;
    try {
      onMetrics({
        completed,
        receivedBytes,
        firstByteMs,
        durationMs: Math.round(elapsed),
        proxyMiBPerSecond: Math.round((receivedBytes / 1048576 / Math.max(elapsed / 1000, 0.001)) * 100) / 100,
      });
    } catch {
      // Telemetry cannot change the completed transfer or mask its original error.
    }
  }
}

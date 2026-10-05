import crypto from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { openGoogleDriveFileStream } from "./storageProvider.js";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const TRANSIENT_CODES = new Set([
  "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT",
  "ECONNRESET", "ETIMEDOUT", "EPIPE", "MARKETPLACE_IMAGE_INCOMPLETE",
]);

function transientImageError(error) {
  if (error.code === "GOOGLE_DRIVE_TOKEN_REFRESH_FAILED") return false;
  return TRANSIENT_CODES.has(error.code) || TRANSIENT_CODES.has(error.cause?.code)
    || error.name === "TimeoutError"
    || [429, 502, 503, 504].includes(error.status)
    || (error instanceof TypeError && /^(terminated|fetch failed)/i.test(error.message));
}

function imageError(message, status, code) {
  return Object.assign(new Error(message), { status, code });
}

function openImage(openFile, image, fileName, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
      return;
    }
    // Shared OAuth refresh can outlive this request; close any stream arriving after cancellation.
    Promise.resolve().then(() => openFile(image.driveFileId, fileName, { signal })).then((file) => {
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) {
        file.stream.destroy();
        reject(signal.reason);
      } else {
        resolve(file);
      }
    }, (error) => {
      signal.removeEventListener("abort", onAbort);
      reject(error);
    });
  });
}

async function readCompleteImage(file, signal, maxBytes) {
  const chunks = [];
  let total = 0;
  const expectedBytes = Number(file.contentLength || 0);
  const onAbort = () => file.stream.destroy(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    signal.throwIfAborted();
    if (expectedBytes > maxBytes) {
      throw imageError("Marketplace image exceeds the size limit.", 413, "MARKETPLACE_IMAGE_TOO_LARGE");
    }
    for await (const chunk of file.stream) {
      signal.throwIfAborted();
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes) {
        throw imageError("Marketplace image exceeds the size limit.", 413, "MARKETPLACE_IMAGE_TOO_LARGE");
      }
      chunks.push(buffer);
    }
    if (!total || (expectedBytes > 0 && expectedBytes !== total) || file.statusCode === 206) {
      throw imageError("Marketplace image source returned an incomplete image.", 502, "MARKETPLACE_IMAGE_INCOMPLETE");
    }
    return Buffer.concat(chunks, total);
  } finally {
    signal.removeEventListener("abort", onAbort);
    if (!file.stream.destroyed) file.stream.destroy();
  }
}

export async function sendMarketplaceImage(req, res, image, fileName, contentType, {
  openFile = openGoogleDriveFileStream,
  maxBytes = MAX_IMAGE_BYTES,
  timeoutMs = 15_000,
  retryDelayMs = 150,
} = {}) {
  if (res.destroyed || res.writableEnded) return;
  const client = new AbortController();
  const onClose = () => { if (!res.writableEnded) client.abort(); };
  res.once("close", onClose);
  let body;
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      client.signal.throwIfAborted();
      const signal = AbortSignal.any([client.signal, AbortSignal.timeout(timeoutMs)]);
      try {
        const file = await openImage(openFile, image, fileName, signal);
        // Never send or cache a partial image: retry before committing HTTP headers.
        body = await readCompleteImage(file, signal, maxBytes);
        break;
      } catch (error) {
        if (client.signal.aborted) return;
        if (!transientImageError(error)) throw error;
        if (attempt === 1) {
          const timeout = error.name === "TimeoutError" || /TIMEOUT/.test(error.code || error.cause?.code || "");
          throw Object.assign(new Error(timeout ? "Marketplace image source timed out." : "Marketplace image source is unavailable.", { cause: error }), {
            status: timeout ? 504 : 502,
            code: timeout ? "MARKETPLACE_IMAGE_TIMEOUT" : "MARKETPLACE_IMAGE_SOURCE_UNAVAILABLE",
          });
        }
        await delay(retryDelayMs, undefined, { signal: client.signal });
      }
    }
    if (client.signal.aborted || res.destroyed || res.writableEnded) return;
    res.setHeader("cache-control", "public, max-age=31536000, immutable");
    res.setHeader("etag", `"${crypto.createHash("sha256").update(body).digest("hex")}"`);
    res.setHeader("cross-origin-resource-policy", "cross-origin");
    res.setHeader("content-type", contentType);
    if (req.fresh) return res.status(304).end();
    res.setHeader("content-length", body.length);
    return res.end(body);
  } catch (error) {
    if (!client.signal.aborted) throw error;
  } finally {
    res.off("close", onClose);
  }
}

import { setTimeout as delay } from "node:timers/promises";
import { prepareArchiveComment } from "./archiveCommentStream.js";
import logger from "./logger.js";

const TRANSIENT_CODES = new Set([
  "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT",
  "ECONNRESET", "ETIMEDOUT", "EPIPE", "EAI_AGAIN",
]);

function transient(error) {
  if (error.code === "GOOGLE_DRIVE_TOKEN_REFRESH_FAILED") return false;
  return ["TimeoutError", "AbortError"].includes(error.name)
    || TRANSIENT_CODES.has(error.code) || TRANSIENT_CODES.has(error.cause?.code)
    || [429, 502, 503, 504].includes(error.status)
    || (error instanceof TypeError && /^(terminated|fetch failed)/i.test(error.message));
}

function withSignal(run, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => { signal.removeEventListener("abort", onAbort); reject(signal.reason); };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) return onAbort();
    // OAuth refresh may outlive the caller. Its late result must not revive a timed-out attempt.
    Promise.resolve().then(() => { signal.throwIfAborted(); return run(); }).then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export async function prepareDownloadArchive(session, comment, {
  prepare = prepareArchiveComment, timeoutMs = 15000, retryDelayMs = 150, signal: callerSignal,
  correlationId = "", log = logger,
} = {}) {
  const startedAt = performance.now();
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    callerSignal?.throwIfAborted();
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(new DOMException("Archive preparation timed out.", "TimeoutError")), timeoutMs);
    const signal = callerSignal ? AbortSignal.any([callerSignal, deadline.signal]) : deadline.signal;
    let stage = "start";
    const details = () => ({ type: "ARCHIVE_PREPARATION", correlationId: correlationId || undefined,
      provider: session.storageProvider, format: session.archiveFormat, attempt, stage,
      durationMs: Math.round(performance.now() - startedAt) });
    try {
      const plan = await withSignal(() => prepare(session, comment, {
        signal, pinDriveVersion: true, onStage: (value) => { stage = value; },
      }), signal);
      log.info({ ...details(), stage: "complete" }, "Archive preparation completed");
      return plan;
    } catch (error) {
      if (callerSignal?.aborted) throw callerSignal.reason;
      if (!transient(error)) throw error;
      log.warn({ ...details(), errorCode: String(error.code || error.name), retrying: attempt < 2 }, "Archive preparation source failure");
      if (attempt === 2) {
        const timeout = ["TimeoutError", "AbortError"].includes(error.name) || /TIMEOUT/.test(error.code || error.cause?.code || "");
        throw Object.assign(new Error(timeout ? "Download preparation took too long. Please try again." : "Download preparation is temporarily unavailable. Please try again.", { cause: error }), {
          status: timeout ? 504 : 502,
          code: timeout ? "DOWNLOAD_PREPARATION_TIMEOUT" : "DOWNLOAD_PREPARATION_UNAVAILABLE",
        });
      }
    } finally { clearTimeout(timer); }
    await delay(retryDelayMs, undefined, { signal: callerSignal });
  }
}

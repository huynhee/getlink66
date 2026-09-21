import { subscribeAccountEvents } from "../utils/accountEventBus.js";

const HEARTBEAT_INTERVAL_MS = 20_000;
const CONNECTION_LIFETIME_MS = 10 * 60_000;

function writeEvent(res, type, data) {
  return res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function accountEvents(req, res, options = {}) {
  const userId = String(req.user?._id || "");
  let unsubscribe = null;
  let heartbeat = null;
  let lifetime = null;
  let closed = false;
  let validating = false;
  let pendingInvalidation = false;
  const expiresAt = options.expiresAt ?? Infinity;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    if (lifetime) clearTimeout(lifetime);
    unsubscribe?.();
  };

  const finish = () => {
    cleanup();
    if (!res.writableEnded) res.end();
  };
  const send = (type, data) => {
    if (closed || res.destroyed || res.writableEnded) return cleanup();
    if (Date.now() >= expiresAt) return finish();
    if (!writeEvent(res, type, data)) {
      cleanup();
      res.destroy();
    }
  };
  const validateAndSend = async (type, data) => {
    if (closed) return;
    if (validating) {
      if (type === "account.updated") pendingInvalidation = true;
      return;
    }
    validating = true;
    try {
      if (!await options.authorize()) return finish();
      send(type, data);
    } catch { finish(); }
    finally {
      validating = false;
      if (pendingInvalidation && !closed) {
        pendingInvalidation = false;
        void validateAndSend("account.updated", { at: new Date().toISOString() });
      }
    }
  };
  unsubscribe = subscribeAccountEvents(userId, (event = {}) => {
    const type = String(event.type || "account.updated");
    // Plugin events only invalidate state; clients fetch their account again.
    if (options.authorize) void validateAndSend("account.updated", { at: new Date().toISOString() });
    else send(type, event.data || {});
  });

  if (!unsubscribe) {
    return res.status(429).json({ message: "Too many account event connections" });
  }

  res.status(200);
  res.set({
    "Cache-Control": "private, no-cache, no-store, no-transform",
    "Content-Type": "text/event-stream; charset=utf-8",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  writeEvent(res, "ready", { userId, at: new Date().toISOString() });

  heartbeat = setInterval(() => {
    if (res.destroyed || res.writableEnded) return cleanup();
    if (options.authorize) {
      void validateAndSend("heartbeat", {});
      return;
    }
    if (!res.write(": keep-alive\n\n")) {
      cleanup();
      res.destroy();
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  lifetime = setTimeout(() => {
    cleanup();
    if (!res.writableEnded) res.end();
  }, Math.max(0, Math.min(CONNECTION_LIFETIME_MS, expiresAt - Date.now())));
  lifetime.unref?.();

  res.once("close", cleanup);
  res.once("error", cleanup);
  return undefined;
}

import { subscribeAccountEvents } from "../utils/accountEventBus.js";

const HEARTBEAT_INTERVAL_MS = 20_000;
const CONNECTION_LIFETIME_MS = 10 * 60_000;

function writeEvent(res, type, data) {
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function accountEvents(req, res) {
  const userId = String(req.user?._id || "");
  let unsubscribe = null;
  let heartbeat = null;
  let lifetime = null;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    if (lifetime) clearTimeout(lifetime);
    unsubscribe?.();
  };

  unsubscribe = subscribeAccountEvents(userId, (event = {}) => {
    if (closed || res.destroyed || res.writableEnded) return cleanup();
    writeEvent(res, String(event.type || "account.updated"), event.data || {});
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
    res.write(": keep-alive\n\n");
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  lifetime = setTimeout(() => {
    cleanup();
    if (!res.writableEnded) res.end();
  }, CONNECTION_LIFETIME_MS);
  lifetime.unref?.();

  req.once("close", cleanup);
  return undefined;
}


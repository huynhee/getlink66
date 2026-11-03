import crypto from "node:crypto";

export const verificationCookieHash = value => crypto.createHash("sha256").update(String(value)).digest("hex");

function sessionError(message, status = 409) {
  return Object.assign(new Error(message), { status, code: "THREED66_VERIFICATION_SESSION" });
}

export function create3D66VerificationStore({ now = Date.now, ttlMs = 15 * 60_000,
  readyTtlMs = 5 * 60_000, leaseMs = 90_000, maxSessions = 2 } = {}) {
  const entries = new Map();

  function metadata(entry) {
    return { id: entry.id, productId: entry.seed.productId, status: entry.status,
      createdAt: new Date(entry.createdAt).toISOString(), expiresAt: new Date(entry.expiresAt).toISOString(),
      claimed: Boolean(entry.owner && entry.leaseUntil > now()) };
  }

  async function dispose(entry) {
    if (!entry || entry.closed) return;
    entry.closed = true;
    entries.delete(entry.id);
    clearTimeout(entry.timer);
    await entry.onClosing?.().catch(() => {});
    await entry.context.close().catch(() => {});
    await entry.onClose?.();
  }

  function arm(entry, duration) {
    clearTimeout(entry.timer);
    entry.expiresAt = now() + duration;
    entry.timer = setTimeout(() => {
      if (entry.busy) entry.expireRequested = true;
      else void dispose(entry);
    }, duration);
    entry.timer.unref?.();
  }

  async function sweep() {
    for (const entry of entries.values()) {
      if (entry.expiresAt <= now() && !entry.busy) await dispose(entry);
    }
  }

  function get(id) {
    const entry = entries.get(String(id));
    if (!entry || entry.closed || entry.expiresAt <= now()) throw sessionError("Verification session expired. Retry the original request.", 410);
    return entry;
  }

  function owned(id, owner, token) {
    const entry = get(id);
    if (entry.status !== "pending") throw sessionError("This verification session is no longer pending.", 410);
    const candidate = typeof token === "string" ? token : "";
    if (!/^[a-f0-9]{48}$/.test(candidate) || !entry.owner || entry.owner !== String(owner) || entry.leaseUntil <= now()
      || candidate.length !== entry.token.length
      || !crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(entry.token))) {
      throw sessionError("Claim this verification session before operating it.", 403);
    }
    entry.leaseUntil = Math.min(entry.expiresAt, now() + leaseMs);
    return entry;
  }

  async function exclusive(entry, callback) {
    if (entry.queued >= 8) throw sessionError("Too many pending verification operations.", 429);
    entry.queued += 1;
    const previous = entry.work;
    let release;
    entry.work = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      if (entry.closed) throw sessionError("Verification session expired.", 410);
      entry.busy = true;
      return await callback(entry);
    } finally {
      entry.busy = false;
      entry.queued -= 1;
      release();
      if (entry.expireRequested) await dispose(entry);
    }
  }

  return {
    async retain({ context, page, cookieValue, seed, configurationKey, removeGuard, onClose, onVerified, onClosing }) {
      await sweep();
      const cookieHash = verificationCookieHash(cookieValue);
      const existing = [...entries.values()].find(entry => entry.cookieHash === cookieHash && entry.status === "pending");
      if (existing) return null;
      if (entries.size >= maxSessions) {
        const idle = [...entries.values()].find(entry => entry.status === "verified" && !entry.busy);
        if (idle) await dispose(idle);
      }
      if (entries.size >= maxSessions) return null;
      const entry = { id: crypto.randomUUID(), context, page, cookieHash, seed, configurationKey,
        removeGuard, onClose, onVerified, onClosing, status: "pending", createdAt: now(), owner: "", token: "", leaseUntil: 0,
        work: Promise.resolve(), queued: 0, busy: false, closed: false, pointerDown: false, sequence: -1 };
      entries.set(entry.id, entry);
      arm(entry, ttlMs);
      return entry;
    },
    async list() { await sweep(); return [...entries.values()].filter(entry => entry.status === "pending").map(metadata); },
    get,
    hasContexts() { return entries.size > 0; },
    async assertAvailable(cookieValue, configurationKey) {
      await sweep();
      for (const entry of entries.values()) {
        if (entry.cookieHash !== verificationCookieHash(cookieValue)) continue;
        if (entry.configurationKey !== configurationKey) { await dispose(entry); continue; }
        if (entry.status === "pending") {
          throw Object.assign(new Error("3D66 access is waiting for administrator verification."), {
            status: 423, code: "THREED66_REWRITTEN_FOOTPRINT_FAILED",
            details: { stage: entry.seed.mode === "direct" ? "direct-model" : "rewritten-footprint", reason: "upstream_verification_pending" },
          });
        }
      }
    },
    async acquireReady(cookieValue, configurationKey, productId, modelPage = "") {
      await sweep();
      const entry = [...entries.values()].find(item => item.cookieHash === verificationCookieHash(cookieValue)
        && item.configurationKey === configurationKey && item.status === "verified" && item.seed.productId === productId
        && (!modelPage || item.seed.modelPage === modelPage));
      if (!entry) return null;
      const previous = entry.work;
      let unlock;
      entry.work = new Promise(resolve => { unlock = resolve; });
      await previous;
      if (entry.closed || entry.status !== "verified" || entry.cookieHash !== verificationCookieHash(cookieValue)
        || entry.configurationKey !== configurationKey || entry.seed.productId !== productId
        || (modelPage && entry.seed.modelPage !== modelPage)) { unlock(); return null; }
      entry.busy = true;
      let released = false;
      return { entry, async release() {
        if (released) return;
        released = true;
        entry.busy = false;
        unlock();
        if (entry.closed) return;
        if (entry.expireRequested || entry.context.browser?.()?.isConnected?.() === false) await dispose(entry);
        else if (entry.status === "pending") return;
        else if (entry.readyUntil <= now()) await dispose(entry);
        else arm(entry, Math.min(readyTtlMs, entry.readyUntil - now()));
      } };
    },
    async claim(id, owner) {
      const entry = get(id);
      return exclusive(entry, async () => {
        get(id);
        if (entry.status !== "pending") throw sessionError("This session is already verified.", 410);
        if (entry.owner && entry.leaseUntil > now()) throw sessionError("Another operator already controls this session.");
        if (entry.pointerDown) await entry.page.mouse.up().catch(() => {});
        entry.pointerDown = false;
        entry.owner = String(owner);
        entry.token = crypto.randomBytes(24).toString("hex");
        entry.sequence = -1;
        entry.leaseUntil = Math.min(entry.expiresAt, now() + leaseMs);
        return { session: metadata(entry), token: entry.token };
      });
    },
    async operate(id, owner, token, callback) {
      const entry = owned(id, owner, token);
      return exclusive(entry, current => { owned(id, owner, token); return callback(current); });
    },
    async frame(id, owner, token) {
      return this.operate(id, owner, token, async entry => ({
        image: `data:image/jpeg;base64,${(await entry.page.screenshot({ type: "jpeg", quality: 65, timeout: 5000 })).toString("base64")}`,
        viewport: entry.page.viewportSize(), title: String(await entry.page.title()).slice(0, 160), session: metadata(entry),
      }));
    },
    async input(id, owner, token, input) {
      if (!input || !["down", "move", "up"].includes(input.type)
        || !Number.isSafeInteger(input.sequence) || input.sequence < 0
        || !Number.isFinite(input.x) || !Number.isFinite(input.y)) throw sessionError("Invalid pointer event.", 400);
      return this.operate(id, owner, token, async entry => {
        const viewport = entry.page.viewportSize();
        if (!viewport || input.x < 0 || input.x > viewport.width || input.y < 0 || input.y > viewport.height) {
          throw sessionError("Pointer coordinates are outside the verification viewport.", 400);
        }
        if (input.sequence <= entry.sequence) return;
        if (input.type === "down" && entry.pointerDown) throw sessionError("Pointer is already pressed.");
        if (input.type === "move" && !entry.pointerDown) throw sessionError("Pointer is not pressed.");
        entry.sequence = input.sequence;
        await entry.page.mouse.move(input.x, input.y);
        if (input.type === "down") { await entry.page.mouse.down({ button: "left" }); entry.pointerDown = true; }
        if (input.type === "up") { await entry.page.mouse.up({ button: "left" }); entry.pointerDown = false; }
      });
    },
    async release(id, owner, token) {
      return this.operate(id, owner, token, async entry => {
        if (entry.pointerDown) await entry.page.mouse.up().catch(() => {});
        entry.pointerDown = false;
        entry.owner = ""; entry.token = ""; entry.leaseUntil = 0;
      });
    },
    async verified(entry, cookieValue) {
      if (entry.closed) return;
      await entry.onVerified?.(cookieValue);
      if (entry.closed) throw sessionError("Verification session expired while saving its browser profile.", 410);
      // Keep the restrictive guard while idle; a normal task installs its own scoped routes above it.
      entry.status = "verified";
      entry.cookieHash = verificationCookieHash(cookieValue);
      entry.owner = ""; entry.token = ""; entry.pointerDown = false;
      entry.expireRequested = false;
      entry.readyUntil = now() + ttlMs;
      arm(entry, readyTtlMs);
    },
    pending(entry, page, seed) {
      entry.page = page;
      entry.seed = seed;
      entry.status = "pending";
      entry.owner = ""; entry.token = ""; entry.leaseUntil = 0;
      entry.expireRequested = false;
      arm(entry, ttlMs);
    },
    async discard(id) { await dispose(entries.get(String(id))); },
    async cancel(id, owner, token) { return this.operate(id, owner, token, dispose); },
    async closeAll() { await Promise.all([...entries.values()].map(dispose)); },
  };
}

export const threed66VerificationStore = create3D66VerificationStore();

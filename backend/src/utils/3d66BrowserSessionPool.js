const sourceDomain = value => /(^|\.)3d66\.com$/i.test(String(value).replace(/^\./, ""));

export async function capture3D66BrowserState(context, previousOrigins = []) {
  const origins = new Map(previousOrigins.map(item => [item.origin, item]));
  for (const page of context.pages()) {
    for (const frame of page.frames()) {
      try {
        const url = new URL(frame.url());
        if (url.protocol !== "https:" || !sourceDomain(url.hostname)) continue;
        const localStorage = await frame.evaluate(() => Object.entries(globalThis.localStorage)
          .map(([name, value]) => ({ name, value })));
        origins.set(url.origin, { origin: url.origin, localStorage });
      } catch { /* Keep the last snapshot while an existing frame navigates. */ }
    }
  }
  const state = { cookies: (await context.cookies()).filter(cookie => sourceDomain(cookie.domain)),
    origins: [...origins.values()].filter(item => {
      try { const url = new URL(item.origin); return url.protocol === "https:" && sourceDomain(url.hostname); }
      catch { return false; }
    }) };
  if (Buffer.byteLength(JSON.stringify(state)) > 1024 * 1024) throw new Error("Browser session snapshot is too large");
  return state;
}

export function create3D66BrowserSessionPool({ now = Date.now, idleMs = 10 * 60_000,
  stateTtlMs = 30 * 60_000, maxSessions = 2, maxStates = 20, snapshotTimeoutMs = 1500 } = {}) {
  const entries = new Map();
  const states = new Map();
  let generation = 0;

  function saved(key) {
    const cached = states.get(key);
    if (!cached || now() - cached.at >= stateTtlMs) { states.delete(key); return null; }
    return cached.state;
  }

  async function remember(key, context) {
    const ticket = generation;
    let timer;
    try {
      const state = await Promise.race([
        capture3D66BrowserState(context, saved(key)?.origins),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Snapshot timed out")), snapshotTimeoutMs); }),
      ]);
      if (ticket !== generation) return;
      states.delete(key);
      states.set(key, { state, at: now() });
      while (states.size > maxStates) states.delete(states.keys().next().value);
    } catch { /* Snapshot failure must not turn a successful file operation into a retry. */ }
    finally { clearTimeout(timer); }
  }

  async function dispose(entry, keepState = false) {
    if (entry.closed) return;
    entry.closed = true;
    clearTimeout(entry.timer);
    if (entries.get(entry.key) === entry) entries.delete(entry.key);
    if (keepState && entry.context) await remember(entry.key, entry.context);
    await entry.context?.close().catch(() => {});
  }

  function idle(entry) {
    clearTimeout(entry.timer);
    entry.idleUntil = now() + idleMs;
    entry.timer = setTimeout(() => { if (!entry.busy) void dispose(entry, true); }, idleMs);
    entry.timer.unref?.();
  }

  return {
    remember,
    async acquire(key, createContext) {
      const ticket = generation;
      let entry;
      for (;;) {
        if (ticket !== generation) throw new Error("Browser session pool was closed");
        entry = entries.get(key);
        if (entry?.busy) { await entry.done; continue; }
        if (entry && entry.idleUntil <= now()) { await dispose(entry, true); continue; }
        if (entry) break;
        const capacity = typeof maxSessions === "function" ? maxSessions() : maxSessions;
        if (entries.size >= capacity) {
          const candidate = [...entries.values()].find(item => !item.busy);
          if (!candidate) throw Object.assign(new Error("3D66 browser sessions are busy. Retry shortly."), { status: 503 });
          await dispose(candidate, true);
          continue;
        }
        entry = { key, context: null, busy: false, closed: false };
        entries.set(key, entry);
        break;
      }
      entry.busy = true;
      clearTimeout(entry.timer);
      let unlock;
      entry.done = new Promise(resolve => { unlock = resolve; });
      try {
        if (!entry.context) {
          const state = saved(key);
          const context = await createContext(state);
          if (ticket !== generation || entry.closed) {
            await context.close().catch(() => {});
            throw new Error("Browser session pool was closed");
          }
          entry.context = context;
          entry.restored = Boolean(state);
        }
        if (ticket !== generation || entry.closed) throw new Error("Browser session pool was closed");
      } catch (error) {
        await dispose(entry);
        unlock();
        throw error;
      }
      let released = false;
      return {
        context: entry.context,
        restored: entry.restored,
        async activate() {
          if (entry.idleGuard) await entry.context.unroute("**/*", entry.idleGuard);
          entry.idleGuard = null;
        },
        async release({ discard = false, detached = false } = {}) {
          if (released) return;
          released = true;
          try {
            if (entry.closed) return;
            if (detached) {
              entry.closed = true;
              if (entries.get(key) === entry) entries.delete(key);
              return;
            }
            if (discard) { await dispose(entry); return; }
            entry.idleGuard = route => route.abort("blockedbyclient");
            await entry.context.route("**/*", entry.idleGuard);
            await remember(key, entry.context);
            entry.restored = true;
            const pages = entry.context.pages();
            for (const page of pages.slice(1)) await page.close().catch(() => {});
            idle(entry);
          } catch { await dispose(entry); }
          finally { entry.busy = false; unlock(); }
        },
      };
    },
    async closeAll({ preserveState = false } = {}) {
      generation += 1;
      await Promise.all([...entries.values()].map(entry => dispose(entry, preserveState)));
      if (!preserveState) states.clear();
    },
  };
}

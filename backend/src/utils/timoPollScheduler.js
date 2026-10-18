export const TIMO_ACTIVE_POLL_MS = 5_000;
export const TIMO_IDLE_POLL_MS = 30_000;
export const TIMO_MAX_BACKOFF_MS = 300_000;

export function createTimoPollScheduler({ run, onError, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let enabled = false;
  let timer;
  let dueAt = 0;
  let notBefore = 0;
  let running;
  let wakeRequested = false;

  function schedule(delay) {
    if (!enabled) return;
    const due = Math.max(notBefore, now() + delay);
    if (timer && dueAt <= due) return;
    if (timer) clearTimer(timer);
    dueAt = due;
    timer = setTimer(tick, Math.max(0, due - now()));
    timer.unref?.();
  }

  async function tick() {
    timer = null;
    if (!enabled || running) return;
    notBefore = now() + TIMO_ACTIVE_POLL_MS;
    let delay = TIMO_IDLE_POLL_MS;
    const task = Promise.resolve().then(run);
    running = task;
    try {
      const result = await task;
      if (Number.isFinite(result?.nextPollMs)) delay = Math.min(TIMO_MAX_BACKOFF_MS, Math.max(TIMO_ACTIVE_POLL_MS, result.nextPollMs));
      if (result?.busy) notBefore = Math.max(notBefore, now() + delay);
    } catch (error) {
      delay = Number.isFinite(error?.retryAfterMs) ? Math.min(TIMO_MAX_BACKOFF_MS, Math.max(TIMO_IDLE_POLL_MS, error.retryAfterMs)) : TIMO_IDLE_POLL_MS;
      notBefore = Math.max(notBefore, now() + delay);
      onError?.(error);
    } finally {
      running = null;
      if (wakeRequested) delay = Math.min(delay, TIMO_ACTIVE_POLL_MS);
      wakeRequested = false;
      schedule(delay);
    }
  }

  return {
    start() {
      if (enabled) return;
      enabled = true;
      notBefore = 0;
      schedule(0);
    },
    wake() {
      if (!enabled) return false;
      if (running) wakeRequested = true;
      else schedule(0);
      return true;
    },
    async stop() {
      enabled = false;
      wakeRequested = false;
      if (timer) clearTimer(timer);
      timer = null;
      await running?.catch(() => {});
    },
  };
}

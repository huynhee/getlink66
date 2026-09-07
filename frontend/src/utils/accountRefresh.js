export function createAccountRefresh({ load, commit }) {
  let version = 0;
  let pending = null;
  const invalidate = () => { version += 1; };

  function refresh({ fresh = false } = {}) {
    if (fresh) invalidate();
    if (pending) return pending;
    pending = (async () => {
      // Coalesce reads, but never reuse a snapshot started before a mutation.
      for (;;) {
        const started = version;
        try {
          const value = await load();
          if (started !== version) continue;
          return commit(value);
        } catch (error) {
          if (started !== version) continue;
          throw error;
        }
      }
    })().finally(() => { pending = null; });
    return pending;
  }

  return { invalidate, refresh };
}

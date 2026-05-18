function numberEnv(name, fallback) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function createAsyncLimiter({ envName, fallback = 1, maxQueue = 200 }) {
  let active = 0;
  const queue = [];

  function concurrency() {
    return numberEnv(envName, fallback);
  }

  function runNext() {
    while (active < concurrency() && queue.length > 0) {
      const item = queue.shift();
      active += 1;
      Promise.resolve()
        .then(item.task)
        .then(item.resolve, item.reject)
        .finally(() => {
          active -= 1;
          runNext();
        });
    }
  }

  function run(task) {
    if (queue.length >= maxQueue) {
      const error = new Error("System is busy. Please try again later.");
      error.status = 503;
      return Promise.reject(error);
    }

    return new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      runNext();
    });
  }

  function stats() {
    return {
      active,
      queued: queue.length,
      concurrency: concurrency(),
      maxQueue,
    };
  }

  return { run, stats };
}

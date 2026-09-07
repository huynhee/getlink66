export async function optionalSearchWithin(request, timeoutMs, fallback = null) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(request).catch(() => fallback),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

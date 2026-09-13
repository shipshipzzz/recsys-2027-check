export function isRetryableError(error) {
  const status = Number(error?.status);
  return (
    status === 429 ||
    status >= 500 ||
    ['AbortError', 'TimeoutError', 'TypeError'].includes(error?.name) ||
    /fetch|network|timeout|abort|offline/i.test(error?.message || '')
  );
}

/** Bounded exponential backoff with jitter. Offline/focus handling is owned by the caller. */
export function createRetryScheduler(
  callback,
  {
    maxAttempts = 5,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    random = Math.random,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {},
) {
  let timer = null,
    attempts = 0;
  function cancel() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }
  function schedule() {
    if (timer !== null || attempts >= maxAttempts) return false;
    const delay = Math.min(
      maxDelayMs,
      Math.round(baseDelayMs * 2 ** attempts * (0.8 + 0.4 * random())),
    );
    attempts++;
    timer = setTimer(async () => {
      timer = null;
      try {
        await callback();
      } catch {
        schedule();
      }
    }, delay);
    return true;
  }
  return {
    schedule,
    cancel,
    reset() {
      cancel();
      attempts = 0;
    },
    get attempts() {
      return attempts;
    },
    get pending() {
      return timer !== null;
    },
  };
}

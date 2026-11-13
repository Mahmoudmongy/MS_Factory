const DEFAULT_DELAYS = [1000, 2000];

export function isRetryableStartupError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const code = String(error?.code || '');
  const message = String(error?.message || error || '');

  if (code === 'OFFLINE' || code === 'FACTORY_RECORD_CONFLICT' || /FACTORY_RECORD_CONFLICT|permission|unauthori[sz]ed|forbidden|not found|does not exist/i.test(message)) return false;
  if ([400, 401, 403, 404, 409, 422].includes(status)) return false;
  if (status === 408 || status === 425 || status === 429 || status >= 500) return true;
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError' || error instanceof TypeError) return true;
  return !status && /network|fetch|timeout|timed out|connection|temporar|offline/i.test(message);
}

export async function retryStartup(operation, { attempts = 3, delays = DEFAULT_DELAYS, onRetry, timeoutMs = 9000 } = {}) {
  const limit = Math.max(1, Number(attempts) || 1);
  let lastError;
  for (let attempt = 1; attempt <= limit; attempt++) {
    try {
      let timer;
      try {
        return await Promise.race([
          Promise.resolve().then(operation),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              const timeoutError = new Error('Startup request timed out');
              timeoutError.name = 'TimeoutError';
              reject(timeoutError);
            }, Math.max(1, Number(timeoutMs) || 9000));
          })
        ]);
      } finally { clearTimeout(timer); }
    } catch (error) {
      lastError = error;
      if (attempt >= limit || !isRetryableStartupError(error)) throw error;
      const wait = Math.max(0, Number(delays[attempt - 1] ?? delays[delays.length - 1] ?? 0));
      try { onRetry?.({ attempt, nextAttempt: attempt + 1, wait, error }); } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, wait));
    }
  }
  throw lastError;
}

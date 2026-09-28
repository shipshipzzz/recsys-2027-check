/** Same-origin immutable build assets. Failure bubbles to bootstrap's recoverable reload UI. */
export async function loadJSON(
  url,
  { fetchImpl = globalThis.fetch, base = globalThis.location?.href, timeoutMs = 8000 } = {},
) {
  const target = new URL(url, base);
  if (target.origin !== new URL(base).origin) throw new Error('资料必须从本站加载');
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(target.href, {
          signal: controller.signal,
          credentials: 'omit',
          redirect: 'error',
        });
        if (!response.ok) throw new Error('资料加载失败：' + response.status);
        const value = await response.json();
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new Error('资料格式无效');
        return value;
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('资料加载超时'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

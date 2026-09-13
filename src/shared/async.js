/** Bound UI waiting without treating a late result as a new user action. */
export function withTimeout(promise, milliseconds, message = '请求超时') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

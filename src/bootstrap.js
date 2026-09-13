// This small entry point keeps a failed page chunk from becoming a silent blank screen.
const kind = document.documentElement.dataset.pageKind === 'soe' ? 'soe' : 'rec';
try {
  const saved = localStorage.getItem(kind === 'soe' ? 'soe-personal-theme' : 'recsys-theme');
  const theme = ['light', 'dark'].includes(saved)
    ? saved
    : matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  document.documentElement.dataset.theme = theme;
} catch {
  /* Restricted storage must not prevent startup. */
}

const load = kind === 'soe' ? () => import('./pages/soe.js') : () => import('./pages/rec.js');
load().catch(() => {
  const status =
    document.getElementById('app-loading') ||
    document.body.appendChild(document.createElement('div'));
  status.id = 'app-loading';
  status.setAttribute('role', 'alert');
  status.replaceChildren(
    document.createTextNode('页面初始化失败。本机标记不会被删除，请检查网络后重试。 '),
  );
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = '重新加载';
  retry.addEventListener('click', () => location.reload());
  status.append(retry);
});

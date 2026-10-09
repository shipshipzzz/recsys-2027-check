// This small entry point keeps a failed page chunk from becoming a silent blank screen.
import { KINDS, THEME_KEYS } from './catalog-kinds.js';
const selectedKind = document.documentElement.dataset.pageKind;
const kind = KINDS.includes(selectedKind) ? selectedKind : 'rec';
try {
  const saved = localStorage.getItem(THEME_KEYS[kind]);
  const theme = ['light', 'dark'].includes(saved)
    ? saved
    : matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  document.documentElement.dataset.theme = theme;
} catch {
  /* Restricted storage must not prevent startup. */
}

const loaders = {
  rec: () => import('./pages/rec.js'),
  soe: () => import('./pages/soe.js'),
  div: () => import('./pages/div.js'),
};
const load = loaders[kind];
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

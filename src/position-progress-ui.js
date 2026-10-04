import {
  exportPositionProgress,
  parsePositionProgress,
  summarizePositionImport,
  POSITION_IMPORT_MAX_BYTES,
} from './position-progress.js';

/** Local files only: never send personal progress through catalog or account APIs. */
export function mountPositionProgressControls(container, store, { knownIds, onChange, signal }) {
  const controls = document.createElement('div');
  controls.className = 'position-backup-controls';
  controls.innerHTML =
    '<button type="button" id="position-export">导出岗位进度 JSON（仅本机）</button> <button type="button" id="position-import">导入岗位进度备份</button> <button type="button" id="position-retry" hidden>重试保存岗位进度</button><input id="position-import-file" type="file" accept=".json,application/json" hidden><p id="position-save-status" role="status"></p>';
  container.append(controls);
  const status = controls.querySelector('#position-save-status');
  const input = controls.querySelector('#position-import-file');
  const importButton = controls.querySelector('#position-import');
  const retryButton = controls.querySelector('#position-retry');
  const listen = (element, type, handler) => element.addEventListener(type, handler, { signal });
  function showMessage(message) {
    retryButton.hidden = !store.unsaved;
    status.textContent =
      message +
      (store.unsaved ? ' 尚有进度仅在此页内存中，关闭或刷新会丢失，请导出 JSON 或重试保存。' : '');
  }
  function showSaveStatus(saved) {
    showMessage(
      saved
        ? '岗位进度已保存，仅本机有效，不与账号同步。'
        : '本机存储不可用、旧记录损坏或容量不足，本次保存未完成。',
    );
  }
  listen(retryButton, 'click', () => {
    const saved = store.retry();
    onChange();
    showSaveStatus(saved);
  });
  listen(controls.querySelector('#position-export'), 'click', () => {
    try {
      store.refresh();
      onChange();
      const blob = new Blob([exportPositionProgress(store.snapshot())], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'soe-position-progress.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      showMessage('导出失败：' + error.message);
    }
  });
  listen(importButton, 'click', () => input.click());
  listen(input, 'change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    importButton.disabled = true;
    try {
      if (file.size > POSITION_IMPORT_MAX_BYTES) throw new Error('岗位进度备份不能超过1 MiB。');
      const incoming = parsePositionProgress(await file.text());
      if (signal?.aborted) return;
      store.refresh();
      onChange();
      const summary = summarizePositionImport(store.snapshot(), incoming, knownIds);
      if (!summary.total) {
        showMessage('备份没有岗位记录，未修改当前进度。');
        return;
      }
      const message = `将合并 ${summary.total} 条岗位进度：新增 ${summary.added} 条，覆盖不同状态 ${summary.changed} 条，不变 ${summary.unchanged} 条。\n其中 ${summary.unknown} 条不在当前岗位附表中，将保留其稳定ID，不生成招聘卡片。\n备份外的现有记录保留；同ID使用备份状态。仅写入本机，所有本机使用者共享，不与账号同步。确认导入？`;
      if (!window.confirm(message)) {
        showMessage('已取消导入，当前进度未修改。');
        return;
      }
      const saved = store.merge(incoming);
      onChange();
      showSaveStatus(saved);
      if (saved)
        showMessage(`已合并 ${summary.total} 条岗位进度；未出现在备份中的记录保留，仅本机有效。`);
    } catch (error) {
      showMessage('未导入：' + error.message);
    } finally {
      importButton.disabled = false;
    }
  });
  return { showSaveStatus, showMessage };
}

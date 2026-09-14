import { TimelineStore } from './timeline-store.js';
import { isUUID, normalizeTimelineEvent } from './timeline-model.js';
import { readPages } from './shared/pagination.js';
import { createRetryScheduler, isRetryableError } from './shared/retry.js';

export const TIMELINE_COLUMNS =
  'user_id,id,entry_id,title,company_name,event_type,starts_at,ends_at,status,location,url,notes,is_deleted,mutation_id,created_at,updated_at';
function requireUser(userId) {
  if (!isUUID(userId)) throw new Error('日程账号无效');
}
export async function readTimelineEvents(client, userId) {
  requireUser(userId);
  const signal = AbortSignal.timeout(12000);
  return readPages((offset, size) =>
    client
      .from('user_timeline_events')
      .select(TIMELINE_COLUMNS, { count: 'exact' })
      .eq('user_id', userId)
      .order('id')
      .range(offset, offset + size - 1)
      .abortSignal(signal),
  );
}
export async function writeTimelineEvents(client, userId, batch) {
  requireUser(userId);
  if (!Array.isArray(batch) || batch.length > 100 || batch.some((row) => !isUUID(row?.mutationId)))
    throw new Error('日程写入批次无效');
  const payload = batch.map((row) => ({
    ...normalizeTimelineEvent(row.event),
    user_id: userId,
    mutation_id: row.mutationId,
  }));
  if (new Set(payload.map((row) => row.id)).size !== payload.length)
    throw new Error('日程写入标识重复');
  if (!payload.length) return [];
  const { data, error } = await client
    .from('user_timeline_events')
    .upsert(payload, { onConflict: 'user_id,id' })
    .select(TIMELINE_COLUMNS)
    .abortSignal(AbortSignal.timeout(12000));
  if (error) throw error;
  return data;
}
export async function subscribeTimelineEvents(client, userId, onChange) {
  requireUser(userId);
  await client.realtime.setAuth();
  const channel = client
    .channel('user-timeline:' + userId + ':' + globalThis.crypto.randomUUID())
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'user_timeline_events',
        filter: 'user_id=eq.' + userId,
      },
      onChange,
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') onChange();
    });
  return () => client.removeChannel(channel);
}
export function timelineError(error) {
  if (['PGRST205', '42P01'].includes(error?.code))
    return '日程云端表尚未安装，请由维护者执行个人日程迁移；本机记录仍保留。';
  if (['42501', 'PGRST301'].includes(error?.code))
    return '日程云端访问被拒绝，请检查登录状态或日程权限；本机记录仍保留。';
  return '日程同步未完成，本机记录仍保留；请检查网络后重试。';
}

/** Auth identity is supplied by the existing personal manager, not a second auth listener. */
export function createTimelineSync({
  client,
  storage,
  namespace,
  onChange = () => {},
  onIdentityChange = () => {},
  online = () => globalThis.navigator?.onLine !== false,
}) {
  let store,
    scope = 'guest',
    epoch = 0,
    disposed = false,
    unsubscribe = null,
    flight = null,
    timer = null,
    hasRemote = false;
  const makeStore = (owner) => {
    const next = new TimelineStore(storage, owner, { namespace });
    next.notify = () => {
      if (!disposed && store === next) onChange();
    };
    return next;
  };
  store = makeStore(scope);
  const retry = createRetryScheduler(() => refresh());
  const active = (target, version) => !disposed && store === target && version === epoch;
  function schedule() {
    clearTimeout(timer);
    if (!disposed && scope !== 'guest')
      timer = setTimeout(() => {
        timer = null;
        void refresh();
      }, 120);
  }
  function refresh() {
    if (disposed || scope === 'guest') return Promise.resolve(true);
    const target = store,
      version = epoch;
    if (flight?.target === target) {
      flight.again = true;
      return flight.promise;
    }
    const next = { target, again: false, promise: null };
    next.promise = (async () => {
      try {
        const baseline = target.capture();
        const rows = await readTimelineEvents(client, target.scope);
        if (!active(target, version)) return false;
        target.acceptRemote(rows, { baseline });
        hasRemote = true;
        await target.flush((batch) => writeTimelineEvents(client, target.scope, batch), {
          shouldContinue: () => active(target, version),
        });
        if (!active(target, version)) return false;
        target.lastError = null;
        if (!target.pendingCount()) retry.reset();
        return true;
      } catch (error) {
        if (active(target, version)) {
          target.lastError = error;
          if (online() && isRetryableError(error)) retry.schedule();
        }
        return false;
      } finally {
        if (flight === next) flight = null;
        if (active(target, version)) {
          onChange();
          if (next.again) schedule();
        }
      }
    })();
    flight = next;
    onChange();
    return next.promise;
  }
  function clearChannel() {
    const stop = unsubscribe;
    unsubscribe = null;
    if (stop) void Promise.resolve(stop()).catch(() => {});
  }
  return {
    get store() {
      return store;
    },
    get hasRemote() {
      return hasRemote;
    },
    get syncing() {
      return flight?.target === store;
    },
    refresh,
    changed() {
      retry.reset();
      schedule();
    },
    setUser(user) {
      const nextScope = user?.id || 'guest';
      if (nextScope === scope || disposed) return;
      requireUserOrGuest(nextScope);
      epoch++;
      retry.reset();
      clearTimeout(timer);
      clearChannel();
      store.notify = () => {};
      scope = nextScope;
      store = makeStore(scope);
      hasRemote = false;
      onIdentityChange();
      onChange();
      if (scope === 'guest') return;
      const target = store,
        version = epoch;
      void subscribeTimelineEvents(client, scope, schedule)
        .then((stop) => {
          if (!active(target, version)) void Promise.resolve(stop()).catch(() => {});
          else unsubscribe = stop;
        })
        .catch(() => {
          /* Focus/online/manual refresh still work without Realtime. */
        });
      void refresh();
    },
    async importGuest() {
      const target = store,
        version = epoch;
      if (scope === 'guest') return 0;
      const guest = new TimelineStore(storage, 'guest', { namespace });
      if (guest.storageError) throw new Error('访客日程缓存不可读，未执行导入。');
      const events = guest.all().filter((event) => !event.is_deleted);
      if (!events.length) return 0;
      if (!(await refresh()) || !active(target, version))
        throw new Error('尚未读到账号日程，暂不合并；本机访客日程仍保留。');
      const count = target.importGuest(events);
      await refresh();
      if (!active(target, version)) throw new Error('账号已切换，请在原账号中查看导入结果。');
      return count;
    },
    reload() {
      store.reload();
      onChange();
    },
    dispose() {
      disposed = true;
      epoch++;
      retry.cancel();
      clearTimeout(timer);
      clearChannel();
      store.notify = () => {};
    },
  };
}
function requireUserOrGuest(scope) {
  if (scope !== 'guest') requireUser(scope);
}

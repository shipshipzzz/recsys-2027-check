import { isUUID, normalizeTimelineEvent, timestamp } from './timeline-model.js';

function receipt(row, scope) {
  if (!row || row.user_id !== scope || !isUUID(row.mutation_id))
    throw new Error('日程回执归属或标识不正确');
  return {
    event: normalizeTimelineEvent(row),
    mutationId: row.mutation_id,
    changedAt: Date.parse(timestamp(row.updated_at)),
    serverUpdatedAt: timestamp(row.updated_at),
    dirty: false,
  };
}

/** Private, project/account-scoped outbox shared by both recruitment pages. */
export class TimelineStore {
  constructor(storage, scope = 'guest', { namespace = 'default', notify = () => {} } = {}) {
    if (scope !== 'guest' && !isUUID(scope)) throw new Error('日程账号无效');
    this.storage = storage;
    this.scope = scope;
    this.key = 'recsys:timeline:v1:' + namespace + ':' + scope;
    this.notify = notify;
    this.entries = {};
    this.storageError = false;
    this.lastError = null;
    this.inFlight = null;
    this.reload();
  }

  reload() {
    try {
      const raw = this.storage.getItem(this.key);
      if (raw === null) return;
      const data = JSON.parse(raw);
      if (
        data?.version !== 1 ||
        !data.entries ||
        typeof data.entries !== 'object' ||
        Array.isArray(data.entries)
      )
        throw new Error('日程缓存损坏');
      const incoming = {};
      for (const [id, row] of Object.entries(data.entries)) {
        if (
          !row ||
          !isUUID(row.mutationId) ||
          typeof row.dirty !== 'boolean' ||
          !Number.isFinite(row.changedAt)
        )
          throw new Error('日程缓存字段损坏');
        const event = normalizeTimelineEvent(row.event);
        if (id !== event.id) throw new Error('日程缓存标识不一致');
        incoming[id] = { ...row, event };
        if (row.serverUpdatedAt) incoming[id].serverUpdatedAt = timestamp(row.serverUpdatedAt);
      }
      for (const [id, next] of Object.entries(incoming)) {
        const old = this.entries[id];
        if (!old) {
          this.entries[id] = next;
          continue;
        }
        if (old.mutationId === next.mutationId) {
          if (!next.dirty) this.entries[id] = next;
          continue;
        }
        if (old.dirty !== next.dirty) {
          if (next.dirty) this.entries[id] = next;
          continue;
        }
        const remote = !old.dirty && old.serverUpdatedAt && next.serverUpdatedAt;
        const diff = remote
          ? Date.parse(next.serverUpdatedAt) - Date.parse(old.serverUpdatedAt)
          : next.changedAt - old.changedAt;
        if (diff > 0 || (diff === 0 && next.mutationId > old.mutationId)) this.entries[id] = next;
      }
    } catch {
      // Never replace an in-memory draft/outbox with broken storage.
      this.storageError = true;
    }
  }
  persist() {
    try {
      this.storage.setItem(this.key, JSON.stringify({ version: 1, entries: this.entries }));
      this.storageError = false;
    } catch {
      this.storageError = true;
    }
    this.notify();
  }
  all() {
    return Object.values(this.entries).map((row) => structuredClone(row.event));
  }
  get(id) {
    return this.entries[id] ? structuredClone(this.entries[id].event) : null;
  }
  pendingCount() {
    return Object.values(this.entries).filter((row) => row.dirty).length;
  }
  capture() {
    this.reload();
    return structuredClone(this.entries);
  }

  save(input) {
    const event = normalizeTimelineEvent(input);
    this.reload();
    if (!this.entries[event.id] && Object.keys(this.entries).length >= 10000)
      throw new Error('日程已达到本地安全上限，请先备份并联系维护者');
    this.entries[event.id] = {
      event,
      mutationId: globalThis.crypto.randomUUID(),
      changedAt: Math.max(Date.now(), (this.entries[event.id]?.changedAt || 0) + 1),
      dirty: this.scope !== 'guest',
    };
    this.persist();
    return event;
  }
  remove(id) {
    const event = this.get(id);
    if (!event) throw new Error('日程不存在');
    // Keep a tombstone so another device does not keep displaying a deleted event.
    this.save({
      ...event,
      title: '已删除日程',
      company_name: '',
      entry_id: null,
      location: '',
      url: '',
      notes: '',
      ends_at: null,
      status: 'cancelled',
      is_deleted: true,
    });
  }
  importGuest(events) {
    this.reload();
    let imported = 0;
    for (const event of events) {
      // Repeated imports must not overwrite a newer account event or revive its deletion.
      if (!event.is_deleted && !Object.hasOwn(this.entries, event.id)) {
        this.save(event);
        imported++;
      }
    }
    return imported;
  }
  acceptRemote(rows, { baseline } = {}) {
    if (!Array.isArray(rows)) throw new Error('日程云端响应无效');
    const incoming = {};
    for (const row of rows) {
      const next = receipt(row, this.scope);
      if (Object.hasOwn(incoming, next.event.id)) throw new Error('日程云端响应包含重复标识');
      incoming[next.event.id] = next;
    }
    this.reload();
    // The server uses tombstones; absence alone is not permission to destroy local data.
    for (const [id, local] of Object.entries(this.entries)) {
      const atStart = baseline?.[id];
      const changed =
        baseline &&
        (atStart?.mutationId !== local.mutationId ||
          atStart?.serverUpdatedAt !== local.serverUpdatedAt);
      const remote = incoming[id];
      if (
        !remote ||
        local.dirty ||
        changed ||
        (local.serverUpdatedAt &&
          Date.parse(local.serverUpdatedAt) > Date.parse(remote.serverUpdatedAt))
      )
        incoming[id] = local;
    }
    this.entries = incoming;
    this.persist();
  }
  async flush(saveBatch, { shouldContinue = () => true } = {}) {
    if (this.scope === 'guest') return;
    if (this.inFlight) return this.inFlight;
    const run = async () => {
      this.lastError = null;
      try {
        while (shouldContinue()) {
          this.reload();
          const batch = Object.values(this.entries)
            .filter((row) => row.dirty)
            .slice(0, 100)
            .map((row) => structuredClone(row));
          if (!batch.length) break;
          const rows = await saveBatch(batch);
          if (!Array.isArray(rows) || rows.length !== batch.length)
            throw new Error('云端未完整确认日程，记录仍保留在本机');
          const received = rows.map((row) => receipt(row, this.scope));
          const byId = new Map(received.map((row) => [row.event.id, row]));
          if (
            byId.size !== batch.length ||
            batch.some((sent) => {
              const ack = byId.get(sent.event.id);
              return (
                !ack ||
                ack.mutationId !== sent.mutationId ||
                JSON.stringify(ack.event) !== JSON.stringify(sent.event)
              );
            })
          )
            throw new Error('日程回执与本次修改不一致');
          this.reload();
          for (const sent of batch) {
            if (this.entries[sent.event.id]?.mutationId === sent.mutationId) {
              this.entries[sent.event.id] = {
                ...this.entries[sent.event.id],
                dirty: false,
                serverUpdatedAt: byId.get(sent.event.id).serverUpdatedAt,
              };
            }
          }
          this.persist();
        }
      } catch (error) {
        this.lastError = error;
        this.notify();
        throw error;
      }
    };
    this.inFlight = run();
    this.notify();
    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
      this.notify();
    }
  }
}

import { normalizeState, VALID_STATES } from './catalog-model.js';
const validId = (id) => /^(rec|soe)-[a-f0-9]{20}$/.test(id);
const timestamp = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));

/** Pending edits are durable until their exact mutation has a valid server receipt. */
export class StateStore {
  constructor(
    storage,
    scope = 'guest',
    notify = () => {},
    { namespace = 'npqrixancnwbmzcyqafx' } = {},
  ) {
    this.storage = storage;
    this.scope = scope;
    this.notify = notify;
    this.key = 'recsys:cards:v1:' + namespace + ':' + scope;
    this.entries = {};
    this.lastError = null;
    this.storageError = false;
    this.inFlight = null;
    this.reload();
  }

  readDisk() {
    try {
      const raw = this.storage.getItem(this.key);
      if (raw === null) return {};
      const value = JSON.parse(raw);
      if (
        !value ||
        value.version !== 1 ||
        !value.entries ||
        typeof value.entries !== 'object' ||
        Array.isArray(value.entries)
      )
        throw new Error('Invalid state cache');
      const result = {};
      for (const [id, entry] of Object.entries(value.entries)) {
        if (
          validId(id) &&
          entry &&
          VALID_STATES.includes(entry.status) &&
          Number.isFinite(entry.changedAt) &&
          typeof entry.mutationId === 'string' &&
          typeof entry.dirty === 'boolean'
        )
          result[id] = entry;
      }
      return result;
    } catch {
      this.storageError = true;
      return null;
    }
  }

  reload() {
    const disk = this.readDisk();
    if (!disk) return;
    for (const [id, old] of Object.entries(this.entries)) {
      if (this.scope !== 'guest' && !old.dirty && !Object.hasOwn(disk, id)) delete this.entries[id];
    }
    for (const [id, incoming] of Object.entries(disk)) {
      const old = this.entries[id];
      if (!old) {
        this.entries[id] = incoming;
        continue;
      }
      if (old.mutationId === incoming.mutationId) {
        if (!incoming.dirty) this.entries[id] = incoming;
        continue;
      }
      // Device clocks are not comparable to the authoritative server clock.
      if (old.dirty !== incoming.dirty) {
        if (incoming.dirty) this.entries[id] = incoming;
        continue;
      }
      const bothRemote =
        !old.dirty && timestamp(old.serverUpdatedAt) && timestamp(incoming.serverUpdatedAt);
      const difference = bothRemote
        ? Date.parse(incoming.serverUpdatedAt) - Date.parse(old.serverUpdatedAt)
        : incoming.changedAt - old.changedAt;
      if (difference > 0 || (difference === 0 && incoming.mutationId > old.mutationId))
        this.entries[id] = incoming;
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

  status(id) {
    return normalizeState(this.entries[id]?.status);
  }
  pendingCount() {
    return Object.values(this.entries).filter((entry) => entry.dirty).length;
  }

  set(id, status) {
    if (!validId(id) || !VALID_STATES.includes(status)) throw new Error('无效的卡片或状态');
    this.reload();
    const changedAt = Math.max(Date.now(), (this.entries[id]?.changedAt || 0) + 1);
    this.entries[id] = {
      status,
      changedAt,
      mutationId: globalThis.crypto.randomUUID(),
      dirty: this.scope !== 'guest',
    };
    this.persist();
  }

  /** Capture before a read; edits/acknowledgements made during that read must win. */
  capture() {
    this.reload();
    return structuredClone(this.entries);
  }

  acceptRemote(rows, { baseline } = {}) {
    if (!Array.isArray(rows)) throw new Error('云端状态响应无效');
    const remote = {};
    for (const row of rows) {
      if (
        !row ||
        !validId(row.entry_id) ||
        !VALID_STATES.includes(row.status) ||
        !timestamp(row.updated_at) ||
        Object.hasOwn(remote, row.entry_id)
      )
        throw new Error('云端状态字段无效');
      remote[row.entry_id] = {
        status: row.status,
        changedAt: Date.parse(row.updated_at),
        mutationId: 'remote:' + row.updated_at,
        dirty: false,
        serverUpdatedAt: row.updated_at,
      };
    }
    this.reload();
    for (const [id, local] of Object.entries(this.entries)) {
      const atStart = baseline?.[id];
      const changedDuringRead =
        baseline &&
        (atStart?.mutationId !== local.mutationId ||
          atStart?.serverUpdatedAt !== local.serverUpdatedAt);
      const newerReceipt =
        remote[id] &&
        timestamp(local.serverUpdatedAt) &&
        Date.parse(local.serverUpdatedAt) > Date.parse(remote[id].serverUpdatedAt);
      if (local.dirty || changedDuringRead || newerReceipt) remote[id] = local;
    }
    this.entries = remote;
    this.persist();
  }

  async flush(save, { shouldContinue = () => true } = {}) {
    if (this.scope === 'guest') return;
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.flushLoop(save, shouldContinue);
    this.notify();
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
      this.notify();
    }
  }

  async flushLoop(save, shouldContinue) {
    this.lastError = null;
    try {
      while (shouldContinue()) {
        this.reload();
        const batch = Object.entries(this.entries)
          .filter(([, entry]) => entry.dirty)
          .slice(0, 100)
          .map(([entry_id, entry]) => ({ entry_id, ...entry }));
        if (!batch.length) break;
        const rows = await save(batch);
        if (!Array.isArray(rows) || rows.length !== batch.length)
          throw new Error('云端未确认全部标记，稍后重试');
        const receipts = new Map(rows.map((row) => [row?.entry_id, row]));
        // Validate the entire receipt before acknowledging any part of the batch.
        if (
          receipts.size !== batch.length ||
          batch.some((sent) => {
            const receipt = receipts.get(sent.entry_id);
            return !receipt || receipt.status !== sent.status || !timestamp(receipt.updated_at);
          })
        )
          throw new Error('云端返回状态或时间不一致');
        this.reload();
        for (const sent of batch) {
          const current = this.entries[sent.entry_id];
          if (current?.mutationId === sent.mutationId) {
            current.dirty = false;
            current.serverUpdatedAt = receipts.get(sent.entry_id).updated_at;
          }
        }
        this.persist();
      }
    } catch (error) {
      this.lastError = error;
      this.notify();
      throw error;
    }
  }
}

import { readPages } from './shared/pagination.js';
import { VALID_STATES } from './catalog-model.js';

function requireUserId(userId) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(userId))
    throw new Error('无效的用户标识');
}

export async function writeUserStateBatch(client, userId, batch) {
  requireUserId(userId);
  if (
    !Array.isArray(batch) ||
    batch.length > 100 ||
    batch.some(
      (item) =>
        !item ||
        !/^(rec|soe)-[a-f0-9]{20}$/.test(item.entry_id) ||
        !VALID_STATES.includes(item.status),
    ) ||
    new Set(batch.map((item) => item.entry_id)).size !== batch.length
  )
    throw new Error('无效的状态写入批次');
  if (!batch.length) return [];
  const { data, error } = await client
    .from('user_card_states')
    .upsert(
      batch.map((e) => ({ user_id: userId, entry_id: e.entry_id, status: e.status })),
      { onConflict: 'user_id,entry_id' },
    )
    .select('entry_id,status,updated_at')
    .abortSignal(AbortSignal.timeout(12000));
  if (error) throw error;
  return data;
}

export async function readUserStates(client, userId, options = {}) {
  requireUserId(userId);
  const signal = AbortSignal.timeout(12000);
  return readPages(
    (offset, size) =>
      client
        .from('user_card_states')
        .select('entry_id,status,updated_at', { count: 'exact' })
        .eq('user_id', userId)
        .order('entry_id')
        .range(offset, offset + size - 1)
        .abortSignal(signal),
    { ...options, keyOf: (row) => row.entry_id },
  );
}

export async function subscribeUserStates(client, userId, { onChange, onStatus = () => {} } = {}) {
  requireUserId(userId);
  await client.realtime.setAuth();
  const channel = client
    .channel(`user-card-states:${userId}:${globalThis.crypto.randomUUID()}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'user_card_states',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => onChange?.(payload),
    )
    .subscribe((status, error) => onStatus(status, error));
  return { channel, unsubscribe: () => client.removeChannel(channel) };
}

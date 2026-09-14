import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  fromBeijingInput,
  toBeijingInput,
  normalizeTimelineEvent,
  matchesTimeline,
  timelinePhase,
  timelineCounts,
  sortTimeline,
} from '../src/timeline-model.js';
import { TimelineStore } from '../src/timeline-store.js';
import {
  createTimelineSync,
  readTimelineEvents,
  writeTimelineEvents,
  subscribeTimelineEvents,
  timelineError,
} from '../src/timeline-sync.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ID = '11111111-1111-4111-8111-111111111111';
function event(overrides = {}) {
  return normalizeTimelineEvent({
    id: ID,
    title: '在线测评',
    company_name: '测试公司',
    event_type: 'assessment',
    starts_at: '2026-09-15T09:00:00+08:00',
    ends_at: null,
    status: 'pending',
    entry_id: null,
    location: '',
    notes: '',
    url: '',
    is_deleted: false,
    ...overrides,
  });
}
function memory() {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}
function ack(row, owner = A, time = new Date().toISOString()) {
  return {
    ...row.event,
    user_id: owner,
    mutation_id: row.mutationId,
    updated_at: time,
    created_at: time,
  };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fakeClient({ read, write } = {}) {
  const calls = [],
    channels = [];
  const client = {
    calls,
    channels,
    realtime: {
      setAuth: async () => {
        calls.push(['setAuth']);
      },
    },
    channel(name) {
      const channel = {
        name,
        on(_type, filter, callback) {
          this.filter = filter;
          this.callback = callback;
          return this;
        },
        subscribe() {
          return this;
        },
      };
      channels.push(channel);
      return channel;
    },
    async removeChannel(channel) {
      channel.removed = true;
    },
    from(table) {
      const request = { table, user: null, payload: null, start: 0, end: 499 };
      const chain = {
        select(columns, options) {
          request.columns = columns;
          request.options = options;
          return this;
        },
        eq(key, value) {
          assert.equal(key, 'user_id');
          request.user = value;
          return this;
        },
        order(key) {
          assert.equal(key, 'id');
          return this;
        },
        range(start, end) {
          request.start = start;
          request.end = end;
          return this;
        },
        upsert(payload, options) {
          request.payload = payload;
          request.conflict = options.onConflict;
          return this;
        },
        async abortSignal(signal) {
          assert.ok(signal instanceof AbortSignal);
          calls.push(request);
          if (request.payload) {
            if (write) return write(request);
            return {
              data: request.payload.map((row) => ({
                ...row,
                updated_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
              })),
              error: null,
            };
          }
          if (read) return read(request);
          return { data: [], count: 0, error: null };
        },
      };
      return chain;
    },
  };
  return client;
}

test('timeline: Beijing input is independent of machine timezone and validates calendar dates', () => {
  const old = process.env.TZ;
  try {
    for (const timezone of ['UTC', 'America/New_York', 'Asia/Shanghai']) {
      process.env.TZ = timezone;
      assert.equal(fromBeijingInput('2026-09-15T09:30'), '2026-09-15T01:30:00.000Z');
      assert.equal(toBeijingInput('2026-09-15T01:30:00Z'), '2026-09-15T09:30');
    }
  } finally {
    if (old === undefined) delete process.env.TZ;
    else process.env.TZ = old;
  }
  for (const bad of [
    '2026-02-30T12:00',
    '2026-13-01T12:00',
    '2026-09-15T24:00',
    '2026-09-15',
    '1999-12-31T23:00',
  ])
    assert.throws(() => fromBeijingInput(bad));
  assert.equal(fromBeijingInput('2028-02-29T12:00'), '2028-02-29T04:00:00.000Z');
});

test('timeline: title, type, time order, link safety and payload field boundaries are checked', () => {
  for (const fields of [
    { title: ' ' },
    { title: 'x'.repeat(161) },
    { event_type: 'invalid' },
    { status: 'invalid' },
    { entry_id: 'forged' },
    { id: '__proto__' },
    { starts_at: '2026-09-15T09:00' },
    { ends_at: '2026-09-15T09:00:00+08:00' },
    { notes: 'x'.repeat(2001) },
    { url: 'javascript:alert(1)' },
    { url: 'https://name:password@example.test' },
  ])
    assert.throws(() => event(fields));
  const normalized = event({
    user_id: B,
    password: 'never include',
    url: 'https://example.test/a b',
  });
  assert.equal(normalized.user_id, undefined);
  assert.equal(normalized.password, undefined);
  assert.equal(normalized.url, 'https://example.test/a%20b');
});

test('timeline: today, seven-day, overdue and type/status/query filters intersect', () => {
  const now = Date.parse('2026-09-15T12:00:00+08:00');
  const ongoing = event({
    starts_at: '2026-09-14T09:00:00+08:00',
    ends_at: '2026-09-16T18:00:00+08:00',
  });
  assert.equal(timelinePhase(ongoing, now), 'ongoing');
  assert.ok(
    matchesTimeline(
      ongoing,
      { period: 'today', status: 'pending', type: 'assessment', query: '测评' },
      now,
    ),
  );
  assert.ok(matchesTimeline(ongoing, { period: 'week' }, now));
  assert.equal(matchesTimeline(ongoing, { type: 'interview' }, now), false);
  assert.equal(timelinePhase(event(), now), 'overdue');
  assert.ok(matchesTimeline(event(), { period: 'overdue' }, now));
  assert.equal(matchesTimeline(event({ status: 'completed' }), { period: 'overdue' }, now), false);
  assert.equal(matchesTimeline(event({ is_deleted: true }), {}, now), false);
  assert.equal(
    matchesTimeline(event({ starts_at: '2026-09-22T00:00:00+08:00' }), { period: 'week' }, now),
    false,
  );
  assert.equal(sortTimeline([event({ id: B, status: 'completed' }), ongoing])[0].id, ID);
  assert.deepEqual(
    timelineCounts(
      [event(), event({ id: A, status: 'completed' }), event({ id: B, is_deleted: true })],
      now,
    ),
    { pending: 1, today: 1, overdue: 1, completed: 1 },
  );
});

test('timeline: guest CRUD persists between pages, deletion hides and scrubs private text', () => {
  const disk = memory(),
    first = new TimelineStore(disk);
  first.save(event({ notes: 'private', url: 'https://example.test' }));
  const second = new TimelineStore(disk);
  assert.equal(second.get(ID).notes, 'private');
  assert.equal(second.pendingCount(), 0);
  second.save({ ...second.get(ID), status: 'completed' });
  first.reload();
  assert.equal(first.get(ID).status, 'completed');
  first.remove(ID);
  second.reload();
  assert.equal(second.get(ID).is_deleted, true);
  assert.equal(second.get(ID).notes, '');
  assert.equal(second.get(ID).company_name, '');
  assert.equal(second.get(ID).url, '');
});

test('timeline: project and account caches are isolated; guest import is explicit and idempotent', () => {
  const disk = memory();
  const guest = new TimelineStore(disk);
  guest.save(event());
  const user = new TimelineStore(disk, A);
  assert.equal(user.all().length, 0);
  assert.equal(new TimelineStore(disk, B).all().length, 0);
  assert.equal(user.importGuest(guest.all()), 1);
  user.save(event({ title: '账号中的新标题' }));
  assert.equal(user.importGuest(guest.all()), 0);
  assert.equal(user.get(ID).title, '账号中的新标题');
  assert.equal(new TimelineStore(disk, A, { namespace: 'other' }).all().length, 0);
  user.remove(ID);
  assert.equal(user.importGuest(guest.all()), 0);
});

test('timeline: network failure and partial or forged receipts keep every pending mutation', async () => {
  const store = new TimelineStore(memory(), A);
  store.save(event());
  for (const save of [
    async () => {
      throw new Error('network');
    },
    async () => [],
    async (batch) => [ack(batch[0], B)],
    async (batch) => [{ ...ack(batch[0]), title: 'wrong' }],
    async (batch) => [{ ...ack(batch[0]), mutation_id: B }],
  ]) {
    await assert.rejects(store.flush(save));
    assert.equal(store.pendingCount(), 1);
  }
  await store.flush(async (batch) => batch.map((row) => ack(row)));
  assert.equal(store.pendingCount(), 0);
});

test('timeline: an old write receipt cannot erase a newer edit or deletion', async () => {
  const store = new TimelineStore(memory(), A);
  store.save(event());
  let calls = 0;
  await store.flush(async (batch) => {
    calls++;
    if (calls === 1) store.remove(ID);
    return batch.map((row) => ack(row));
  });
  assert.equal(calls, 2);
  assert.equal(store.get(ID).is_deleted, true);
  assert.equal(store.pendingCount(), 0);
});

test('timeline: edits and receipts arriving during a stale read always win', async () => {
  const store = new TimelineStore(memory(), A);
  store.save(event());
  await store.flush(async (batch) => batch.map((row) => ack(row, A, '2026-09-14T00:00:00Z')));
  const old = ack(store.entries[ID], A, '2026-09-14T00:00:00Z');
  const baseline = store.capture();
  store.save(event({ title: '新安排' }));
  await store.flush(async (batch) => batch.map((row) => ack(row, A, '2026-09-14T01:00:00Z')));
  store.acceptRemote([old], { baseline });
  assert.equal(store.get(ID).title, '新安排');
  assert.throws(() => store.acceptRemote([{ ...old, user_id: B }]));
  assert.throws(() => store.acceptRemote([old, old]));
  assert.equal(store.get(ID).title, '新安排');
});

test('timeline: clean devices converge including deletion tombstones', async () => {
  const one = new TimelineStore(memory(), A),
    two = new TimelineStore(memory(), A),
    server = new Map();
  let sequence = 0;
  const save = async (batch) =>
    batch.map((row) => {
      const received = ack(row, A, new Date(Date.UTC(2026, 8, 15, 0, 0, ++sequence)).toISOString());
      server.set(row.event.id, received);
      return received;
    });
  one.save(event());
  await one.flush(save);
  two.acceptRemote([...server.values()]);
  assert.equal(two.get(ID).title, one.get(ID).title);
  two.save({ ...two.get(ID), status: 'completed' });
  await two.flush(save);
  one.acceptRemote([...server.values()]);
  assert.equal(one.get(ID).status, 'completed');
  one.remove(ID);
  await one.flush(save);
  two.acceptRemote([...server.values()]);
  assert.equal(two.get(ID).is_deleted, true);
});

test('timeline: corrupt/quota-limited storage never erases the in-memory outbox', () => {
  const disk = memory(),
    store = new TimelineStore(disk, A);
  store.save(event());
  disk.setItem(store.key, '{bad');
  store.reload();
  assert.equal(store.storageError, true);
  assert.equal(store.get(ID).title, '在线测评');
  disk.setItem = () => {
    throw new Error('quota');
  };
  store.save(event({ title: '仍在内存中' }));
  assert.equal(store.storageError, true);
  assert.equal(store.pendingCount(), 1);
});

test('timeline: bounded batches stop after identity cancellation without losing the next batch', async () => {
  const store = new TimelineStore(memory(), A);
  for (let index = 0; index < 101; index++) store.save(event({ id: crypto.randomUUID() }));
  let active = true;
  await store.flush(
    async (batch) => {
      assert.equal(batch.length, 100);
      active = false;
      return batch.map((row) => ack(row));
    },
    { shouldContinue: () => active },
  );
  assert.equal(store.pendingCount(), 1);
});

test('timeline: cloud operations whitelist fields, scope requests and require authenticated realtime', async () => {
  const client = fakeClient();
  await readTimelineEvents(client, A);
  const store = new TimelineStore(memory(), A);
  store.save(event());
  await store.flush((batch) => writeTimelineEvents(client, A, batch));
  const requests = client.calls.filter((call) => call.table);
  assert.equal(requests[0].user, A);
  assert.equal(requests[1].conflict, 'user_id,id');
  assert.equal(requests[1].payload[0].user_id, A);
  assert.equal(requests[1].payload[0].dirty, undefined);
  assert.equal(requests[1].payload[0].changedAt, undefined);
  await assert.rejects(readTimelineEvents(client, 'guest'));
  await assert.rejects(writeTimelineEvents(client, A, [{ event: event(), mutationId: 'invalid' }]));
  const stop = await subscribeTimelineEvents(client, A, () => {});
  assert.deepEqual(client.calls.at(-1), ['setAuth']);
  assert.equal(client.channels[0].filter.filter, 'user_id=eq.' + A);
  assert.equal(client.channels[0].filter.table, 'user_timeline_events');
  await stop();
  assert.equal(client.channels[0].removed, true);
});

test('timeline: a previous-account read cannot enter the next account view', async (t) => {
  let release;
  const client = fakeClient({
    read: ({ user }) =>
      user === A
        ? new Promise((resolve) => {
            release = resolve;
          })
        : Promise.resolve({ data: [], count: 0 }),
  });
  const sync = createTimelineSync({ client, storage: memory(), namespace: 'test' });
  t.after(() => sync.dispose());
  sync.setUser({ id: A });
  await tick();
  sync.setUser({ id: B });
  await sync.refresh();
  const row = { event: event(), mutationId: crypto.randomUUID() };
  release({ data: [ack(row)], count: 1 });
  await tick();
  assert.equal(sync.store.scope, B);
  assert.equal(sync.store.all().length, 0);
  assert.equal(client.channels.find((channel) => channel.filter.filter.endsWith(A)).removed, true);
});

test('timeline: missing cloud table has an actionable message and preserves offline events', async (t) => {
  const client = fakeClient({
    read: async () => ({ data: null, error: { code: 'PGRST205', message: 'table not found' } }),
  });
  const sync = createTimelineSync({ client, storage: memory(), namespace: 'test' });
  t.after(() => sync.dispose());
  sync.setUser({ id: A });
  sync.store.save(event());
  assert.equal(await sync.refresh(), false);
  assert.match(timelineError(sync.store.lastError), /迁移/);
  assert.equal(sync.store.pendingCount(), 1);
  assert.equal(sync.hasRemote, false);
  assert.equal(client.calls.filter((call) => call.payload).length, 0);
});

test('timeline: migration separates private events from catalog data and restricts ownership', () => {
  const sql = fs.readFileSync(
    new URL('../supabase/migrations/202609140004_user_timeline_events.sql', import.meta.url),
    'utf8',
  );
  assert.match(sql, /primary key \(user_id, id\)/);
  assert.match(sql, /enable row level security/);
  assert.match(
    sql,
    /revoke all on table public\.user_timeline_events from public, anon, authenticated/,
  );
  assert.match(
    sql,
    /using \(\(select auth\.uid\(\)\) = user_id\) with check \(\(select auth\.uid\(\)\) = user_id\)/,
  );
  assert.match(sql, /grant select, insert, update on/);
  assert.doesNotMatch(sql, /grant[^;]*delete/i);
  assert.doesNotMatch(
    sql,
    /(?:insert into|update|delete from) public\.(?:job_entries|user_card_states|timeline_events)\b/i,
  );
});

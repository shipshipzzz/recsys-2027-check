import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { StateStore } from '../src/state-store.js';
import {
  createCatalogResource,
  validateRuntimeCatalog,
  CATALOG_CACHE_TTL,
} from '../src/catalog-cache.js';
import { escapeHTML, safeHref } from '../src/shared/dom.js';
import { chinaDay, dayDistance, deadlineEpoch, timeState } from '../src/shared/time.js';
import { createRetryScheduler, isRetryableError } from '../src/shared/retry.js';
import { readPages } from '../src/shared/pagination.js';
import { withTimeout } from '../src/shared/async.js';
import { writeUserStateBatch, readUserStates } from '../src/cloud-sync.js';

const A = 'rec-' + 'a'.repeat(20),
  B = 'rec-' + 'b'.repeat(20);
const USER = '11111111-1111-4111-8111-111111111111';
const t0 = '2026-09-13T00:00:00Z',
  t1 = '2026-09-13T00:00:01Z',
  t2 = '2026-09-13T00:00:02Z';
const row = (id, status, updated_at = t1) => ({ entry_id: id, status, updated_at });
const ack = (batch, updated_at = t2) =>
  batch.map((item) => row(item.entry_id, item.status, updated_at));
const disk = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
};
const catalog = (kind) =>
  JSON.parse(fs.readFileSync(new URL('../data/' + kind + '.json', import.meta.url), 'utf8'));

for (const kind of ['rec', 'soe'])
  test(kind + ': runtime validator accepts the entire existing snapshot', () => {
    const value = catalog(kind);
    assert.equal(validateRuntimeCatalog(value, kind), value);
  });

test('catalog is immediately usable without even starting a network request', () => {
  let calls = 0;
  const fallback = catalog('rec');
  const original = JSON.stringify(fallback);
  const resource = createCatalogResource({
    kind: 'rec',
    fallback,
    fetchCatalog: () => {
      calls++;
    },
  });
  assert.equal(calls, 0);
  assert.equal(resource.current.ALL_ITEMS.length, 57);
  assert.equal(resource.current.connection, 'fallback');
  assert.equal(JSON.stringify(fallback), original);
});

test('catalog refresh coalesces concurrent requests and caches a valid result', async () => {
  const storage = disk();
  let resolve,
    calls = 0;
  const resource = createCatalogResource({
    kind: 'rec',
    fallback: catalog('rec'),
    storage,
    now: () => 1234,
    fetchCatalog: () => {
      calls++;
      return new Promise((done) => {
        resolve = done;
      });
    },
  });
  const first = resource.refresh(),
    second = resource.refresh();
  assert.equal(first, second);
  assert.equal(resource.refreshing, true);
  resolve(catalog('rec'));
  await first;
  assert.equal(calls, 1);
  assert.equal(resource.refreshing, false);
  assert.equal(resource.current.connection, 'cloud');
  assert.equal(JSON.parse(storage.getItem(resource.cacheKey)).savedAt, 1234);
});

test('fresh catalog caches are namespace isolated and old or future-dated caches are ignored', async () => {
  const storage = disk();
  const build = (namespace, now) =>
    createCatalogResource({
      kind: 'rec',
      fallback: catalog('rec'),
      storage,
      namespace,
      now: () => now,
      fetchCatalog: async () => catalog('rec'),
    });
  await build('one', 100).refresh();
  assert.equal(build('one', 200).current.connection, 'cached');
  assert.equal(build('two', 200).current.connection, 'fallback');
  assert.equal(build('one', 100 + CATALOG_CACHE_TTL + 1).current.connection, 'fallback');
  assert.equal(build('one', 99).current.connection, 'fallback');
});

test('corrupt catalog storage and invalid cloud payloads keep the known-good snapshot', async () => {
  const storage = {
    getItem: () => '{broken',
    setItem: () => {
      throw new Error('quota');
    },
  };
  const resource = createCatalogResource({
    kind: 'soe',
    fallback: catalog('soe'),
    storage,
    fetchCatalog: async () => ({ DATA: [] }),
  });
  const initial = resource.current;
  await resource.refresh();
  assert.equal(resource.current, initial);
  assert.ok(resource.lastError);
  assert.equal(resource.current.ALL_ITEMS.length, catalog('soe').DATA.length);
});

test('a failed optional cache write does not turn a successful cloud fetch into failure', async () => {
  const resource = createCatalogResource({
    kind: 'soe',
    fallback: catalog('soe'),
    storage: {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    },
    fetchCatalog: async () => catalog('soe'),
  });
  await resource.refresh();
  assert.equal(resource.current.connection, 'cloud');
  assert.equal(resource.lastError, null);
});

test('duplicate IDs, invalid enums and malformed history are rejected at the render boundary', () => {
  const value = catalog('rec');
  value.DATA.push(value.DATA[0]);
  assert.throws(() => validateRuntimeCatalog(value, 'rec'));
  const other = catalog('soe');
  other.DATA[0].tier = 'S" onclick="alert(1)';
  assert.throws(() => validateRuntimeCatalog(other, 'soe'));
  const history = catalog('rec');
  history.ORIGINAL_ITEMS[0].links = {};
  assert.throws(() => validateRuntimeCatalog(history, 'rec'));
});

test('HTML escaping and URL allowlisting reject executable schemes, control characters and credentials', () => {
  assert.equal(escapeHTML('<img onerror="x">&'), '&lt;img onerror=&quot;x&quot;&gt;&amp;');
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,x',
    'file:///x',
    '//example.com',
    'https://user:secret@example.com',
    'java\nscript:alert(1)',
    null,
  ])
    assert.equal(safeHref(value), '#');
  assert.equal(safeHref('https://example.com/jobs?q=1'), 'https://example.com/jobs?q=1');
});

test('Beijing calendar and cutoff boundaries are independent of machine timezone', () => {
  assert.equal(chinaDay(new Date('2026-09-12T16:00:00Z')), '2026-09-13');
  assert.equal(dayDistance('2026-09-14', new Date('2026-09-12T16:00:00Z')), 1);
  assert.equal(deadlineEpoch({ date: '2026-09-13' }), Date.parse('2026-09-13T16:00:00Z'));
  assert.equal(
    deadlineEpoch({ date: '2026-09-13', time: '24:00' }),
    Date.parse('2026-09-13T16:00:00Z'),
  );
  assert.equal(
    timeState(
      { date: '2026-09-13', time: '12:00', confidence: 'confirmed' },
      new Date('2026-09-13T04:00:00Z'),
    ).expired,
    true,
  );
  assert.equal(timeState({ date: 'invalid' }).days, null);
});

test('an old read cannot replace an edit that was acknowledged while the read was pending', async () => {
  const store = new StateStore(disk(), USER);
  store.acceptRemote([row(A, 'active', t0)]);
  const baseline = store.capture();
  store.set(A, 'applied');
  await store.flush(async (batch) => ack(batch));
  store.acceptRemote([row(A, 'active', t1)], { baseline });
  assert.equal(store.status(A), 'applied');
  assert.equal(store.pendingCount(), 0);
});

test('an old empty read cannot delete an in-flight edit after its acknowledgement', async () => {
  const store = new StateStore(disk(), USER);
  const baseline = store.capture();
  store.set(A, 'uninterested');
  await store.flush(async (batch) => ack(batch));
  store.acceptRemote([], { baseline });
  assert.equal(store.status(A), 'uninterested');
});

test('older server receipts do not roll back a newer server state', () => {
  const store = new StateStore(disk(), USER);
  store.acceptRemote([row(A, 'applied', t2)]);
  store.acceptRemote([row(A, 'active', t1)]);
  assert.equal(store.status(A), 'applied');
});

test('server ordering wins over a skewed device clock when clean tabs converge', async () => {
  const storage = disk(),
    first = new StateStore(storage, USER);
  first.set(A, 'applied');
  await first.flush(async (batch) => ack(batch, t1));
  first.entries[A].changedAt = Date.parse('2099-01-01');
  first.persist();
  const second = new StateStore(storage, USER);
  second.acceptRemote([row(A, 'uninterested', t2)]);
  first.reload();
  assert.equal(first.status(A), 'uninterested');
});

test('invalid or duplicate batch receipts acknowledge no edits', async () => {
  for (const response of [
    [row(A, 'applied'), row(A, 'applied')],
    [row(A, 'applied', 'invalid'), row(B, 'applied')],
  ]) {
    const store = new StateStore(disk(), USER);
    store.set(A, 'applied');
    store.set(B, 'applied');
    await assert.rejects(store.flush(async () => response));
    assert.equal(store.pendingCount(), 2);
  }
});

test('identity cancellation stops the next batch without losing pending edits', async () => {
  const store = new StateStore(disk(), USER);
  store.set(A, 'applied');
  let active = true,
    calls = 0;
  await store.flush(
    async (batch) => {
      calls++;
      store.set(B, 'uninterested');
      active = false;
      return ack(batch);
    },
    { shouldContinue: () => active },
  );
  assert.equal(calls, 1);
  assert.equal(store.pendingCount(), 1);
  assert.equal(store.status(B), 'uninterested');
});

test('large pending queues use bounded batches instead of a single unbounded upsert', async () => {
  const store = new StateStore(disk(), USER),
    sizes = [];
  for (let i = 0; i < 205; i++) store.set('rec-' + i.toString(16).padStart(20, '0'), 'applied');
  await store.flush(async (batch) => {
    sizes.push(batch.length);
    return ack(batch);
  });
  assert.deepEqual(sizes, [100, 100, 5]);
  assert.equal(store.pendingCount(), 0);
});

test('corrupt storage is reported, and invalid reads cannot erase in-memory edits', () => {
  const storage = disk(),
    store = new StateStore(storage, USER);
  store.set(A, 'applied');
  storage.setItem(store.key, '{bad');
  store.reload();
  assert.equal(store.storageError, true);
  assert.equal(store.status(A), 'applied');
  assert.throws(() => store.acceptRemote([row(A, 'deleted')]));
  assert.equal(store.status(A), 'applied');
});

test('a clean record removed by an authoritative refresh also disappears in another tab', () => {
  const storage = disk(),
    first = new StateStore(storage, USER);
  first.acceptRemote([row(A, 'applied')]);
  const second = new StateStore(storage, USER);
  first.acceptRemote([]);
  second.reload();
  assert.equal(second.status(A), 'active');
});

test('separate Supabase projects do not share personal caches', () => {
  const storage = disk(),
    one = new StateStore(storage, USER, () => {}, { namespace: 'one' });
  one.set(A, 'applied');
  const two = new StateStore(storage, USER, () => {}, { namespace: 'two' });
  assert.equal(two.status(A), 'active');
});

test('retry scheduler deduplicates, backs off, stops at the limit and resets explicitly', async () => {
  const tasks = [],
    delays = [];
  let calls = 0;
  const scheduler = createRetryScheduler(
    () => {
      calls++;
    },
    {
      maxAttempts: 3,
      random: () => 0.5,
      setTimer: (fn, delay) => {
        tasks.push(fn);
        delays.push(delay);
        return tasks.length;
      },
      clearTimer: () => {},
    },
  );
  for (let i = 0; i < 3; i++) {
    assert.equal(scheduler.schedule(), true);
    assert.equal(scheduler.schedule(), false);
    await tasks[i]();
  }
  assert.equal(scheduler.schedule(), false);
  assert.deepEqual(delays, [1000, 2000, 4000]);
  assert.equal(calls, 3);
  scheduler.reset();
  assert.equal(scheduler.attempts, 0);
  assert.equal(scheduler.schedule(), true);
  scheduler.cancel();
});

test('retry jitter respects the hard delay cap and authorization failures are not retried', () => {
  let delay;
  const scheduler = createRetryScheduler(() => {}, {
    baseDelayMs: 1000,
    maxDelayMs: 1000,
    random: () => 1,
    setTimer: (_, value) => {
      delay = value;
      return 1;
    },
    clearTimer: () => {},
  });
  scheduler.schedule();
  assert.equal(delay, 1000);
  scheduler.cancel();
  assert.equal(isRetryableError({ status: 401, message: 'Unauthorized' }), false);
  assert.equal(isRetryableError({ status: 503 }), true);
  assert.equal(isRetryableError(new Error('network offline')), true);
});

test('pagination accounts for a smaller server row cap and preserves stable ordering', async () => {
  const calls = [],
    data = Array.from({ length: 5 }, (_, id) => ({ id }));
  const result = await readPages(
    async (offset, size) => {
      calls.push([offset, size]);
      return { data: data.slice(offset, offset + 2), count: 5 };
    },
    { pageSize: 3 },
  );
  assert.deepEqual(result, data);
  assert.deepEqual(calls, [
    [0, 3],
    [2, 3],
    [4, 3],
  ]);
});

test('pagination rejects duplicate, changing, truncated or oversized results', async () => {
  await assert.rejects(readPages(async () => ({ data: [{ id: 1 }, { id: 1 }], count: 2 })));
  await assert.rejects(readPages(async () => ({ data: [], count: 2 })));
  await assert.rejects(readPages(async () => ({ data: [], count: 10001 })));
  let request = 0;
  await assert.rejects(
    readPages(async () => ({ data: [{ id: ++request }], count: request === 1 ? 2 : 3 }), {
      pageSize: 1,
    }),
  );
});

test('cloud write boundaries reject forged IDs and statuses before any request', async () => {
  const client = {
    from() {
      throw new Error('Network must not be reached');
    },
  };
  await assert.rejects(writeUserStateBatch(client, 'not-a-user', []), /用户/);
  await assert.rejects(
    writeUserStateBatch(client, USER, [{ entry_id: A, status: 'deleted' }]),
    /批次/,
  );
  await assert.rejects(readUserStates(client, '*'), /用户/);
  assert.deepEqual(await writeUserStateBatch(client, USER, []), []);
});

test('UI timeout bounds waiting and preserves successful values and original errors', async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 100), 7);
  const error = new Error('original');
  await assert.rejects(withTimeout(Promise.reject(error), 100), (candidate) => candidate === error);
  await assert.rejects(withTimeout(new Promise(() => {}), 5, 'bounded'), /bounded/);
});

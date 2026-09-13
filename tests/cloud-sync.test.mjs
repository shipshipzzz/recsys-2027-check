import test from 'node:test';
import assert from 'node:assert/strict';
import { readUserStates, subscribeUserStates, writeUserStateBatch } from '../src/cloud-sync.js';

const USER = '11111111-1111-4111-8111-111111111111';
const ENTRY = 'rec-' + 'a'.repeat(20);

test('cloud writes are scoped to the authenticated user and return server acknowledgements', async () => {
  let payload, options, columns, signal;
  const ack = [{ entry_id: ENTRY, status: 'applied', updated_at: '2026-09-13T00:00:00Z' }];
  const client = {
    from(table) {
      assert.equal(table, 'user_card_states');
      return {
        upsert(value, opts) {
          payload = value;
          options = opts;
          return {
            select(value) {
              columns = value;
              return {
                abortSignal(value) {
                  signal = value;
                  return Promise.resolve({ data: ack, error: null });
                },
              };
            },
          };
        },
      };
    },
  };
  const result = await writeUserStateBatch(client, USER, [{ entry_id: ENTRY, status: 'applied' }]);
  assert.deepEqual(payload, [{ user_id: USER, entry_id: ENTRY, status: 'applied' }]);
  assert.deepEqual(options, { onConflict: 'user_id,entry_id' });
  assert.equal(columns, 'entry_id,status,updated_at');
  assert.ok(signal instanceof AbortSignal);
  assert.deepEqual(result, ack);
});

test('cloud reads are explicitly filtered to one user', async () => {
  let selected, filter, signal;
  const rows = [{ entry_id: ENTRY, status: 'uninterested', updated_at: '2026-09-13T00:00:00Z' }];
  const client = {
    from(table) {
      assert.equal(table, 'user_card_states');
      return {
        select(value) {
          selected = value;
          return {
            eq(column, value) {
              filter = [column, value];
              return {
                order(column) {
                  assert.equal(column, 'entry_id');
                  return {
                    range(from, to) {
                      assert.equal(from, 0);
                      assert.equal(to, 499);
                      return {
                        abortSignal(value) {
                          signal = value;
                          return Promise.resolve({ data: rows, count: rows.length, error: null });
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  assert.deepEqual(await readUserStates(client, USER), rows);
  assert.equal(selected, 'entry_id,status,updated_at');
  assert.deepEqual(filter, ['user_id', USER]);
  assert.ok(signal instanceof AbortSignal);
});

test('realtime subscription listens only to the current user and cleans up its channel', async () => {
  let name, config, changeHandler, statusHandler, removed;
  const channel = {
    on(type, value, handler) {
      assert.equal(type, 'postgres_changes');
      config = value;
      changeHandler = handler;
      return this;
    },
    subscribe(handler) {
      statusHandler = handler;
      return this;
    },
  };
  let authCalls = 0;
  const client = {
    realtime: {
      async setAuth() {
        authCalls++;
      },
    },
    channel(value) {
      name = value;
      return channel;
    },
    async removeChannel(value) {
      removed = value;
      return 'ok';
    },
  };
  const changes = [],
    statuses = [];
  const subscription = await subscribeUserStates(client, USER, {
    onChange: (value) => changes.push(value),
    onStatus: (status, error) => statuses.push([status, error]),
  });
  assert.equal(authCalls, 1);
  assert.match(name, new RegExp(`^user-card-states:${USER}:`));
  assert.deepEqual(config, {
    event: '*',
    schema: 'public',
    table: 'user_card_states',
    filter: `user_id=eq.${USER}`,
  });
  changeHandler({ new: { entry_id: ENTRY, status: 'applied' } });
  statusHandler('SUBSCRIBED');
  assert.equal(changes.length, 1);
  assert.deepEqual(statuses, [['SUBSCRIBED', undefined]]);
  await subscription.unsubscribe();
  assert.equal(removed, channel);
});

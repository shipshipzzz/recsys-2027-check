import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deploymentFiles, verifyDeployment, SITE } from '../scripts/verify-pages.mjs';

const REVISION = 'a'.repeat(40);
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recsys-pages-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'assets'));
  fs.writeFileSync(
    path.join(directory, 'release.json'),
    JSON.stringify({
      revision: REVISION,
      catalog_sha256: 'b'.repeat(64),
      counts: { job_entries: 2 },
    }),
  );
  for (const name of ['index.html', 'soe.html']) {
    fs.writeFileSync(
      path.join(directory, name),
      '<html><head><link rel="stylesheet" href="https://fonts.googleapis.com/test.css"><link rel="stylesheet" href="/recsys-2027-check/assets/style.css"><link rel="modulepreload" href="/recsys-2027-check/assets/shared.js"></head><body><script type="module" src="/recsys-2027-check/assets/main.js"></script></body></html>',
    );
  }
  for (const name of ['main.js', 'shared.js', 'style.css'])
    fs.writeFileSync(path.join(directory, 'assets', name), '/* build fixture */');
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    assert.equal(url.origin, new URL(SITE).origin);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, undefined);
    const name = url.pathname.slice(new URL(SITE).pathname.length);
    const type = name.endsWith('.json')
      ? 'application/json'
      : name.endsWith('.html')
        ? 'text/html'
        : name.endsWith('.css')
          ? 'text/css'
          : 'application/javascript';
    return new Response(fs.readFileSync(path.join(directory, name)), {
      headers: { 'content-type': type },
    });
  };
  return { directory, fetchImpl, requests };
}

test('live verification checks release, both pages, shared assets, bytes and MIME without credentials', async (t) => {
  const f = fixture(t);
  assert.equal(deploymentFiles(f.directory).length, 6);
  const receipt = await verifyDeployment({ ...f, revision: REVISION, attempts: 1 });
  assert.equal(receipt.verified, true);
  assert.equal(receipt.files_verified, 6);
  assert.equal(f.requests.length, 6);
});
test('an old release cannot be reported as a successful deployment', async (t) => {
  const f = fixture(t);
  await assert.rejects(
    verifyDeployment({
      ...f,
      revision: REVISION,
      attempts: 1,
      fetchImpl: async () =>
        new Response('{}', { headers: { 'content-type': 'application/json' } }),
    }),
    /differs/,
  );
});
test('wrong script MIME is rejected even when the script bytes are correct', async (t) => {
  const f = fixture(t);
  const fetchImpl = async (url, opts) => {
    const response = await f.fetchImpl(url, opts);
    if (url.pathname.endsWith('.js')) response.headers.set('content-type', 'application/json');
    return response;
  };
  await assert.rejects(
    verifyDeployment({ ...f, fetchImpl, revision: REVISION, attempts: 1 }),
    /MIME/,
  );
});
test('temporary propagation failure retries but never retries indefinitely', async (t) => {
  const f = fixture(t);
  let requests = 0;
  const delays = [];
  const fetchImpl = async (url, opts) =>
    ++requests <= 2 ? new Response('pending', { status: 404 }) : f.fetchImpl(url, opts);
  const result = await verifyDeployment({
    ...f,
    fetchImpl,
    revision: REVISION,
    attempts: 3,
    wait: async (ms) => {
      delays.push(ms);
    },
  });
  assert.equal(result.attempts, 3);
  assert.deepEqual(delays, [2000, 4000]);
  let failed = 0;
  await assert.rejects(
    verifyDeployment({
      ...f,
      revision: REVISION,
      attempts: 2,
      wait: async () => {},
      fetchImpl: async () => {
        failed++;
        return new Response('missing', { status: 404 });
      },
    }),
    /HTTP 404/,
  );
  assert.equal(failed, 2);
});
test('a stale local build and source-code deployment are rejected before network calls', async (t) => {
  const f = fixture(t);
  await assert.rejects(
    verifyDeployment({ ...f, revision: 'c'.repeat(40), attempts: 1 }),
    /Local build is stale/,
  );
  fs.writeFileSync(
    path.join(f.directory, 'index.html'),
    '<script type="module" src="/recsys-2027-check/src/rec.js"></script>',
  );
  assert.throws(() => deploymentFiles(f.directory), /Unexpected script/);
  assert.equal(f.requests.length, 0);
});

test('dynamically imported assets are verified even without HTML preload references', async (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.directory, 'assets', 'lazy-page.js'), 'export const value = 1;');
  assert.ok(deploymentFiles(f.directory).includes('assets/lazy-page.js'));
  const receipt = await verifyDeployment({ ...f, revision: REVISION, attempts: 1 });
  assert.equal(receipt.files_verified, 7);
  const fetchImpl = async (url, options) =>
    url.pathname.endsWith('lazy-page.js')
      ? new Response('export const value = 0;', { headers: { 'content-type': 'text/javascript' } })
      : f.fetchImpl(url, options);
  await assert.rejects(
    verifyDeployment({ ...f, fetchImpl, revision: REVISION, attempts: 1 }),
    /differs/,
  );
});

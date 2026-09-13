import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {ROOT,loadCatalogs,normalizeCatalogs,digest} from './catalog-data.mjs';
import {safeError} from './cloud-catalog.mjs';

export const SITE = 'https://shipshipzzz.github.io/recsys-2027-check/';
const PREFIX = new URL(SITE).pathname;
const sha256 = value => createHash('sha256').update(value).digest('hex');

/** Only inspect public build files, never browser sessions or the CI secret. */
export function deploymentFiles(directory) {
  const files = new Set(['release.json', 'index.html', 'soe.html']);
  for (const name of ['index.html', 'soe.html']) {
    const html = fs.readFileSync(path.join(directory, name), 'utf8');
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)].map(m => m[1]);
    assert.ok(scripts.length, `No built JavaScript in ${name}`);
    for (const script of scripts) {
      assert.ok(script.startsWith(PREFIX + 'assets/'), `Unexpected script path in ${name}`);
    }
    for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      if (!match[1].startsWith(PREFIX + 'assets/')) continue;
      const relative = match[1].slice(PREFIX.length);
      assert.match(relative, /^assets\/[A-Za-z0-9_.-]+\.(?:js|css)$/);
      assert.ok(fs.existsSync(path.join(directory, relative)), `Missing local asset: ${relative}`);
      files.add(relative);
    }
  }
  return [...files];
}

function checkMime(file, contentType) {
  const mime = contentType.split(';')[0].trim().toLowerCase();
  const expected = file.endsWith('.html') ? /^text\/html$/
    : file.endsWith('.json') ? /^application\/json$/
    : file.endsWith('.css') ? /^text\/css$/
    : /^(?:application|text)\/(?:javascript|ecmascript)$/;
  assert.match(mime, expected, `Unexpected MIME type for ${file}`);
}

/** Bounded retries accommodate Pages propagation without masking a wrong release. */
export async function verifyDeployment({
  directory, revision, fetchImpl = globalThis.fetch, attempts = 6,
  wait = sleep, onRetry = () => {},
}) {
  assert.match(revision, /^[a-f0-9]{40}$/);
  assert.ok(Number.isInteger(attempts) && attempts >= 1 && attempts <= 8);
  const local = JSON.parse(fs.readFileSync(path.join(directory, 'release.json'), 'utf8'));
  assert.equal(local.revision, revision, 'Local build is stale; rebuild before verifying');
  const files = deploymentFiles(directory);
  const expected = new Map(files.map(file => [file, sha256(fs.readFileSync(path.join(directory, file)))]));

  async function read(file) {
    const url = new URL(file, SITE);
    url.searchParams.set('verify', revision);
    const response = await fetchImpl(url, {
      redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: {'Cache-Control': 'no-cache'}, signal: AbortSignal.timeout(10000),
    });
    assert.ok(response.ok, `HTTP ${response.status} for ${file}`);
    checkMime(file, response.headers.get('content-type') || '');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(sha256(bytes), expected.get(file), `Published content differs from this build: ${file}`);
    return bytes;
  }

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const remote = JSON.parse((await read('release.json')).toString('utf8'));
      assert.equal(remote.revision, revision, 'Pages is serving another Git revision');
      assert.equal(remote.catalog_sha256, local.catalog_sha256, 'Pages catalog digest is stale');
      // Small sequential batches keep retries bounded and avoid flooding Pages.
      const remaining = files.filter(file => file !== 'release.json');
      for (let i = 0; i < remaining.length; i += 3) {
        await Promise.all(remaining.slice(i, i + 3).map(read));
      }
      return {verified: true, revision, catalog_sha256: local.catalog_sha256,
        counts: local.counts, files_verified: files.length, attempts: attempt, site: SITE};
    } catch (error) {
      if (attempt === attempts) throw error;
      onRetry(attempt, error);
      await wait(Math.min(2000 * 2 ** (attempt - 1), 10000));
    }
  }
}

async function main() {
  const revision = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim();
  const directory = path.join(ROOT, 'dist');
  const local = JSON.parse(fs.readFileSync(path.join(directory, 'release.json'), 'utf8'));
  assert.equal(local.catalog_sha256, digest(normalizeCatalogs(loadCatalogs())), 'Rebuild after editing local catalog data');
  const receipt = await verifyDeployment({directory, revision,
    onRetry: (attempt, error) => console.log(`Pages verification retry ${attempt}: ${safeError(error)}`)});
  fs.mkdirSync(path.join(ROOT, 'test-results'), {recursive: true});
  fs.writeFileSync(path.join(ROOT, 'test-results/pages-verification.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log('PASS: published Pages revision, catalog digest, both HTML entrypoints, all JS/CSS bytes and MIME types match this build.');
  console.log(JSON.stringify(receipt));
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `\n## Live Pages verification\n\n**Passed**: ${receipt.files_verified} public files match commit \`${revision}\` byte-for-byte.\n\nBoth entrypoints and their JavaScript/CSS MIME types were verified. This HTTP check does not simulate a user login.\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(safeError(error)); process.exitCode = 1; });
}

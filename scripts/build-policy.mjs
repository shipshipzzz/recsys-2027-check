import { KINDS, PAGE_FILES, STATIC_CATALOG_ASSETS } from '../src/catalog-kinds.js';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export const BUILD_BUDGETS = Object.freeze({
  // 2026-09-27: 44 new evidence sources and 3 cards add 7,674 gzip bytes.
  // Keep history/offline evidence; measured baseline and revised limits are documented in the review.
  // 2026-10-10: 71 additional entries and their cited evidence: 214,328 gzip bytes.
  // Only the aggregate JSON allowance grows; per-page JSON, raw bytes and every code budget stay fixed.
  totalJsonGzip: 256 * 1024,
  pageJsonGzip: 200 * 1024,
  totalJsonBytes: 2 * 1024 * 1024,
  totalJavaScriptGzip: 210 * 1024,
  pageJavaScriptGzip: 155 * 1024,
  pageCssGzip: 16 * 1024,
  pageHtmlGzip: 14 * 1024,
});
const PREFIX = '/recsys-2027-check/';
const ASSET = /^assets\/[A-Za-z0-9_.-]+\.(?:js|css|json)$/;

/** Compare complete emitted documents to their sole maintenance sources, including history. */
export function validateDataAssets(directory, root, metrics) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, '.vite/manifest.json'), 'utf8'));
  const jsonAssets = {};
  for (const [kind, names] of Object.entries(STATIC_CATALOG_ASSETS))
    for (const name of names) {
      const source = 'data/' + name + '.json';
      const emitted = manifest[source]?.file;
      assert.ok(emitted?.endsWith('.json'), 'Missing JSON in manifest: ' + source);
      assert.match(emitted, ASSET);
      const local = fs.readFileSync(path.join(root, source));
      const built = fs.readFileSync(path.join(directory, emitted));
      assert.deepEqual(
        built,
        local,
        'JSON asset differs from its complete maintenance source: ' + source,
      );
      assert.ok(
        metrics.pages[PAGE_FILES[kind]].assets.includes(emitted),
        'JSON missing from page dependency accounting: ' + kind,
      );
      jsonAssets[emitted] = createHash('sha256').update(built).digest('hex');
    }
  return jsonAssets;
}

/** Check the actual manifest graph, including dynamically imported page entrypoints. */
export function validateBuild(directory, budgets = BUILD_BUDGETS) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, '.vite/manifest.json'), 'utf8'));
  const byFile = new Map(Object.entries(manifest).map(([key, value]) => [value.file, key]));
  const sizes = new Map();
  function asset(file) {
    assert.match(file, ASSET, 'Unsafe or unsupported build asset path');
    const filename = path.join(directory, file);
    assert.ok(fs.existsSync(filename), 'Missing build asset: ' + file);
    assert.ok(fs.lstatSync(filename).isFile(), 'Build assets must be regular files');
    if (!sizes.has(file)) {
      const bytes = fs.readFileSync(filename);
      if (file.endsWith('.json')) JSON.parse(bytes.toString('utf8'));
      assert.doesNotMatch(
        bytes.toString('utf8'),
        /sb_secret_[A-Za-z0-9_-]{20,}/,
        'Privileged key detected in ' + file,
      );
      sizes.set(file, { bytes: bytes.length, gzip: gzipSync(bytes).length });
    }
    return file;
  }
  for (const entry of Object.values(manifest)) {
    asset(entry.file);
    for (const file of [...(entry.css || []), ...(entry.assets || [])]) asset(file);
    for (const key of [...(entry.imports || []), ...(entry.dynamicImports || [])])
      assert.ok(manifest[key], 'Missing manifest dependency: ' + key);
  }
  for (const filename of fs.readdirSync(path.join(directory, 'assets')))
    asset('assets/' + filename);
  const totalJavaScriptGzip = [...sizes]
    .filter(([file]) => file.endsWith('.js'))
    .reduce((sum, [, size]) => sum + size.gzip, 0);
  assert.ok(
    totalJavaScriptGzip <= budgets.totalJavaScriptGzip,
    'Total JavaScript exceeds the gzip budget',
  );
  const jsonSizes = [...sizes].filter(([file]) => file.endsWith('.json'));
  const totalJsonGzip = jsonSizes.reduce((sum, [, size]) => sum + size.gzip, 0);
  const totalJsonBytes = jsonSizes.reduce((sum, [, size]) => sum + size.bytes, 0);
  assert.ok(totalJsonGzip <= budgets.totalJsonGzip, 'Total JSON exceeds gzip budget');
  assert.ok(totalJsonBytes <= budgets.totalJsonBytes, 'Total JSON exceeds raw byte budget');
  const pages = {};
  for (const kind of KINDS) {
    const name = PAGE_FILES[kind],
      key = `src/pages/${kind}.js`;
    const html = fs.readFileSync(path.join(directory, name), 'utf8');
    assert.doesNotMatch(
      html,
      /(?:src|href)=["'][^"']*\/src\//,
      'Deploy built assets, not source code',
    );
    assert.doesNotMatch(
      html,
      /fonts\.(?:googleapis|gstatic)\.com/,
      'External fonts must not block first render',
    );
    assert.doesNotMatch(html, /sb_secret_[A-Za-z0-9_-]{20,}/, 'Privileged key detected in HTML');
    const policyTag = html.match(/<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*>/)?.[0];
    assert.ok(policyTag, 'Missing production CSP');
    const policy = (policyTag.match(/content="([^"]+)"/)?.[1] || '')
      .replaceAll('&#39;', "'")
      .replaceAll('&quot;', '"')
      .replaceAll('&amp;', '&');
    assert.match(
      policy,
      /(?:^|;)\s*script-src 'self';/,
      'Production scripts must be same-origin without inline execution',
    );
    assert.match(policy, /object-src 'none'/, 'Missing object source restriction');
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length, 'No built scripts in ' + name);
    for (const [, attributes, body] of scripts) {
      assert.match(attributes, /src="\/recsys-2027-check\/assets\/[A-Za-z0-9_.-]+\.js"/);
      assert.equal(body.trim(), '', 'Inline executable scripts are not allowed');
    }
    const used = new Set();
    function include(file) {
      asset(file);
      if (used.has(file)) return;
      used.add(file);
      const entry = manifest[byFile.get(file)];
      if (entry) {
        for (const file of [...(entry.css || []), ...(entry.assets || [])]) include(file);
        for (const dependency of entry.imports || []) include(manifest[dependency].file);
      }
    }
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g))
      if (match[1].startsWith(PREFIX + 'assets/')) include(match[1].slice(PREFIX.length));
    assert.ok(manifest[key], 'Missing page chunk: ' + key);
    include(manifest[key].file);
    const javascriptGzip = [...used]
      .filter((file) => file.endsWith('.js'))
      .reduce((sum, file) => sum + sizes.get(file).gzip, 0);
    const cssGzip = [...used]
      .filter((file) => file.endsWith('.css'))
      .reduce((sum, file) => sum + sizes.get(file).gzip, 0);
    const jsonGzip = [...used]
      .filter((file) => file.endsWith('.json'))
      .reduce((sum, file) => sum + sizes.get(file).gzip, 0);
    assert.ok(jsonGzip <= budgets.pageJsonGzip, name + ' exceeds JSON gzip budget');
    const htmlGzip = gzipSync(html).length;
    assert.ok(
      javascriptGzip <= budgets.pageJavaScriptGzip,
      name + ' exceeds the JavaScript gzip budget',
    );
    assert.ok(cssGzip <= budgets.pageCssGzip, name + ' exceeds the CSS gzip budget');
    assert.ok(htmlGzip <= budgets.pageHtmlGzip, name + ' exceeds the HTML gzip budget');
    pages[name] = { javascriptGzip, jsonGzip, cssGzip, htmlGzip, assets: [...used].sort() };
  }
  return {
    budgets,
    totalJavaScriptGzip,
    totalJsonGzip,
    totalJsonBytes,
    pages,
    assets: Object.fromEntries(sizes),
  };
}

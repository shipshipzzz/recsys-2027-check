import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';

export const BUILD_BUDGETS = Object.freeze({
  // Personal timeline adds shared CRUD, validation and private outbox/sync (see docs/personal-timeline.md).
  totalJavaScriptGzip: 195 * 1024,
  pageJavaScriptGzip: 145 * 1024,
  pageCssGzip: 16 * 1024,
  pageHtmlGzip: 14 * 1024,
});
const PREFIX = '/recsys-2027-check/';
const ASSET = /^assets\/[A-Za-z0-9_.-]+\.(?:js|css)$/;

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
    for (const file of entry.css || []) asset(file);
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
  const pages = {};
  for (const [name, key] of [
    ['index.html', 'src/pages/rec.js'],
    ['soe.html', 'src/pages/soe.js'],
  ]) {
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
        for (const css of entry.css || []) include(css);
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
    const htmlGzip = gzipSync(html).length;
    assert.ok(
      javascriptGzip <= budgets.pageJavaScriptGzip,
      name + ' exceeds the JavaScript gzip budget',
    );
    assert.ok(cssGzip <= budgets.pageCssGzip, name + ' exceeds the CSS gzip budget');
    assert.ok(htmlGzip <= budgets.pageHtmlGzip, name + ' exceeds the HTML gzip budget');
    pages[name] = { javascriptGzip, cssGzip, htmlGzip, assets: [...used].sort() };
  }
  return { budgets, totalJavaScriptGzip, pages, assets: Object.fromEntries(sizes) };
}

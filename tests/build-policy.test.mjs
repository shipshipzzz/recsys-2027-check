import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateBuild, validateDataAssets, BUILD_BUDGETS } from '../scripts/build-policy.mjs';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recsys-build-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'assets'));
  fs.mkdirSync(path.join(directory, '.vite'));
  const manifest = {
    bootstrap: {
      file: 'assets/bootstrap.js',
      dynamicImports: ['src/pages/rec.js', 'src/pages/soe.js'],
    },
    shared: { file: 'assets/shared.js' },
    'src/pages/rec.js': { file: 'assets/rec.js', imports: ['shared'] },
    'src/pages/soe.js': { file: 'assets/soe.js', imports: ['shared'] },
  };
  fs.writeFileSync(path.join(directory, '.vite/manifest.json'), JSON.stringify(manifest));
  for (const value of Object.values(manifest))
    fs.writeFileSync(path.join(directory, value.file), 'export const value = 1;');
  for (const name of ['index.html', 'soe.html'])
    fs.writeFileSync(
      path.join(directory, name),
      '<html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; object-src \'none\'"></head><body><script type="module" src="/recsys-2027-check/assets/bootstrap.js"></script></body></html>',
    );
  return directory;
}

test('build policy follows the selected dynamic page and shared static dependencies', (t) => {
  const result = validateBuild(fixture(t));
  assert.ok(result.pages['index.html'].assets.includes('assets/rec.js'));
  assert.ok(!result.pages['index.html'].assets.includes('assets/soe.js'));
  assert.ok(result.pages['soe.html'].assets.includes('assets/shared.js'));
});

test('missing dynamic chunks and unreasonably small budgets fail the build gate', (t) => {
  const directory = fixture(t);
  assert.throws(
    () => validateBuild(directory, { ...BUILD_BUDGETS, totalJavaScriptGzip: 1 }),
    /budget/,
  );
  fs.rmSync(path.join(directory, 'assets/rec.js'));
  assert.throws(() => validateBuild(directory), /Missing build asset/);
});

test('inline scripts and known privileged credentials fail before release generation', (t) => {
  const directory = fixture(t),
    htmlFile = path.join(directory, 'index.html');
  fs.appendFileSync(htmlFile, '<script>alert(1)</script>');
  assert.throws(() => validateBuild(directory));
  fs.writeFileSync(
    path.join(directory, 'assets/shared.js'),
    'const key = "sb_secret_' + 'x'.repeat(32) + '";',
  );
  assert.throws(() => validateBuild(directory), /Privileged key/);
});

test('HTML-encoded CSP emitted by Vite is validated as browser-decoded policy text', (t) => {
  const directory = fixture(t);
  for (const name of ['index.html', 'soe.html']) {
    const file = path.join(directory, name);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll("'", '&#39;'));
  }
  assert.ok(validateBuild(directory).pages['index.html']);
});

test('JSON assets are included in page/total budgets, safety checks and source integrity', (t) => {
  const directory = fixture(t);
  fs.mkdirSync(path.join(directory, 'data'));
  const manifestFile = path.join(directory, '.vite/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest['src/pages/soe.js'].assets = [];
  for (const name of [
    'soe',
    'soe-screening',
    'soe-locations',
    'soe-directory',
    'soe-opportunities',
  ]) {
    const source = 'data/' + name + '.json',
      file = 'assets/' + name + '.json';
    fs.writeFileSync(path.join(directory, source), '{"history":["preserved"]}');
    fs.writeFileSync(path.join(directory, file), '{"history":["preserved"]}');
    manifest[source] = { file };
    manifest['src/pages/soe.js'].assets.push(file);
  }
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  const metrics = validateBuild(directory);
  assert.ok(metrics.totalJsonGzip > 0);
  assert.equal(metrics.pages['soe.html'].jsonGzip, metrics.totalJsonGzip);
  assert.equal(metrics.pages['index.html'].jsonGzip, 0);
  assert.equal(Object.keys(validateDataAssets(directory, directory, metrics)).length, 5);
  assert.throws(
    () => validateBuild(directory, { ...BUILD_BUDGETS, totalJsonGzip: 1 }),
    /JSON.*budget/,
  );
  assert.throws(
    () => validateBuild(directory, { ...BUILD_BUDGETS, pageJsonGzip: 1 }),
    /JSON.*budget/,
  );
  assert.throws(
    () => validateBuild(directory, { ...BUILD_BUDGETS, totalJsonBytes: 1 }),
    /JSON.*budget/,
  );
  const target = path.join(directory, 'assets/soe.json');
  fs.writeFileSync(target, '{"history":[]}');
  assert.throws(
    () => validateDataAssets(directory, directory, validateBuild(directory)),
    /differs/,
  );
  fs.writeFileSync(target, '{"key":"sb_secret_' + 'x'.repeat(32) + '"}');
  assert.throws(() => validateBuild(directory), /Privileged/);
  fs.writeFileSync(target, 'bad json');
  assert.throws(() => validateBuild(directory));
  fs.unlinkSync(target);
  assert.throws(() => validateBuild(directory), /Missing build asset/);
});

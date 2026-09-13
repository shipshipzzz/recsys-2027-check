import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, loadCatalogs, normalizeCatalogs, digest, counts } from './catalog-data.mjs';
import { validateBuild } from './build-policy.mjs';

const dist = path.join(ROOT, 'dist');
const metrics = validateBuild(dist);
const tables = normalizeCatalogs(loadCatalogs());
const revision =
  process.env.GITHUB_SHA ||
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
fs.writeFileSync(
  path.join(dist, 'release.json'),
  JSON.stringify({ revision, catalog_sha256: digest(tables), counts: counts(tables) }, null, 2) +
    '\n',
);
fs.mkdirSync(path.join(ROOT, 'test-results'), { recursive: true });
fs.writeFileSync(
  path.join(ROOT, 'test-results/build-metrics.json'),
  JSON.stringify(metrics, null, 2) + '\n',
);
console.log(
  'PASS: both entrypoints, all manifest dependencies, production CSP, known secret pattern and gzip budgets.',
);
console.log(
  JSON.stringify({ totalJavaScriptGzip: metrics.totalJavaScriptGzip, pages: metrics.pages }),
);

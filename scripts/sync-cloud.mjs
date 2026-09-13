import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, loadCatalogs, normalizeCatalogs, counts, digest } from './catalog-data.mjs';
import { cloudClient, applyCatalog, safeError } from './cloud-catalog.mjs';

// Only the explicitly authorized main-branch production workflow may write.
try {
  const apply = process.argv.includes('--apply');
  const tables = normalizeCatalogs(loadCatalogs());
  const revision =
    process.env.GITHUB_SHA ||
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const runNumber = Number(process.env.GITHUB_RUN_NUMBER || (apply ? 0 : 2147483647));
  if (
    apply &&
    (process.env.GITHUB_ACTIONS !== 'true' ||
      process.env.GITHUB_REF !== 'refs/heads/main' ||
      process.env.GITHUB_REPOSITORY !== 'shipshipzzz/recsys-2027-check')
  )
    throw new Error(
      'Writes are only allowed in this repository main-branch GitHub Actions workflow. Use push or workflow_dispatch.',
    );
  if (!Number.isSafeInteger(runNumber) || runNumber < 1)
    throw new Error('Invalid GitHub workflow run number');
  console.log(
    'Catalog plan:',
    JSON.stringify({
      revision,
      runNumber,
      counts: counts(tables),
      sha256: digest(tables),
      mode: apply ? 'apply' : 'dry-run',
    }),
  );
  const client = cloudClient({ admin: true });
  const receipt = await applyCatalog(client, { tables, revision, runNumber, dryRun: !apply });
  console.log('Catalog transaction receipt:', JSON.stringify(receipt));
  if (apply) {
    fs.mkdirSync(path.join(ROOT, 'test-results'), { recursive: true });
    fs.writeFileSync(
      path.join(ROOT, 'test-results/catalog-sync-receipt.json'),
      JSON.stringify({ ...receipt, payload_sha256: digest(tables) }, null, 2) + '\n',
    );
    if (process.env.GITHUB_STEP_SUMMARY)
      fs.appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `## Supabase catalog synchronized\n\nCommit: \`${revision}\`\n\nTransactional verification: **passed**. Personal states and Auth are not synchronization targets.\n\n\`\`\`json\n${JSON.stringify(receipt, null, 2)}\n\`\`\`\n`,
      );
  }
} catch (error) {
  console.error(safeError(error));
  process.exitCode = 1;
}

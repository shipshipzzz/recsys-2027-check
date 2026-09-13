import assert from 'node:assert/strict';
import { loadCatalogs, normalizeCatalogs, KINDS, TABLE_NAMES } from './catalog-data.mjs';
import { cloudClient, readCatalogTables, assertCloudMatches, safeError } from './cloud-catalog.mjs';

// Public-key-only verification; no private-state values or privileged credentials are read.
try {
  const local = normalizeCatalogs(loadCatalogs()),
    client = cloudClient();
  const cloud = await readCatalogTables(client);
  assertCloudMatches(local, cloud);
  for (const kind of KINDS)
    console.log(
      `${kind}: ${local.job_entries.filter((r) => r.kind === kind).length} cloud cards; every public field and relation matches local JSON.`,
    );
  console.log(
    `PASS: full comparison of ${TABLE_NAMES.length} public catalog tables (including removed links, deadlines, source metadata and history).`,
  );
  const privateRead = await client
    .from('user_card_states')
    .select('entry_id')
    .limit(1)
    .abortSignal(AbortSignal.timeout(10000));
  assert.ok(
    privateRead.error && ['42501', 'PGRST301'].includes(privateRead.error.code),
    'Expected private-state permission denial, not an empty result/network failure',
  );
  console.log('PASS: unauthenticated private-state reads rejected.');
  const rpc = await client
    .rpc('recsys_apply_catalog', {
      p_catalog: {},
      p_revision: '0'.repeat(40),
      p_run_number: 1,
      p_dry_run: true,
    })
    .abortSignal(AbortSignal.timeout(10000));
  assert.equal(
    rpc.error?.code,
    '42501',
    'Public key must not execute the CI synchronization function',
  );
  console.log('PASS: public clients cannot invoke catalog synchronization.');
} catch (error) {
  console.error(safeError(error));
  process.exitCode = 1;
}

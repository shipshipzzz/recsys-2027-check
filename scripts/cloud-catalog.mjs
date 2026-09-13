import { createClient } from '@supabase/supabase-js';
import { TABLE_NAMES, COLUMNS, PRIMARY_KEYS, tableDigest } from './catalog-data.mjs';

export const PROJECT_URL = 'https://npqrixancnwbmzcyqafx.supabase.co';
export const PUBLIC_KEY = 'sb_publishable_ktnbnYd08R8eahv-2qgMQQ_5rrTZog0';
export function cloudClient({ admin = false, env = process.env } = {}) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL || PROJECT_URL;
  // A typo must not send the CI secret to an unrelated host/project.
  if (url !== PROJECT_URL) throw new Error('SUPABASE_URL does not match this repository project');
  const key = admin ? env.SUPABASE_SECRET_KEY : env.VITE_SUPABASE_PUBLISHABLE_KEY || PUBLIC_KEY;
  if (admin && (!key || !/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(key)))
    throw new Error('Configure SUPABASE_SECRET_KEY as a GitHub environment secret (never VITE_*).');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
export async function readTable(client, table) {
  if (!TABLE_NAMES.includes(table)) throw new Error('Table not in catalog allowlist');
  const result = [];
  for (let offset = 0; ; offset += 500) {
    let query = client.from(table).select(COLUMNS[table].join(','));
    for (const key of PRIMARY_KEYS[table]) query = query.order(key);
    const { data, error } = await query
      .range(offset, offset + 499)
      .abortSignal(AbortSignal.timeout(30000));
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!Array.isArray(data)) throw new Error(`Invalid response from ${table}`);
    result.push(...data);
    if (data.length < 500) return result;
    if (result.length > 25000) throw new Error('Catalog row safety limit exceeded');
  }
}
export async function readCatalogTables(client) {
  return Object.fromEntries(
    await Promise.all(TABLE_NAMES.map(async (t) => [t, await readTable(client, t)])),
  );
}
export function assertCloudMatches(expected, actual) {
  for (const table of TABLE_NAMES) {
    if (
      actual[table].length !== expected[table].length ||
      tableDigest(table, actual[table]) !== tableDigest(table, expected[table])
    )
      throw new Error(
        `Cloud mismatch: ${table} (local ${expected[table].length}, cloud ${actual[table].length}). Deployment stopped.`,
      );
  }
}
export async function applyCatalog(client, { tables, revision, runNumber, dryRun = true }) {
  const { data, error } = await client
    .rpc('recsys_apply_catalog', {
      p_catalog: tables,
      p_revision: revision,
      p_run_number: runNumber,
      p_dry_run: dryRun,
    })
    .abortSignal(AbortSignal.timeout(60000));
  if (error)
    throw new Error(`Catalog transaction rejected [${error.code || 'network'}]: ${error.message}`);
  if (
    !data ||
    data.revision !== revision ||
    data.run_number !== runNumber ||
    data.dry_run !== dryRun
  )
    throw new Error('Invalid sync receipt; refusing to report success');
  if (!dryRun && data.verified_in_transaction !== true)
    throw new Error('Missing transactional verification receipt');
  return data;
}
export function safeError(error) {
  return String(error?.message || error)
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED]');
}

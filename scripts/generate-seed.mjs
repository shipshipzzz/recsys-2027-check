import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  loadCatalogs,
  normalizeCatalogs,
  PRIMARY_KEYS,
  COLUMNS,
  counts,
} from './catalog-data.mjs';

// Optional bootstrap export. This never edits data JSON, migration files, or cloud data.
const tables = normalizeCatalogs(loadCatalogs());
const statements = Object.entries(tables)
  .filter(([, rows]) => rows.length)
  .map(([table, rows]) => {
    const columns = COLUMNS[table],
      keys = PRIMARY_KEYS[table];
    const json = JSON.stringify(rows).replaceAll("'", "''");
    return `insert into public.${table} (${columns.join(',')})\nselect ${columns.join(',')} from jsonb_populate_recordset(null::public.${table},'${json}'::jsonb)\non conflict (${keys.join(',')}) do update set ${columns
      .filter((c) => !keys.includes(c))
      .map((c) => `${c}=excluded.${c}`)
      .join(',')};`;
  });
fs.writeFileSync(
  path.join(ROOT, 'supabase/seed.sql'),
  '-- Generated bootstrap catalog. Apply ALL migrations first. Not the daily sync path.\n-- Never imports user_card_states or Auth.\nbegin;\n' +
    statements.join('\n\n') +
    '\ncommit;\n',
);
console.log('Generated local seed.sql only:', JSON.stringify(counts(tables)));

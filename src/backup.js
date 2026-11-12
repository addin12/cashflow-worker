// The weekly backup: every table of the database written as plain SQL (INSERT statements) into a private R2 bucket, one object per table, the newest 8 weeks kept.
// It runs on Sunday night as queue messages of its own (src/daily.js), one table each, so no run reads or writes much at once.
// Restore: create a database, run schema.sql, then run each weekly/<date>/<table>.sql (docs/RESTORE.md).

export const TABLES = ['config', 'transactions', 'tabs', 'monthly_totals', 'stream_months', 'places_seen'];
export const KEEP_WEEKS = 8;

const quote = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

/** The INSERT statements that rebuild `rows` of `table`. */
export function insertsOf(table, rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const head = `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES `;
  return `${rows.map((r) => `${head}(${cols.map((c) => quote(r[c])).join(', ')});`).join('\n')}\n`;
}

/** Writes one table to weekly/<date>/<table>.sql. Returns a short note. */
export async function backupTable(db, bucket, table, { now = Date.now } = {}) {
  if (!bucket) return 'backup: no bucket configured';
  if (!TABLES.includes(table)) throw new Error(`backup: unknown table ${String(table).slice(0, 40)}`);
  const rows = (await db.prepare(`SELECT * FROM "${table}"`).all()).results;
  const day = new Date(now()).toISOString().slice(0, 10);
  await bucket.put(`weekly/${day}/${table}.sql`, insertsOf(table, rows), { httpMetadata: { contentType: 'application/sql' } });
  return `backup ${table}: ${rows.length} rows -> weekly/${day}`;
}

/** Deletes everything but the newest `keep` weekly folders. */
export async function pruneBackups(bucket, { keep = KEEP_WEEKS } = {}) {
  if (!bucket) return 'prune: no bucket configured';
  const folders = new Set();
  let cursor;
  do {
    const page = await bucket.list({ prefix: 'weekly/', cursor });
    page.objects.forEach((o) => folders.add(o.key.split('/')[1]));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const old = [...folders].sort().slice(0, Math.max(0, folders.size - keep));
  for (const day of old) {
    const keys = [];
    let c;
    do {
      const page = await bucket.list({ prefix: `weekly/${day}/`, cursor: c });
      page.objects.forEach((o) => keys.push(o.key));
      c = page.truncated ? page.cursor : undefined;
    } while (c);
    if (keys.length) await bucket.delete(keys);
  }
  return `prune: kept ${folders.size - old.length} week(s), removed ${old.length}`;
}

// Shows how SQLite plans each query the app runs on every request: any "SCAN transactions" would read the whole table (D1 charges rows scanned).
//   node scripts/explain.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
db.exec(execFileSync(process.execPath, ['scripts/gen-seed.mjs', '3000'], { encoding: 'utf8', cwd: new URL('..', import.meta.url), maxBuffer: 50e6 }));
const cut = '2026-09-28';
const Q = {
  'window rows': ["SELECT id, date FROM transactions WHERE id IN (SELECT id FROM transactions WHERE date >= ?1 UNION ALL SELECT id FROM transactions WHERE status = 'pending' UNION ALL SELECT id FROM transactions WHERE shared = 1 UNION ALL SELECT id FROM transactions WHERE category = (SELECT value FROM config WHERE key = 'salary_category')) ORDER BY rowid", [cut]],
  'carry': ['SELECT stream, SUM(net) FROM stream_months WHERE month < ?1 GROUP BY stream', ['2026-10']],
  'places before': ['SELECT owner, place_key FROM places_seen WHERE first_date < ?1', [cut]],
  'sync: rows near': ["SELECT id FROM transactions WHERE date BETWEEN ?1 AND ?2 OR ref_no IN (?3) OR gmail_id IN (?4) ORDER BY rowid", ['2026-11-01', '2026-11-08', 'x', 'y']],
  'sync: known ids': ['SELECT gmail_id FROM transactions WHERE gmail_id IN (?1, ?2)', ['a', 'b']],
  'tabs by name': ["SELECT tab, json FROM tabs WHERE tab IN (?1, ?2) ORDER BY rowid", ['Accounts', 'Rules']],
  'rebuild a month': ["SELECT stream, SUM(amount) FROM transactions WHERE date BETWEEN ?1 AND ?2 AND status = 'approved' AND shared = 0 AND category != ?3 GROUP BY stream", ['2026-10-28', '2026-11-27', 'Gaji']],
  'places of one key': ["SELECT owner, MIN(date) FROM transactions WHERE place_key = ?1 AND direction = 'out' GROUP BY owner", ['merchant']],
};
let scans = 0;
for (const [name, [sql, args]] of Object.entries(Q)) {
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map((r) => r.detail);
  const bad = plan.filter((d) => /^SCAN (transactions|tabs)\b/.test(d)); // any scan of these big tables reads all of it, index or not
  if (bad.length) scans += 1;
  console.log(`${bad.length ? 'FULL SCAN' : 'indexed  '}  ${name}\n      ${plan.join('\n      ')}`);
}
console.log(scans ? `\n${scans} queries scan a whole table` : '\nevery query uses an index');

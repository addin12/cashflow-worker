// A backup you can trust: exports the live database to private/backup/d1-<date>.sql, restores that file into a scratch database (in memory, on this computer),
// and checks the copy against the live data (row counts of every table, the sum and count of transactions, the newest transaction).
// A backup that was never restored is only a hope. Run it now and then, and before anything risky.   node scripts/backup.mjs
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const cwd = new URL('..', import.meta.url);
const run = (cmd) => execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 100e6 });
const live = (sql) => JSON.parse(run(`npx wrangler d1 execute cashflow --remote --json --command "${sql}"`))[0].results;

mkdirSync(new URL('../private/backup/', import.meta.url), { recursive: true });
const day = new Date().toISOString().slice(0, 10);
const file = `private/backup/d1-${day}.sql`;
run(`npx wrangler d1 export cashflow --remote --output=${file}`);
console.log(`exported ${file} (${Math.round(statSync(new URL(`../${file}`, import.meta.url)).size / 1024)} KB)`);

const copy = new DatabaseSync(':memory:');
copy.exec(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
const tables = copy.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all().map((r) => r.name);
let bad = 0;
const check = (label, a, b) => { const ok = String(a) === String(b); if (!ok) bad += 1; console.log(`${ok ? 'same     ' : 'DIFFERENT'} ${label}: backup ${a}, live ${b}`); };
for (const t of tables) check(`rows in ${t}`, copy.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n, live(`SELECT COUNT(*) AS n FROM \\"${t}\\"`)[0].n);
const sums = (rows) => `${rows.n} transactions, amount ${rows.s}, newest ${rows.d}`;
check('transactions', sums(copy.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS s, MAX(date) AS d FROM transactions').get()), sums(live('SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS s, MAX(date) AS d FROM transactions')[0]));
console.log(bad ? `\n${bad} difference(s): rows may have been written during the export (run again), otherwise do NOT trust this backup.` : '\nThe backup restores completely and matches the live data.');
process.exit(bad ? 1 : 0);

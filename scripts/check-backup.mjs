// Did the weekly backup (src/backup.js) run? Fetches the six files of a week from the R2 bucket and compares their row counts with the live database.
//   node scripts/check-backup.mjs [YYYY-MM-DD]     (default: the most recent Sunday, which is when the backup runs, 20:00 UTC)
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TABLES = ['config', 'transactions', 'tabs', 'monthly_totals', 'stream_months', 'places_seen'];
const cwd = new URL('..', import.meta.url);
const run = (cmd) => execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const lastSunday = () => { const d = new Date(); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.toISOString().slice(0, 10); };
const day = process.argv[2] || lastSunday();
const dir = mkdtempSync(join(tmpdir(), 'cashflow-backup-check-'));
let bad = 0;
console.log(`weekly backup of ${day} in R2 bucket cashflow-backup`);
for (const t of TABLES) {
  const file = join(dir, `${t}.sql`);
  try {
    run(`npx wrangler r2 object get cashflow-backup/weekly/${day}/${t}.sql --remote --file="${file}"`);
  } catch (e) { bad += 1; console.log(`MISSING   ${t}`); continue; }
  const rows = (readFileSync(file, 'utf8').match(/^INSERT INTO /gm) || []).length;
  const live = JSON.parse(run(`npx wrangler d1 execute cashflow --remote --json --command "SELECT COUNT(*) AS n FROM \\"${t}\\""`))[0].results[0].n;
  const note = rows === live ? 'same as live now' : `live has ${live} now (rows change during a week)`;
  console.log(`present   ${t.padEnd(15)} ${String(rows).padStart(5)} rows  ${note}`);
}
rmSync(dir, { recursive: true, force: true });
console.log(bad ? `\n${bad} file(s) missing: the backup did not complete. Check the Worker's queue and logs.` : '\nAll six files are there.');
process.exit(bad ? 1 : 0);

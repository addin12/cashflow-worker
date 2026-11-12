// Shadow-run check: is the data in Cloudflare (D1) the same as the data in the live Google Sheet?
// It exports the Sheet again, reads D1 with wrangler, and lists what differs. Both systems read the same mail, so after a day they should agree;
// what only one of them has is either an edit made by hand in one app (copy it over) or a sync difference (look into it).
// Run it after the daily D1 limit has reset (07:00 Jakarta): it reads about every row once.
//   node scripts/compare-data.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { TABS } from '../vendor/core/schema.js';
import { keyOf } from '../src/unit.js';
import { assertBudget } from './budget.mjs';
await assertBudget(); // these read the live database: never when the day's free reads are half used (see budget.mjs)

const root = new URL('..', import.meta.url);
execFileSync(process.execPath, ['scripts/export-real.mjs'], { cwd: root, stdio: 'ignore' });
const real = JSON.parse(readFileSync(new URL('../private/real.json', import.meta.url), 'utf8'));

const d1 = (sql) => {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'cashflow', '--remote', '--json', '--command', `"${sql}"`], { cwd: root, encoding: 'utf8', maxBuffer: 200e6, shell: true });
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
};

const norm = (h, v) => {
  if (v == null) return '';
  if (h === 'date') return String(v).slice(0, 10);
  if (h === 'amount') return String(Number(v) || 0);
  return String(v).trim();
};
const IGNORE = new Set(['updated_at', 'updated_by', 'price', 'price_at', 'hits', 'last_sync', 'last_status', 'checkpoint', 'place_key', 'shared']);
const diffRow = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !IGNORE.has(k) && norm(k, a[k]) !== norm(k, b[k]));

let problems = 0;
/** harmless(row): a row that may exist on one side only without it mattering (an ignored row counts toward nothing). */
function compare(label, sheetRows, d1Rows, keyFn, harmless = () => false) {
  const s = new Map(sheetRows.map((r) => [keyFn(r), r]));
  const d = new Map(d1Rows.map((r) => [keyFn(r), r]));
  const missingSheet = [...s.keys()].filter((k) => !d.has(k));
  const missingD1 = [...d.keys()].filter((k) => !s.has(k));
  const onlySheet = missingSheet.filter((k) => !harmless(s.get(k)));
  const onlyD1 = missingD1.filter((k) => !harmless(d.get(k)));
  const ignoredOnly = missingSheet.length - onlySheet.length + missingD1.length - onlyD1.length;
  const changed = [...s.keys()].filter((k) => d.has(k)).map((k) => [k, diffRow(s.get(k), d.get(k))]).filter(([, f]) => f.length);
  const ok = !onlySheet.length && !onlyD1.length && !changed.length;
  if (!ok) problems += 1;
  console.log(`${ok ? 'same     ' : 'DIFFERENT'}  ${label}: sheet ${s.size}, cloudflare ${d.size}${ok ? '' : ` | only in sheet ${onlySheet.length}, only in cloudflare ${onlyD1.length}, fields differ ${changed.length}`}`);
  const show = (title, items) => items.slice(0, 8).forEach((x) => console.log(`            ${title} ${x}`));
  if (ignoredOnly) console.log(`            (${ignoredOnly} ignored row(s) on one side only: harmless, they count toward nothing)`);
  show('only in sheet     ', onlySheet.map((k) => `${k} ${(s.get(k).description || s.get(k).name || '').toString().slice(0, 40)} ${s.get(k).date ? String(s.get(k).date).slice(0, 10) : ''}`));
  show('only in cloudflare', onlyD1.map((k) => `${k} ${(d.get(k).description || d.get(k).name || '').toString().slice(0, 40)} ${d.get(k).date || ''}`));
  show('fields differ     ', changed.map(([k, f]) => `${k}: ${f.join(', ')}`));
}

console.log('Transactions');
compare('transactions', real.tabs[TABS.transactions], d1('SELECT * FROM transactions'), (r) => String(r.id), (r) => r.status === 'ignored');
const tabs = d1('SELECT tab, json FROM tabs');
console.log('\nOther tabs (hand-made settings: accounts, budgets, goals, plans, rules ...)');
for (const name of [TABS.accounts, TABS.budgets, TABS.goals, TABS.owed, TABS.assets, TABS.plans, TABS.rules]) {
  compare(name, real.tabs[name] || [], tabs.filter((t) => t.tab === name).map((t) => JSON.parse(t.json)), (r) => keyOf(name, r));
}
const log = tabs.filter((t) => t.tab === TABS.inboxLog).length;
console.log(`\nMail log lines: sheet ${(real.tabs[TABS.inboxLog] || []).length}, cloudflare ${log} (cloudflare keeps the newest 600 on screen; not compared line by line)`);

console.log('\nSettings that matter');
const cfg = Object.fromEntries(d1('SELECT key, value FROM config').map((r) => [r.key, r.value]));
for (const k of ['owner_name', 'partner_name', 'payday_day', 'partner_payday_day', 'cat_cash', 'big_amount', 'start_date', 'language', 'shared_split', 'push_events', 'partner_push_events']) {
  const a = String(real.config[k] ?? '');
  const b = String(cfg[k] ?? '');
  if (a !== b) { problems += 1; console.log(`DIFFERENT  config ${k}: sheet "${a}" cloudflare "${b}"`); }
}
console.log(`\nCloudflare: mail last looked at ${cfg.scan_checked ? `${Math.round((Date.now() - Number(cfg.scan_checked)) / 1000)} s ago` : 'never'}; prices: ${cfg.price_status || 'not yet'}; sync alerts: ${cfg.scan_alerted ? 'one was sent' : 'none'}`);
console.log(problems ? `\n${problems} difference group(s): see above` : '\nthe data in Cloudflare equals the data in the Sheet');
process.exit(problems ? 1 : 0);

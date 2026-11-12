// Turns the real Sheet export (private/real.json, made by export-real.mjs) into SQL for the app's database: private/real-seed.sql (git-ignored).
// Nothing is sent anywhere: load the file into a LOCAL database to rehearse (scripts/verify-migration.mjs), or into D1 when the owner says so.
//   node scripts/migrate-real.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createApi } from '../vendor/core/api.js';
import { placeKey } from '../vendor/core/insights.js';
import { salaryCategory } from '../vendor/core/salary.js';
import { buildCategorySlots } from '../vendor/core/categories.js';
import { TABS } from '../vendor/core/schema.js';
import { url as mailUrl } from './urls.mjs';

const real = JSON.parse(readFileSync(new URL('../private/real.json', import.meta.url), 'utf8'));
const cfg = Object.fromEntries(Object.entries(real.config).map(([k, v]) => [k, v == null ? '' : String(v)]));
const list = (v) => String(v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

// Which mail-Worker key (addin, muthia1, muthia2) is which Gmail address: asked of the Worker itself, never guessed.
async function mailAccounts() {
  const token = readFileSync('D:/Project/mail-worker/secrets/mcp-token.txt', 'utf8').trim();
  const out = [];
  let n = 0;
  for (const who of ['addin', 'muthia1', 'muthia2']) {
    const res = await fetch(`${mailUrl('mail')}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: (n += 1), method: 'tools/call', params: { name: `gmail_${who}_whoami`, arguments: {} } }) });
    const r = (await res.json()).result;
    if (r.isError) throw new Error(`${who}: ${r.content[0].text}`);
    const gmail = JSON.parse(r.content[0].text).emailAddress.toLowerCase();
    const owner = list(cfg.owner_email).includes(gmail) ? cfg.owner_name : list(cfg.partner_email).includes(gmail) ? cfg.partner_name : '';
    if (!owner) throw new Error(`${who} is signed in as an address that is neither the owner's nor the partner's in Config`);
    out.push({ who, gmail, owner });
  }
  return out;
}

const slots = buildCategorySlots({ income: real.slots.income.filter((c) => c !== '-'), expense: real.slots.expense.filter((c) => c !== '-') });
const config = { ...cfg, _slots: JSON.stringify(slots), salary_category: salaryCategory(slots.income.filter((c) => c !== '-')), mail_accounts: JSON.stringify(await mailAccounts()) };

const T = TABS.transactions;
const COLS = ['id', 'date', 'time', 'owner', 'stream', 'direction', 'amount', 'category', 'description', 'details', 'source', 'sender', 'gmail', 'gmail_id', 'ref_no', 'status', 'transfer_id', 'rule_id', 'updated_by', 'updated_at'];
const q = (v) => `'${String(v ?? '').replace(/'/g, "''")}'`;
const val = (c, v) => (c === 'amount' ? Number(v) || 0 : q(v));
const rows = real.tabs[T].map((r) => ({ ...r, id: String(r.id), date: String(r.date).slice(0, 10) }));

// the totals of every month and view, by the app's own code on all the data
const data = { ...real.tabs, [T]: rows };
const store = { read: (tab) => (data[tab] || []).map((r) => ({ ...r })), append() {}, update() {}, remove() {}, replace() {}, config: (k) => config[k] ?? '', setConfig() {}, slots: () => slots, setSlots() {} };
const api = createApi(store, { now: () => new Date(), isOwner: true, meName: cfg.owner_name, myEmail: list(cfg.owner_email)[0] || '' });
const labels = new Set();
for (const r of rows) {
  const d = r.date; const y = Number(d.slice(0, 4)); const m = Number(d.slice(5, 7)); const day = Number(d.slice(8, 10));
  labels.add(d.slice(0, 7));
  const next = new Date(Date.UTC(y, m, 1));
  labels.add(day >= (Number(cfg.payday_day) || 28) ? next.toISOString().slice(0, 7) : d.slice(0, 7));
}
const owners = ['', ...new Set([...real.tabs[TABS.accounts].map((a) => a.owner), cfg.owner_name, cfg.partner_name].filter(Boolean))];
const totals = [];
for (const o of owners) for (const m of labels) { const t = api.monthTotals({ month: m, owner: o || undefined }); totals.push(`(${q(o)}, ${q(m)}, ${t.income}, ${t.expense})`); }

const FIRST = { [TABS.accounts]: 'stream', [TABS.budgets]: 'category', [TABS.connections]: 'gmail', [TABS.inboxLog]: 'gmail_id' };
const out = ['DELETE FROM transactions; DELETE FROM tabs; DELETE FROM config; DELETE FROM monthly_totals;'];
const COLS_ALL = [...COLS, 'place_key', 'shared'];
for (let i = 0; i < rows.length; i += 4) {
  out.push(`INSERT INTO transactions (${COLS_ALL.join(',')}) VALUES ${rows.slice(i, i + 4).map((r) => `(${[...COLS.map((c) => val(c, r[c])), q(placeKey(r.description)), /#bersama/i.test(String(r.description || '')) ? 1 : 0].join(', ')})`).join(', ')};`);
}
const counts = { transactions: rows.length };
for (const tab of [TABS.accounts, TABS.rules, TABS.budgets, TABS.goals, TABS.owed, TABS.assets, TABS.plans, TABS.inboxLog, TABS.connections]) {
  const list2 = real.tabs[tab] || [];
  counts[tab] = list2.length;
  for (let i = 0; i < list2.length; i += 20) out.push(`INSERT INTO tabs (tab, id, json) VALUES ${list2.slice(i, i + 20).map((r) => `(${q(tab)}, ${q(r[FIRST[tab] || 'id'])}, ${q(JSON.stringify(r))})`).join(', ')};`);
}
out.push(`INSERT INTO config (key, value) VALUES ${Object.entries(config).map(([k, v]) => `(${q(k)}, ${q(v)})`).join(', ')};`);
for (let i = 0; i < totals.length; i += 40) out.push(`INSERT INTO monthly_totals VALUES ${totals.slice(i, i + 40).join(', ')};`);
out.push(readFileSync(new URL('../rebuild-aggregates.sql', import.meta.url), 'utf8'));
writeFileSync(new URL('../private/real-seed.sql', import.meta.url), out.join('\n'));
console.log(Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(' | '));
console.log(`config keys: ${Object.keys(config).length} | monthly totals: ${totals.length} | statements: ${out.length}`);
console.log(`mail accounts: ${JSON.parse(config.mail_accounts).map((a) => `${a.who}->${a.owner}`).join(', ')}`);

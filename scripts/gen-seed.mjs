// Synthetic data of the shape and density of the real app (about 8.5 rows a day), ending on 2026-11-11, written as SQL for D1.
// Monthly totals are worked out with the app's own code, exactly as the real system keeps them. No real transactions.
//   node scripts/gen-seed.mjs 3000 > seed.sql
import { readFileSync } from 'node:fs';
import { createApi } from '../vendor/core/api.js';
import { placeKey } from '../vendor/core/insights.js';
import { TABS } from '../vendor/core/schema.js';
import { ACCOUNTS, CATS, CONFIG, OWNERS, SLOTS } from '../src/shared.js';

const N = Number(process.argv[2] || 600);
const NOW = new Date(2026, 10, 11, 10, 0, 0);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const span = Math.ceil(N / 8.5);
const rows = [];
let n = 0;
const add = (date, o) => rows.push({ id: `t${n += 1}`, date, time: `${String(8 + (n % 12)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}:00`, owner: 'Me', stream: ACCOUNTS[0].stream, direction: 'out', amount: 10000, category: CATS[0], description: '', details: '', source: 'email', sender: 'bank', gmail: 'a@example.com', gmail_id: `g${n}`, ref_no: `r${n}`, status: 'approved', transfer_id: '', rule_id: '', updated_by: 'sync', updated_at: date, ...o });
for (let back = span - 1; back >= 0; back -= 1) {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - back);
  const date = iso(d);
  if (d.getDate() === 20) add(date, { description: 'NETFLIX', amount: 54000, category: 'Langganan Digital' });
  if (d.getDate() === 18) add(date, { description: 'SPOTIFY', amount: 59000, category: 'Langganan Digital' });
  if (d.getDate() === 1) add(date, { description: 'BAYAR KOS', amount: 1500000, category: 'Tagihan & Utilitas' });
  if (d.getDate() === 28) add(date, { description: 'GAJI', direction: 'in', amount: 12204471, category: 'Gaji' });
  for (let k = 0; k < 8; k += 1) {
    const i = n + k;
    const acc = ACCOUNTS[i % ACCOUNTS.length];
    add(date, { owner: acc.owner, stream: acc.stream, amount: 10000 + ((i * 7919) % 300000), category: CATS[i % CATS.length], description: `MERCHANT ${(i * 31) % 140}${i % 37 === 0 ? ' #bersama' : ''}`, status: i % 50 === 0 ? 'pending' : 'approved' });
  }
}
rows.length = Math.min(rows.length, N);
for (const r of rows) r.place_key = placeKey(r.description);

const rules = Array.from({ length: 140 }, (_, i) => ({ id: `r${i}`, field: 'description', pattern: `MERCHANT ${i}`, category: CATS[i % CATS.length], stream_override: '', auto_approve: 'TRUE', hits: i % 10, created_by: 'Me', created_at: '2026-10-01T00:00:00.000Z' }));
const budgets = CATS.slice(0, 7).map((category, i) => ({ category, monthly_budget: (i + 1) * 200000, scope: '' }));
const inboxLog = Array.from({ length: 100 }, (_, i) => ({ gmail_id: `g${i}`, received: `2026-11-${String(1 + (i % 11)).padStart(2, '0')}T0${i % 10}:00:00.000Z`, from: 'BCA <bca@bca.co.id>', subject: 'Transaction Journal', status: ['ok', 'ok', 'skip', 'error'][i % 4], parser: 'bca', reason: i % 4 === 3 ? 'no amount found' : '', rows: 1, gmail: 'a@example.com' }));

// the totals of every month and view, by the app's own code
const data = { [TABS.transactions]: rows, [TABS.accounts]: ACCOUNTS, [TABS.goals]: [], [TABS.budgets]: budgets, [TABS.rules]: [], [TABS.inboxLog]: [], [TABS.owed]: [], [TABS.assets]: [], [TABS.connections]: [], [TABS.plans]: [] };
const store = { read: (tab) => (data[tab] || []).map((r) => ({ ...r })), append() {}, update() {}, remove() {}, replace() {}, config: (k) => CONFIG[k] ?? '', setConfig() {}, slots: () => SLOTS, setSlots() {} };
const api = createApi(store, { now: () => NOW, isOwner: true, meName: 'Me', myEmail: 'a@example.com' });
const months = [...new Set(rows.map((r) => r.date.slice(0, 7)))];
const totals = [];
for (const who of OWNERS) for (const m of months) { const t = api.monthTotals({ month: m, owner: who || undefined }); totals.push({ owner: who, month: m, income: t.income, expense: t.expense }); }

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const COLS = ['id', 'date', 'time', 'owner', 'stream', 'direction', 'amount', 'category', 'description', 'details', 'source', 'sender', 'gmail', 'gmail_id', 'ref_no', 'status', 'transfer_id', 'rule_id', 'updated_by', 'updated_at', 'place_key'];
const val = (v) => (typeof v === 'number' ? v : q(v));
const tabRow = (tab, first, r) => `(${q(tab)}, ${q(r[first])}, ${q(JSON.stringify(r))})`;
const out = ['DELETE FROM transactions; DELETE FROM tabs; DELETE FROM config; DELETE FROM monthly_totals;'];
for (let i = 0; i < rows.length; i += 80) out.push(`INSERT INTO transactions (${COLS.join(',')}) VALUES ${rows.slice(i, i + 80).map((r) => `(${COLS.map((c) => val(r[c])).join(', ')})`).join(',\n')};`);
out.push(`INSERT INTO tabs (tab, id, json) VALUES ${ACCOUNTS.map((a) => tabRow(TABS.accounts, 'stream', a)).join(',\n')};`);
out.push(`INSERT INTO tabs (tab, id, json) VALUES ${budgets.map((b) => tabRow(TABS.budgets, 'category', b)).join(',\n')};`);
for (let i = 0; i < rules.length; i += 70) out.push(`INSERT INTO tabs (tab, id, json) VALUES ${rules.slice(i, i + 70).map((r) => tabRow(TABS.rules, 'id', r)).join(',\n')};`);
out.push(`INSERT INTO tabs (tab, id, json) VALUES ${inboxLog.map((r) => tabRow(TABS.inboxLog, 'gmail_id', r)).join(',\n')};`);
out.push(`INSERT INTO config (key, value) VALUES ${Object.entries({ ...CONFIG, _slots: JSON.stringify(SLOTS), salary_category: 'Gaji' }).map(([k, v]) => `(${q(k)}, ${q(v)})`).join(', ')};`);
out.push(`INSERT INTO monthly_totals VALUES ${totals.map((t) => `(${q(t.owner)}, ${q(t.month)}, ${t.income}, ${t.expense})`).join(', ')};`);
out.push(readFileSync(new URL('../rebuild-aggregates.sql', import.meta.url), 'utf8')); // the shared flags, stream_months and places_seen
console.log(out.join('\n'));

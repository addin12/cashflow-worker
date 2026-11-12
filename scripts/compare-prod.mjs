// End to end on Cloudflare: the deployed app (real data in D1, answering over the network) against the app on a FRESH export of the Sheet.
// The Sheet is exported again just before, so mail that arrived meanwhile is in both. Run it after the daily D1 limit has reset.
//   node scripts/compare-prod.mjs [url]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createApi } from '../vendor/core/api.js';
import { buildCategorySlots } from '../vendor/core/categories.js';
import { TABS } from '../vendor/core/schema.js';
import { url as cashflowUrl } from './urls.mjs';

const url = process.argv[2] || cashflowUrl('cashflow');
const token = readFileSync(new URL('../secrets/app-token.txt', import.meta.url), 'utf8').trim();
execFileSync(process.execPath, ['scripts/export-real.mjs'], { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
const real = JSON.parse(readFileSync(new URL('../private/real.json', import.meta.url), 'utf8'));

const cfg = Object.fromEntries(Object.entries(real.config).map(([k, v]) => [k, v == null ? '' : String(v)]));
const slots = buildCategorySlots({ income: real.slots.income.filter((c) => c !== '-'), expense: real.slots.expense.filter((c) => c !== '-') });
const TEXT = ['id', 'date', 'time', 'owner', 'stream', 'direction', 'category', 'description', 'details', 'source', 'sender', 'gmail', 'gmail_id', 'ref_no', 'status', 'transfer_id', 'rule_id', 'updated_by', 'updated_at'];
const data = { ...real.tabs, [TABS.transactions]: real.tabs[TABS.transactions].map((r) => ({ ...r, ...Object.fromEntries(TEXT.map((c) => [c, c === 'date' ? String(r.date).slice(0, 10) : String(r[c] ?? '')])) })) };
const store = { read: (t) => (data[t] || []).map((r) => ({ ...r })), append() {}, update() {}, remove() {}, replace() {}, config: (k) => cfg[k] ?? '', setConfig() {}, slots: () => slots, setSlots() {} };
const owner = { name: cfg.owner_name, email: cfg.owner_email.split(',')[0].trim().toLowerCase(), owner: true };
const ref = createApi(store, { now: () => new Date(), isOwner: true, meName: owner.name, myEmail: owner.email });

const post = async (name, body = {}) => {
  const res = await fetch(`${url}/api/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const r = await res.json();
  if (!res.ok || r.error) throw new Error(`${name}: ${r.error || res.status}`);
  return r.data;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let bad = 0;
const check = (label, ok, detail = '') => { if (!ok) bad += 1; console.log(`${ok ? 'identical' : 'DIFFERENT'}  ${label}${detail ? ` (${detail})` : ''}`); };

const stamp = await post('stamp');
console.log(`production: data changed ${stamp.stamp ? new Date(stamp.stamp).toISOString() : 'never'}, mail last looked at ${stamp.checked ? `${Math.round((Date.now() - stamp.checked) / 1000)} s ago` : 'never'}`);
for (const who of [undefined, owner.name, cfg.partner_name]) {
  const whole = ref.dashboard({ owner: who });
  const parts = Object.assign({}, ...(await Promise.all(['main', 'insights', 'bills'].map((part) => post('dashboard', { owner: who, part })))));
  const diff = Object.keys(whole).filter((k) => !same(whole[k], parts[k]));
  check(`dashboard, ${who || 'Kita'}`, !diff.length, diff.join(', '));
}
for (const [name, refValue, args] of [['review', ref.review(), {}], ['bootstrap', ref.bootstrap(), {}], ['settings', ref.settings(), {}], ['incoming', ref.incoming(), {}]]) {
  const got = await post(name, args);
  const keys = Array.isArray(refValue) ? [] : Object.keys(refValue).filter((k) => !same(refValue[k], got[k]));
  check(name, Array.isArray(refValue) ? same(refValue, got) : !keys.length, keys.join(', '));
}
const list = await post('list', { limit: 50 });
check('transaction list (newest 50)', same(ref.list({ limit: 50 }).rows, list.rows));
console.log(bad ? `\n${bad} DIFFERENCES: look at them before trusting the new app` : '\nthe deployed app answers exactly like the original, on real data');
process.exit(bad ? 1 : 0);

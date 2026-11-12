// Rehearsal of the migration on the owner's computer: load private/real-seed.sql into a LOCAL database and check that every screen gives the same
// answer from the migrated data (through the windows, stored sums and parts) as the app gives from the original export on all rows.
//   node scripts/verify-migration.mjs
import { readFileSync } from 'node:fs';
import { createApi, DASHBOARD_PARTS } from '../vendor/core/api.js';
import { buildCategorySlots } from '../vendor/core/categories.js';
import { TABS } from '../vendor/core/schema.js';
import { cuts } from '../src/app.js';
import { openUnit } from '../src/unit.js';
import { localD1 } from '../test/d1shim.js';

const real = JSON.parse(readFileSync(new URL('../private/real.json', import.meta.url), 'utf8'));
const NOW = new Date();
const db = localD1();
db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
db.exec(readFileSync(new URL('../private/real-seed.sql', import.meta.url), 'utf8'));
console.log(`loaded: ${db.sqlite.prepare('SELECT COUNT(*) AS n FROM transactions').get().n} transactions, ${db.sqlite.prepare("SELECT COUNT(*) AS n FROM tabs WHERE tab = 'Inbox Log'").get().n} log lines, ${db.sqlite.prepare('SELECT COUNT(*) AS n FROM stream_months').get().n} stored account-months, ${db.sqlite.prepare('SELECT COUNT(*) AS n FROM places_seen').get().n} stored places`);

// the reference: the app on the original export, all rows, exactly as the Sheet-backed app sees them
const cfg = Object.fromEntries(Object.entries(real.config).map(([k, v]) => [k, v == null ? '' : String(v)]));
const slots = buildCategorySlots({ income: real.slots.income.filter((c) => c !== '-'), expense: real.slots.expense.filter((c) => c !== '-') });
const TEXT_COLS = ['id', 'date', 'time', 'owner', 'stream', 'direction', 'category', 'description', 'details', 'source', 'sender', 'gmail', 'gmail_id', 'ref_no', 'status', 'transfer_id', 'rule_id', 'updated_by', 'updated_at'];
const data = { ...real.tabs, [TABS.transactions]: real.tabs[TABS.transactions].map((r) => ({ ...r, ...Object.fromEntries(TEXT_COLS.map((c) => [c, c === 'date' ? String(r.date).slice(0, 10) : String(r[c] ?? '')])) })) };
const refStore = { read: (t) => (data[t] || []).map((r) => ({ ...r })), append() {}, update() {}, remove() {}, replace() {}, config: (k) => cfg[k] ?? '', setConfig() {}, slots: () => slots, setSlots() {} };
const people = {
  owner: { name: cfg.owner_name, email: cfg.owner_email.split(',')[0].trim().toLowerCase(), owner: true },
  partner: { name: cfg.partner_name, email: cfg.partner_email.split(',')[0].trim().toLowerCase(), owner: false },
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let bad = 0;
const check = (label, ok, detail = '') => { if (!ok) bad += 1; console.log(`${ok ? 'identical' : 'DIFFERENT'}  ${label}${detail ? ` (${detail})` : ''}`); };
const via = async (who, wide, args, method, opts = {}) => {
  db.newRequest();
  const c = cuts(NOW);
  const unit = await openUnit(db, wide ? c.bills : c.main, { rules: true, inbox: true, now: () => NOW, who: () => who, ...opts });
  return (await unit.call(method, args)).result;
};

for (const [role, who] of Object.entries(people)) {
  const ref = createApi(refStore, { now: () => NOW, isOwner: who.owner, meName: who.name, myEmail: who.email });
  console.log(`\n== as ${role} (${who.name})`);
  for (const owner of [undefined, people.owner.name, people.partner.name]) {
    const whole = ref.dashboard({ owner });
    const parts = {};
    for (const part of Object.keys(DASHBOARD_PARTS)) Object.assign(parts, await via(who, part === 'bills', { owner, part }, 'dashboard'));
    const diff = Object.keys(whole).filter((k) => !same(whole[k], parts[k]));
    check(`dashboard, ${owner || 'Kita'}`, !diff.length, diff.join(', '));
  }
  const review = await via(who, false, {}, 'review');
  const refReview = ref.review();
  const rdiff = Object.keys(refReview).filter((k) => !same(refReview[k], review[k]));
  check('review (Cek)', !rdiff.length, rdiff.map((k) => { const a = refReview[k]; const b = review[k]; const i = Array.isArray(a) ? a.findIndex((r, j) => !same(r, b[j])) : -1; return k + (i >= 0 ? ' item ' + i + ': ' + Object.keys(a[i]).filter((f) => !same(a[i][f], b[i][f])).map((f) => f + ' ' + JSON.stringify(a[i][f]) + ' vs ' + JSON.stringify(b[i][f])).join('; ') : ''); }).join(' | '));
  const list = await via(who, false, { limit: 50 }, 'list');
  const refList = ref.list({ limit: 50 });
  const li = refList.rows.findIndex((r, i) => !same(r, list.rows[i]));
  check('transaction list (newest 50)', li < 0, li < 0 ? `${list.rows.length} rows` : `row ${li}: ${Object.keys(refList.rows[li]).filter((k) => !same(refList.rows[li][k], list.rows[li][k])).map((k) => k + ' ' + JSON.stringify(refList.rows[li][k]) + ' vs ' + JSON.stringify(list.rows[li][k])).join('; ')}`);
  const boot = await via(who, false, {}, 'bootstrap');
  const refBoot = ref.bootstrap();
  const bdiff = Object.keys(refBoot).filter((k) => !same(refBoot[k], boot[k]));
  check('bootstrap (what the page starts from)', !bdiff.length, bdiff.join(', '));
  const set = await via(who, true, {}, 'settings');
  const refSet = ref.settings();
  const sdiff = Object.keys(refSet).filter((k) => !same(refSet[k], set[k]));
  check('settings (Pengaturan)', !sdiff.length, sdiff.join(', '));
  check('incoming (the bell)', same(ref.incoming(), (await via(who, false, {}, 'incoming'))));
}
console.log(bad ? `\n${bad} DIFFERENCES` : '\nthe migrated data gives the same answer on every screen, for both people');
process.exit(bad ? 1 : 0);

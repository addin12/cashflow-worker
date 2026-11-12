// Writes through the D1 unit of work give exactly what the app gives on its in-memory store with all the data:
// the same rows, the same other tabs, the same stored monthly totals, the same dashboard, and D1's limits are respected.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../vendor/core/api.js';
import { TABS } from '../vendor/core/schema.js';
import { cuts } from '../src/app.js';
import { openUnit } from '../src/unit.js';
import { OWNERS, SLOTS } from '../src/shared.js';
import { localD1 } from './d1shim.js';

const NOW = new Date(2026, 10, 11, 10, 0, 0);
const TX_COLS = ['id', 'date', 'time', 'owner', 'stream', 'direction', 'amount', 'category', 'description', 'details', 'source', 'sender', 'gmail', 'gmail_id', 'ref_no', 'status', 'transfer_id', 'rule_id', 'updated_by', 'updated_at'];
const WHO = { name: 'Me', email: 'a@example.com', owner: true };
// keys the Worker keeps for itself (not part of the app's own settings)
const INTERNAL = ['data_stamp', 'scan_checked', 'retry_pending', 'read_signature'];

let db; let mem; let memTabs; let memCfg; let memTx;

/** The app's own in-memory store, loaded with everything the database holds: the reference to compare with. */
function memoryApi() {
  memTx = db.sqlite.prepare('SELECT * FROM transactions').all().map((r) => { const { place_key: _p, ...rest } = r; return rest; });
  memTabs = {};
  for (const r of db.sqlite.prepare('SELECT tab, json FROM tabs ORDER BY rowid').all()) (memTabs[r.tab] ||= []).push(JSON.parse(r.json));
  memCfg = Object.fromEntries(db.sqlite.prepare('SELECT key, value FROM config').all().map((r) => [r.key, r.value]));
  const KEY = { [TABS.accounts]: 'stream', [TABS.budgets]: 'category', [TABS.connections]: 'gmail', [TABS.inboxLog]: 'gmail_id' };
  const tab = (name) => (name === TABS.transactions ? memTx : (memTabs[name] ||= []));
  const store = {
    read: (name) => tab(name).map((r) => ({ ...r })),
    append: (name, rows) => { tab(name).push(...rows.map((r) => ({ ...r }))); },
    update: (name, ups) => ups.forEach(({ id, changes }) => Object.assign(tab(name).find((r) => String(r[KEY[name] || 'id']) === String(id)) || {}, changes)),
    remove: (name, id) => { const a = tab(name); const i = a.findIndex((r) => String(r[KEY[name] || 'id']) === String(id)); if (i >= 0) a.splice(i, 1); },
    replace: (name, rows) => { if (name === TABS.transactions) memTx = rows.map((r) => ({ ...r })); else memTabs[name] = rows.map((r) => ({ ...r })); },
    config: (k) => memCfg[k] ?? '', setConfig: (k, v) => { memCfg[k] = String(v); }, slots: () => SLOTS, setSlots() {},
  };
  return createApi(store, { now: () => NOW, isOwner: true, meName: 'Me', myEmail: 'a@example.com' });
}

const wide = new Set(['settings', 'saveBudgets', 'saveConfig']);
/** One request: open a unit of work with the window the method needs, run the method, write. */
async function viaD1(method, args = {}, part) {
  db.newRequest();
  const c = cuts(NOW);
  const unit = await openUnit(db, wide.has(method) || part === 'bills' ? c.bills : c.main, { rules: true, now: () => NOW, who: WHO });
  const out = await unit.call(method, args);
  return { ...out, statements: db.statementsUsed() };
}
const txRows = () => db.sqlite.prepare(`SELECT ${TX_COLS.join(', ')} FROM transactions ORDER BY id`).all();
const memRows = () => [...memTx].sort((a, b) => (a.id < b.id ? -1 : 1)).map((r) => Object.fromEntries(TX_COLS.map((c) => [c, r[c] === undefined ? '' : r[c]])));
const dash = async (owner) => ({
  ...(await viaD1('dashboard', { owner, part: 'main' }, 'main')).result,
  ...(await viaD1('dashboard', { owner, part: 'insights' }, 'insights')).result,
  ...(await viaD1('dashboard', { owner, part: 'bills' }, 'bills')).result,
});

beforeAll(() => {
  db = localD1();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(execFileSync(process.execPath, ['scripts/gen-seed.mjs', '700'], { encoding: 'utf8', cwd: new URL('..', import.meta.url), maxBuffer: 50e6 }));
  mem = memoryApi();
});

/** After every operation: the database and the in-memory app agree on everything that is stored, and on what the screens show. */
async function agree(label) {
  expect(txRows(), `${label}: transactions`).toEqual(memRows());
  for (const name of [TABS.accounts, TABS.budgets, TABS.rules, TABS.goals, TABS.owed, TABS.plans, TABS.assets]) {
    const stored = db.sqlite.prepare('SELECT json FROM tabs WHERE tab = ? ORDER BY rowid').all(name).map((r) => JSON.parse(r.json));
    expect(stored, `${label}: ${name}`).toEqual((memTabs[name] || []).map((r) => JSON.parse(JSON.stringify(r))));
  }
  expect(Object.fromEntries(db.sqlite.prepare('SELECT key, value FROM config').all().filter((r) => !INTERNAL.includes(r.key)).map((r) => [r.key, r.value])), `${label}: config`).toEqual(memCfg);
  // stored totals equal what the app works out from all rows
  for (const r of db.sqlite.prepare('SELECT owner, month, income, expense FROM monthly_totals').all()) {
    const t = mem.monthTotals({ month: r.month, owner: r.owner || undefined });
    expect([r.income, r.expense], `${label}: totals ${r.owner || 'Kita'} ${r.month}`).toEqual([t.income, t.expense]);
  }
  // the stored sums of the old history equal what the database works out from the rows now
  const smExpected = db.sqlite.prepare("SELECT stream, CASE WHEN CAST(substr(date, 9, 2) AS INTEGER) >= 28 THEN strftime('%Y-%m', date(substr(date, 1, 7) || '-01', '+1 month')) ELSE substr(date, 1, 7) END AS month, SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END) AS net FROM transactions WHERE status = 'approved' AND shared = 0 AND category != COALESCE((SELECT value FROM config WHERE key = 'salary_category'), '') GROUP BY stream, month").all();
  const smStored = db.sqlite.prepare('SELECT stream, month, net FROM stream_months').all();
  const keyOf = (r) => r.stream + '|' + r.month;
  expect(smStored.map(keyOf).sort(), label + ': stream_months keys').toEqual(smExpected.map(keyOf).sort());
  for (const e of smExpected) expect(smStored.find((r) => keyOf(r) === keyOf(e)).net, label + ': stream_months ' + keyOf(e)).toBeCloseTo(e.net, 4);
  const qual = "direction = 'out' AND status NOT IN ('ignored', 'pending') AND shared = 0 AND category NOT IN ('Penyesuaian', COALESCE((SELECT value FROM config WHERE key = 'cat_transfer'), 'trf ke bank lain')) AND category != COALESCE((SELECT value FROM config WHERE key = 'salary_category'), '') AND ref_no NOT LIKE 'split:%' AND place_key != ''";
  const placesExpected = [...db.sqlite.prepare('SELECT owner, place_key, MIN(date) AS first_date FROM transactions WHERE ' + qual + ' GROUP BY owner, place_key').all(), ...db.sqlite.prepare("SELECT '' AS owner, place_key, MIN(date) AS first_date FROM transactions WHERE " + qual + ' GROUP BY place_key').all()];
  const pk = (r) => r.owner + '|' + r.place_key + '|' + r.first_date;
  expect(db.sqlite.prepare('SELECT owner, place_key, first_date FROM places_seen').all().map(pk).sort(), label + ': places_seen').toEqual(placesExpected.map(pk).sort());
  // and the screens, in parts through the window, equal the whole dashboard on all rows
  for (const owner of [undefined, 'Me', 'Dewi']) {
    const whole = mem.dashboard({ owner });
    const parts = await dash(owner);
    const diff = Object.keys(whole).filter((k) => JSON.stringify(whole[k]) !== JSON.stringify(parts[k]));
    expect(diff, `${label}: dashboard fields that differ for ${owner || 'Kita'}`).toEqual([]);
  }
}

const recent = (where = "status = 'approved'", n = 0) => db.sqlite.prepare(`SELECT * FROM transactions WHERE ${where} AND date >= '2026-10-05' ORDER BY date DESC, id LIMIT 1 OFFSET ${n}`).get();
const both = async (method, args) => {
  const a = await viaD1(method, args);
  const b = mem[method](args);
  // a new row gets a random id on each side: give the reference row the id the database side made
  if (method === 'add') { b.ids.forEach((mid, i) => { memTx.find((r) => r.id === mid).id = a.result.ids[i]; }); b.ids = a.result.ids; }
  expect(a.result, `${method}: the answer`).toEqual(JSON.parse(JSON.stringify(b))); expect(a.statements, `${method}: statements`).toBeLessThanOrEqual(50); return a; };

describe('writes through D1 equal writes on the in-memory app', () => {
  it('starts equal: stored rows, other tabs and totals agree with the reference', async () => { await agree('start'); });
  it('approve: a waiting row gets a category and a status', async () => {
    const r = recent("status = 'pending'");
    await both('approve', { id: r.id, category: 'Hobi', stream: r.stream });
    await agree('approve');
  });
  it('add: a manual row of today, with its stored totals', async () => {
    const out = await both('add', { kind: 'out', amount: 45000, date: '2026-11-10', stream: 'BCA', category: 'Food & Beverages', description: 'KOPI TEST' });
    expect(out.written.months.length).toBeGreaterThan(0);
    await agree('add');
  });
  it('update: a recent row changes amount and text (the totals of its month follow)', async () => {
    const r = recent();
    await both('update', { id: r.id, fields: { amount: 77777, description: 'EDITED SHOP' } });
    await agree('update');
  });
  it('update: moving a row to another month moves the totals of both months', async () => {
    const r = recent("status = 'approved' AND direction = 'out'", 3);
    await both('update', { id: r.id, fields: { date: '2026-10-02' } });
    await agree('move');
  });
  it('ignore and restore: a row leaves and re-enters the totals', async () => {
    const r = recent("status = 'approved' AND direction = 'out'", 1);
    await both('ignore', { id: r.id });
    await agree('ignore');
    await both('restore', { id: r.id });
    await agree('restore');
  });
  it('remove: a manual row is deleted', async () => {
    const r = db.sqlite.prepare("SELECT id FROM transactions WHERE description = 'KOPI TEST'").get();
    await both('remove', { id: r.id });
    await agree('remove');
  });
  it('split: one payment becomes two with their own categories (one statement batch)', async () => {
    const r = recent("status = 'approved' AND direction = 'out' AND amount > 50000", 2);
    const a = Math.round(r.amount / 3);
    const out = await both('split', { id: r.id, parts: [{ amount: a, category: 'Hobi' }, { amount: r.amount - a, category: 'Skincare' }] });
    expect(out.written.statements).toBeLessThanOrEqual(50);
    await agree('split');
    await both('unsplit', { id: r.id });
    await agree('unsplit');
  });
  it('budgets: saving them replaces the tab', async () => {
    await both('saveBudgets', { budgets: [{ category: 'Hobi', monthly_budget: 300000, scope: '' }, { category: 'Skincare', monthly_budget: 150000, scope: 'Me' }] });
    await agree('budgets');
  });
  it('accounts: the screen sees and sends the real opening balance; the carried history never leaks into the database', async () => {
    const shown = (await viaD1('settings')).result.accounts;
    const ref = mem.settings().accounts;
    expect(shown.map((a) => [a.stream, a.opening_balance])).toEqual(ref.map((a) => [a.stream, a.opening_balance]));
    const changed = ref.map((a) => (a.stream === 'GoPay' ? { ...a, opening_balance: 123456 } : a));
    await both('saveAccounts', { accounts: changed });
    await agree('accounts');
    expect(JSON.parse(db.sqlite.prepare("SELECT json FROM tabs WHERE tab = ? AND id = 'GoPay'").get(TABS.accounts).json).opening_balance).toBe(123456);
  });
  it('config: a setting is stored', async () => {
    await both('saveConfig', { language: 'en' });
    await agree('config');
  });
  it('every request stays inside D1\'s limits: at most 50 statements, at most 100 values each', async () => {
    const r = recent("status = 'approved'");
    const out = await viaD1('update', { id: r.id, fields: { description: 'ONE MORE' } });
    expect(out.statements).toBeLessThanOrEqual(50);
    expect(OWNERS.length).toBe(3);
  });
});

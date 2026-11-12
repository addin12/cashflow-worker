// A "unit of work" over D1 for the app's synchronous core: load what the work needs (async), let the app's own code run on it, then write
// every change in ONE atomic batch, together with the stored totals those changes touch.
//   openUnit  a screen or an API method: the window of recent rows (+ waiting, #bersama and salary rows of any age), older history folded
//             into the accounts' opening balances, stored monthly totals and the list of places paid before the window.
//   openNear  the sync: only the rows near the emails being planned; the stored totals are kept by adding what each change contributes.
import { jakarta } from './clock.js';
import { createApi } from '../vendor/core/api.js';
import { placeKey } from '../vendor/core/insights.js';
import { salaryCategory } from '../vendor/core/salary.js';
import { TABS } from '../vendor/core/schema.js';
import { deliver } from './push.js';

const TX = TABS.transactions;
const TX_COLS = ['id', 'date', 'time', 'owner', 'stream', 'direction', 'amount', 'category', 'description', 'details', 'source', 'sender', 'gmail', 'gmail_id', 'ref_no', 'status', 'transfer_id', 'rule_id', 'updated_by', 'updated_at'];
const COLS_ALL = [...TX_COLS, 'place_key', 'shared'];
const FIRST_COL = { [TABS.accounts]: 'stream', [TABS.budgets]: 'category', [TABS.connections]: 'gmail', [TABS.inboxLog]: 'gmail_id' };
export const keyOf = (tab, row) => String(row[FIRST_COL[tab] || 'id'] ?? '');
const FIXED = ['Penyesuaian', 'trf ke bank lain'];
// Rows kept whatever their age (see loadWindow): waiting ones, #bersama ones (the shared balance runs over all of them) and salary ones (the missing-salary check).
const SMALL_TABS = [TABS.accounts, TABS.budgets, TABS.goals, TABS.owed, TABS.assets, TABS.plans, TABS.connections];
// D1 allows 100 bound values per statement and 50 statements per request: rows are written several to a statement.
const TX_PER_STATEMENT = 4;
const TABS_PER_STATEMENT = 30;
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
const clone = (r) => ({ ...r });
const pad = (n) => String(n).padStart(2, '0');
const placeholders = (n, from = 1) => Array.from({ length: n }, (_, i) => `?${from + i}`).join(', ');

const tabsQuery = (q, names) => q(`SELECT tab, json FROM tabs WHERE tab IN (${placeholders(names.length)}) AND (tab != '${TABS.inboxLog}' OR rowid > (SELECT COALESCE(MAX(rowid), 0) FROM tabs) - 600) ORDER BY rowid`, ...names);

/** The 28th on or before a date: windows start there, so the stored per-month sums of what is older fit exactly. */
export function alignDown28(iso) {
  const y = Number(iso.slice(0, 4)); const m = Number(iso.slice(5, 7)); const d = Number(iso.slice(8, 10));
  const at = d >= 28 ? new Date(Date.UTC(y, m - 1, 28)) : new Date(Date.UTC(y, m - 2, 28));
  return at.toISOString().slice(0, 10);
}
/** The pay month a date belongs to, by the 28th (the stored per-month sums are cut there whatever the owner's own payday is). */
export function period28(iso) {
  const y = Number(iso.slice(0, 4)); const m = Number(iso.slice(5, 7)); const d = Number(iso.slice(8, 10));
  const at = d >= 28 ? new Date(Date.UTC(y, m, 1)) : new Date(Date.UTC(y, m - 1, 1));
  return at.toISOString().slice(0, 7);
}
/** The dates a pay month label covers: the 28th of the month before it .. the 27th of it. */
export function periodBounds(label) {
  const y = Number(label.slice(0, 4)); const m = Number(label.slice(5, 7));
  return [new Date(Date.UTC(y, m - 2, 28)).toISOString().slice(0, 10), new Date(Date.UTC(y, m - 1, 27)).toISOString().slice(0, 10)];
}

// Every query below uses an index: D1 charges for the rows a query scans, not the rows it returns.
async function loadWindow(db, cut, { rules, inbox }) {
  const q = (sql, ...args) => db.prepare(sql).bind(...args);
  const names = [...SMALL_TABS, ...(rules ? [TABS.rules] : []), ...(inbox ? [TABS.inboxLog] : [])];
  const [tx, carry, tabs, cfg, totals, places] = (await db.batch([
    // the window, plus every waiting, #bersama and salary row of any age (each from its own index)
    q(`SELECT ${TX_COLS.join(', ')} FROM transactions WHERE id IN (
         SELECT id FROM transactions WHERE date >= ?1
         UNION ALL SELECT id FROM transactions WHERE status = 'pending'
         UNION ALL SELECT id FROM transactions WHERE shared = 1
         UNION ALL SELECT id FROM transactions WHERE category = (SELECT value FROM config WHERE key = 'salary_category')) ORDER BY rowid`, cut),
    // what the older months did to each account, from the stored sums (cut is a 28th: the months before its pay month)
    q('SELECT stream, SUM(net) AS net FROM stream_months WHERE month < ?1 GROUP BY stream', period28(cut)),
    tabsQuery(q, names),
    q('SELECT key, value FROM config'),
    q('SELECT owner, month, income, expense FROM monthly_totals'),
    q('SELECT owner, place_key FROM places_seen WHERE first_date < ?1', cut),
  ])).map((r) => r.results);
  return { names, tx, carry, tabs, cfg, totals, places };
}

/** The rows the sync compares emails with: those within three days of an email's date (the whole month for a monthly summary), or sharing a reference or an email id. */
async function loadNear(db, events, ids, { rules }) {
  const q = (sql, ...args) => db.prepare(sql).bind(...args);
  const day = (iso, delta) => new Date(Date.parse(`${iso}T00:00:00Z`) + delta * 86400000).toISOString().slice(0, 10);
  const dates = events.flatMap((e) => (e.type === 'summary' ? [day(e.date.slice(0, 7) + '-01', -1), day(e.date.slice(0, 7) + '-28', 4)] : [day(e.date, -3), day(e.date, 3)])).filter(Boolean).sort();
  const lo = dates[0] || '1970-01-01';
  const hi = dates[dates.length - 1] || '1970-01-01';
  const refs = [...new Set(events.map((e) => e.refNo).filter(Boolean))].slice(0, 40);
  const mine = [...new Set(ids)].slice(0, 20);
  const names = [TABS.accounts, ...(rules ? [TABS.rules] : []), TABS.connections];
  const [tx, tabs, cfg] = (await db.batch([
    q(`SELECT ${TX_COLS.join(', ')} FROM transactions WHERE date BETWEEN ?1 AND ?2 OR ref_no IN (${placeholders(Math.max(refs.length, 1), 3)}) OR gmail_id IN (${placeholders(Math.max(mine.length, 1), 3 + Math.max(refs.length, 1))}) ORDER BY rowid`,
      lo, hi, ...(refs.length ? refs : ['']), ...(mine.length ? mine : [''])),
    tabsQuery(q, names),
    q('SELECT key, value FROM config'),
  ])).map((r) => r.results);
  return { names, tx, carry: [], tabs, cfg, totals: [], places: [] };
}

function assemble(db, data, { now, who, totalsMode, push = null }) {
  const q = (sql, ...args) => db.prepare(sql).bind(...args);
  const cfg = Object.fromEntries(data.cfg.map((r) => [r.key, r.value]));
  const person = typeof who === 'function' ? who(cfg) : who; // the person asking (a function of the household's Config, which can refuse)
  const t = { [TX]: data.tx.map(clone) };
  for (const n of data.names) t[n] = [];
  for (const r of data.tabs) t[r.tab].push(JSON.parse(r.json));
  const net = new Map(data.carry.map((r) => [r.stream, r.net]));
  t[TABS.accounts] = t[TABS.accounts].map((a) => ({ ...a, opening_balance: Number(a.opening_balance || 0) + (net.get(a.stream) || 0) }));
  let slots = JSON.parse(cfg._slots || '{"income":[],"expense":[]}');
  const totals = data.totals.map(clone);
  const places = data.places;

  const ops = [];
  const changes = []; // transaction changes, for the totals: { before, after }
  const touched = new Set(); // dates of the rows written, old and new
  const markDate = (row) => { if (row && row.date) touched.add(String(row.date).slice(0, 10)); };
  const find = (tab, id) => (t[tab] || []).findIndex((r) => keyOf(tab, r) === String(id));

  const store = {
    read: (tab) => (t[tab] || []).map(clone),
    append(tab, rows) {
      const added = rows.map(clone);
      (t[tab] ||= []).push(...added);
      if (tab === TX) added.forEach((r) => { markDate(r); changes.push({ before: null, after: clone(r) }); });
      ops.push({ op: 'append', tab, rows: added.map(clone) });
    },
    update(tab, updates) {
      for (const { id, changes: patch } of updates) {
        const i = find(tab, id);
        if (i < 0) continue;
        const before = clone(t[tab][i]);
        Object.assign(t[tab][i], patch);
        if (tab === TX) { markDate(before); markDate(t[tab][i]); changes.push({ before, after: clone(t[tab][i]) }); }
        ops.push({ op: 'put', tab, row: clone(t[tab][i]) });
      }
    },
    remove(tab, id) {
      const i = find(tab, id);
      if (i < 0) return;
      const [row] = t[tab].splice(i, 1);
      if (tab === TX) { markDate(row); changes.push({ before: clone(row), after: null }); }
      ops.push({ op: 'delete', tab, id: String(id) });
    },
    replace(tab, rows) {
      if (tab === TX) throw new Error('replacing every transaction is not possible with a window of rows');
      t[tab] = rows.map(clone);
      ops.push({ op: 'replace', tab, rows: rows.map(clone) });
    },
    config: (k) => cfg[k] ?? '',
    setConfig(k, v) { cfg[k] = String(v); ops.push({ op: 'config', key: k, value: String(v) }); },
    slots: () => ({ income: [...slots.income], expense: [...slots.expense] }),
    setSlots(s) {
      slots = { income: [...s.income], expense: [...s.expense] };
      ops.push({ op: 'config', key: '_slots', value: JSON.stringify(slots) });
      ops.push({ op: 'config', key: 'salary_category', value: salaryCategory(slots.income.filter((c) => c !== '-')) });
    },
    monthlyTotals: (w) => { const out = {}; for (const r of totals) if (r.owner === (w || '')) out[r.month] = { income: r.income, expense: r.expense }; return out; },
    earlierPlaces: (w) => places.filter((r) => !w || r.owner === w).map((r) => r.place_key),
  };
  // The app's notifications are synchronous; what it wants sent waits here and goes out after the writes (see call).
  const outbox = [];
  const cfgNow = () => cfg;
  const pushEnv = push ? { site: push.site, token: () => crypto.randomUUID().replace(/-/g, ''), send: (notice, opts) => { outbox.push({ notice, opts }); return { sent: 0, queued: true }; } } : null;
  const api = createApi(store, { now, isOwner: person.owner, meName: person.name, myEmail: person.email, push: pushEnv });

  /** The pay month (and the calendar month) a date belongs to. */
  const labelsOf = (d) => {
    const payday = Number(cfg.payday_day) || 28;
    const y = Number(d.slice(0, 4)); const m = Number(d.slice(5, 7)); const day = Number(d.slice(8, 10));
    const next = new Date(Date.UTC(y, m, 1));
    return [...new Set([d.slice(0, 7), day >= payday ? `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}` : d.slice(0, 7)])];
  };
  const ownersList = () => ['', ...new Set([...t[TABS.accounts].map((a) => a.owner), cfg.owner_name, cfg.partner_name].filter(Boolean))];

  // What one row adds to each pay month's income and expense (the totals are sums, so a change is "minus before, plus after").
  const rowsNow = [];
  const tinyStore = { read: (tab) => (tab === TX ? rowsNow.map(clone) : (t[tab] || []).map(clone)), append() {}, update() {}, remove() {}, replace() {}, config: store.config, setConfig() {}, slots: store.slots, setSlots() {} };
  const tiny = createApi(tinyStore, { now, isOwner: person.owner, meName: person.name, myEmail: person.email });
  const contribution = (row, sign, into) => {
    rowsNow.length = 0; rowsNow.push(row);
    for (const m of labelsOf(String(row.date).slice(0, 10))) {
      for (const o of ownersList()) {
        if (o && row.owner !== o) continue;
        const v = tiny.monthTotals({ month: m, owner: o || undefined });
        const k = `${o}|${m}`;
        const cur = into.get(k) || { owner: o, month: m, income: 0, expense: 0 };
        cur.income += sign * v.income; cur.expense += sign * v.expense;
        into.set(k, cur);
      }
    }
  };

  // Inside the app an account's opening balance includes what older rows folded into it; outside (the screen, the database) it is the real one.
  const carry = (stream) => net.get(stream) || 0;
  const outside = (tab, r) => (tab === TABS.accounts ? { ...r, opening_balance: Number(r.opening_balance || 0) - carry(r.stream) } : r);
  const putTx = (rows) => q(`INSERT INTO transactions (${COLS_ALL.join(', ')}) VALUES ${rows.map((_, r) => `(${COLS_ALL.map((__, c) => `?${r * COLS_ALL.length + c + 1}`).join(', ')})`).join(', ')} ON CONFLICT(id) DO UPDATE SET ${COLS_ALL.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')}`,
    ...rows.flatMap((r) => [...TX_COLS.map((c) => (r[c] === undefined || r[c] === null ? '' : r[c])), placeKey(r.description), /#bersama/i.test(String(r.description || '')) ? 1 : 0]));
  const putTabs = (tab, rows) => q(`INSERT INTO tabs (tab, id, json) VALUES ${rows.map((_, i) => `(?${i * 3 + 1}, ?${i * 3 + 2}, ?${i * 3 + 3})`).join(', ')}`, ...rows.flatMap((r) => [tab, keyOf(tab, r), JSON.stringify(outside(tab, r))]));

  const unit = {
    api,
    store,
    rowCount: data.tx.length,
    /** Runs one API method as the screen would call it (accounts go in and out with their real opening balances), then writes what it changed. */
    async call(method, args = {}) {
      const input = method === 'saveAccounts' && Array.isArray(args.accounts)
        ? { ...args, accounts: args.accounts.map((a) => ({ ...a, opening_balance: Number(a.opening_balance || 0) + carry(a.stream) })) }
        : args;
      let result = api[method](input);
      if (result && Array.isArray(result.accounts)) result = { ...result, accounts: result.accounts.map((a) => (a && 'opening_balance' in a ? outside(TABS.accounts, a) : a)) };
      const written = await unit.flush();
      if (outbox.length) { // what the method asked to send; a test notification answers with how many phones got it
        const sent = await Promise.all(outbox.splice(0).map((m) => deliver(db, cfgNow(), push, m.notice, m.opts)));
        if (method === 'pushTest') result = sent[0];
      }
      return { result, written };
    },
    /** Sends a notice now (for the sync and the daily jobs); never throws. */
    notify: (notice, opts) => deliver(db, cfgNow(), push, notice, opts).catch(() => ({ sent: 0, failed: true })),
    config: () => cfgNow(),
    /** Writes everything that changed, and the totals of the months it touched, in one batch. Returns how many statements. */
    async flush() {
      if (!ops.length) return { statements: 0, months: [] };
      const st = [];
      for (const o of ops) {
        if (o.tab === TX) {
          if (o.op === 'append') chunks(o.rows, TX_PER_STATEMENT).forEach((c) => st.push(putTx(c)));
          else if (o.op === 'put') st.push(putTx([o.row]));
          else if (o.op === 'delete') st.push(q('DELETE FROM transactions WHERE id = ?1', o.id));
        } else if (o.op === 'config') st.push(q('INSERT OR REPLACE INTO config (key, value) VALUES (?1, ?2)', o.key, o.value));
        else if (o.op === 'append') chunks(o.rows, TABS_PER_STATEMENT).forEach((c) => st.push(putTabs(o.tab, c)));
        else if (o.op === 'put') st.push(q('UPDATE tabs SET json = ?3 WHERE tab = ?1 AND id = ?2', o.tab, keyOf(o.tab, o.row), JSON.stringify(outside(o.tab, o.row))));
        else if (o.op === 'delete') st.push(q('DELETE FROM tabs WHERE tab = ?1 AND id = ?2', o.tab, o.id));
        else if (o.op === 'replace') { st.push(q('DELETE FROM tabs WHERE tab = ?1', o.tab)); chunks(o.rows, TABS_PER_STATEMENT).forEach((c) => st.push(putTabs(o.tab, c))); }
      }
      st.push(q("INSERT OR REPLACE INTO config (key, value) VALUES ('data_stamp', ?1)", String(now().getTime()))); // the pages ask "did anything change?"
      const months = [...new Set([...touched].flatMap((d) => labelsOf(d)))];
      if (totalsMode === 'delta') {
        const deltas = new Map();
        for (const c of changes) { if (c.before) contribution(c.before, -1, deltas); if (c.after) contribution(c.after, 1, deltas); }
        for (const d of deltas.values()) st.push(q('INSERT INTO monthly_totals (owner, month, income, expense) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(owner, month) DO UPDATE SET income = income + excluded.income, expense = expense + excluded.expense', d.owner, d.month, d.income, d.expense));
      } else {
        for (const m of months) for (const o of ownersList()) { const v = api.monthTotals({ month: m, owner: o || undefined }); st.push(q('INSERT OR REPLACE INTO monthly_totals (owner, month, income, expense) VALUES (?1, ?2, ?3, ?4)', o, m, v.income, v.expense)); }
      }
      // The stored summaries of what the writes touched: the sums per account and pay month, and the first date of each place.
      // They are worked out by the database from the rows now stored, so this is a second batch, after the writes.
      const st2 = [];
      const sal = cfg.salary_category || '';
      for (const label of new Set([...touched].map(period28))) {
        const [from, to] = periodBounds(label);
        st2.push(q('DELETE FROM stream_months WHERE month = ?1', label));
        st2.push(q("INSERT INTO stream_months (stream, month, net) SELECT stream, ?1, SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END) FROM transactions WHERE date BETWEEN ?2 AND ?3 AND status = 'approved' AND shared = 0 AND category != ?4 GROUP BY stream", label, from, to, sal));
      }
      const keys = new Set();
      for (const c of changes) for (const r of [c.before, c.after]) if (r) { const k = placeKey(r.description); if (k) keys.add(k); }
      const qual = "direction = 'out' AND status NOT IN ('ignored', 'pending') AND shared = 0 AND category NOT IN (?2, ?3) AND category != ?4 AND ref_no NOT LIKE 'split:%'";
      for (const k of keys) {
        const args = [k, FIXED[0], cfg.cat_transfer || FIXED[1], sal];
        st2.push(q('DELETE FROM places_seen WHERE place_key = ?1', k));
        st2.push(q(`INSERT INTO places_seen (owner, place_key, first_date) SELECT owner, ?1, MIN(date) FROM transactions WHERE place_key = ?1 AND ${qual} GROUP BY owner`, ...args));
        st2.push(q(`INSERT OR IGNORE INTO places_seen (owner, place_key, first_date) SELECT '', ?1, MIN(date) FROM transactions WHERE place_key = ?1 AND ${qual} HAVING COUNT(*) > 0`, ...args));
      }
      await db.batch(st);
      if (st2.length) await db.batch(st2);
      const statements = st.length + st2.length;
      ops.length = 0; changes.length = 0; touched.clear();
      return { statements, months };
    },
  };
  return unit;
}

const DEFAULT_WHO = { name: 'Me', email: 'a@example.com', owner: true };

/** A screen or an API method over the window of recent rows from `cut` on. */
export async function openUnit(db, cut, { rules = false, inbox = false, now = () => jakarta(), who = DEFAULT_WHO, push = null } = {}) {
  return assemble(db, await loadWindow(db, alignDown28(cut), { rules, inbox }), { now, who, totalsMode: 'recompute', push });
}

/** The sync: only the rows near the given parsed events (and the rows already holding the given email ids). */
export async function openNear(db, events, ids, { rules = true, now = () => jakarta(), who = DEFAULT_WHO, push = null } = {}) {
  return assemble(db, await loadNear(db, events, ids, { rules }), { now, who, totalsMode: 'delta', push });
}

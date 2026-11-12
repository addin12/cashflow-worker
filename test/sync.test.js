// The sync on D1 against the app's own planner on ALL rows: the same rows come out, the stored totals stay right, nothing is read twice.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../vendor/core/api.js';
import { parseEmail, READ_SIGNATURE } from '../vendor/core/parsers/index.js';
import { planSync } from '../vendor/core/plan.js';
import { TABS } from '../vendor/core/schema.js';
import { processEmail, scan } from '../src/sync.js';
import { SLOTS } from '../src/shared.js';
import { localD1 } from './d1shim.js';

const FIX = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));
const NOW = new Date('2026-11-11T03:00:00Z');
const TX_COLS = ['id', 'date', 'time', 'owner', 'stream', 'direction', 'amount', 'category', 'description', 'details', 'source', 'sender', 'gmail', 'gmail_id', 'ref_no', 'status', 'transfer_id', 'rule_id', 'updated_by', 'updated_at'];
const GMAIL = 'a@example.com';
const BASE = Date.parse('2026-11-05T03:00:00Z');

/** A fake mailbox of the test emails, oldest first, each with its own id and a one-off reference so none is a duplicate of another. */
const mailbox = FIX.map((f, i) => ({ who: 'addin', id: `e${String(i + 1).padStart(9, '0')}`, from: f.from, subject: f.subject, epochMs: BASE + i * 3600000, body: f.body, isHtml: false }));
const mail = {
  list: async (who, query) => (query.startsWith('from:(') ? mailbox.filter((m) => m.who === who && m.epochMs / 1000 >= Number(/after:(\d+)/.exec(query)[1])).map((m) => m.id).reverse() : []),
  fetch: async (who, id) => ({ ...mailbox.find((m) => m.who === who && m.id === id) }),
};
const uniqueRefs = (email, result) => (result.events || []).forEach((e) => { if (e.refNo) e.refNo = `${e.refNo}-${email.id}`; });

let db;
beforeEach(() => {
  db = localD1();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(execFileSync(process.execPath, ['scripts/gen-seed.mjs', '300'], { encoding: 'utf8', cwd: new URL('..', import.meta.url), maxBuffer: 50e6 }));
  db.exec(`INSERT INTO config (key, value) VALUES ('mail_accounts', '${JSON.stringify([{ who: 'addin', gmail: GMAIL, owner: 'Me' }])}');
    INSERT INTO tabs (tab, id, json) VALUES ('${TABS.connections}', '${GMAIL}', '${JSON.stringify({ gmail: GMAIL, owner: 'Me', checkpoint: 0, last_sync: '', last_status: '' })}');`);
});

// The reference parser result of each email, with the same one-off references the Worker's copy of the mail gets
const reader = (mailer) => ({ ...mailer, fetch: async (who, id) => ({ ...mailbox.find((m) => m.id === id) }) });
async function run(order = mailbox.map((m) => m.id)) {
  const out = [];
  for (const id of order) { db.newRequest(); out.push(await processEmail(db, withRefs(mail), { who: 'addin', id }, { now: () => NOW })); }
  return out;
}
// processEmail parses the fetched email itself: make the fetched copy carry one-off references by editing the body's reference line is fragile,
// so the test mail simply returns each email as is; the fixtures' own references are distinct per layout, and repeats are what we want to see handled.
const withRefs = (m) => m;

const txRows = () => db.sqlite.prepare(`SELECT ${TX_COLS.join(', ')} FROM transactions ORDER BY rowid`).all();
const sheetOrder = (rows) => rows.map((r) => Object.fromEntries(TX_COLS.map((c) => [c, r[c] === undefined ? '' : r[c]])));

/** The reference: the app's planner on ALL rows, email by email, in the given order. */
function reference(order) {
  const rows = sheetOrder(txRows());
  const cfg = Object.fromEntries(db.sqlite.prepare('SELECT key, value FROM config').all().map((r) => [r.key, r.value]));
  const tab = (n) => db.sqlite.prepare('SELECT json FROM tabs WHERE tab = ? ORDER BY rowid').all(n).map((r) => JSON.parse(r.json));
  const out = [];
  for (const id of order) {
    const m = mailbox.find((x) => x.id === id);
    const plan = planSync({
      emails: [{ id: m.id, from: m.from, subject: m.subject, epochMs: m.epochMs, gmail: GMAIL, result: parseEmail(m) }], existing: rows, accounts: tab(TABS.accounts), rules: tab(TABS.rules),
      config: { owner: 'Me', ownerNames: [], categories: { transfer: cfg.cat_transfer || 'trf ke bank lain', fee: cfg.cat_fee || 'Biaya Admin', dividend: cfg.cat_dividend || 'Dividen & Bunga', cash: '' } }, nowIso: NOW.toISOString(),
    });
    for (const r of plan.add.filter(Boolean)) { const full = Object.fromEntries(TX_COLS.map((c) => [c, r[c] === undefined ? '' : r[c]])); rows.push(full); out.push(full); }
    for (const u of plan.update) Object.assign(rows.find((r) => String(r.id) === String(u.id)) || {}, u.changes);
  }
  return { added: out, all: rows };
}

describe('scan', () => {
  it('finds all the new mail, oldest first, once; and nothing again after it is read', async () => {
    const first = await scan(db, mail, { now: () => NOW.getTime() });
    // (the sample log also holds old read errors of this account, which are offered again: only the new mail is looked at here)
    expect(first.messages.map((m) => m.id).filter((id) => id.startsWith('e'))).toEqual(mailbox.map((m) => m.id));
    expect(first.notes[0]).toMatch(/^addin: \d+ to read$/);
    await run();
    const second = await scan(db, mail, { now: () => NOW.getTime() });
    expect(second.messages.filter((m) => m.id.startsWith('e'))).toEqual([]);
  });
  it('a quiet minute touches almost nothing: no transactions, no log lookups, only the few Config and Connections rows', async () => {
    await scan(db, mail, { now: () => NOW.getTime() });
    await run();
    await scan(db, mail, { now: () => NOW.getTime() }); // the handled mail is now remembered
    db.log.length = 0;
    const quiet = await scan(db, mail, { now: () => NOW.getTime() + 60000 });
    expect(quiet.messages.filter((m) => m.id.startsWith('e'))).toEqual([]);
    expect(db.log.filter((q) => /FROM transactions/.test(q))).toEqual([]);
    expect(db.log.filter((q) => /Inbox Log' AND id IN/.test(q))).toEqual([]);
    expect(db.log.length).toBeLessThanOrEqual(4); // config keys, connections, and the one write of scan_checked
  });
  it('mail just sent to the queue is not sent again for 20 minutes, then it is looked at once more', async () => {
    const first = await scan(db, mail, { now: () => NOW.getTime() });
    const e1 = first.messages.filter((m) => m.id.startsWith('e'));
    expect(e1).toHaveLength(mailbox.length);
    const soon = await scan(db, mail, { now: () => NOW.getTime() + 5 * 60000 });
    expect(soon.messages.filter((m) => m.id.startsWith('e'))).toEqual([]);
    // an ordinary minute only looks at the last half hour, so mail from days ago is offered again at the next full pass: the top of the hour
    const quiet = await scan(db, mail, { now: () => NOW.getTime() + 25 * 60000 });
    expect(quiet.messages.filter((m) => m.id.startsWith('e'))).toEqual([]);
    const later = await scan(db, mail, { now: () => NOW.getTime() + 60 * 60000 });
    expect(later.messages.filter((m) => m.id.startsWith('e'))).toHaveLength(mailbox.length); // never read: offered again
  });
  it('an ordinary minute asks Gmail one short question per account; the first scan, the top of the hour and a scan after an outage ask the long ones', async () => {
    const calls = [];
    const spy = { ...mail, list: async (who, q, max) => { calls.push({ q, max }); return mail.list(who, q, max); } };
    const after = (q) => Number(/after:(\d+)/.exec(q)[1]);
    await scan(db, spy, { now: () => NOW.getTime() }); // the first scan: the long pass (two questions)
    expect(calls).toHaveLength(2);
    calls.length = 0;
    await scan(db, spy, { now: () => NOW.getTime() + 60000 });
    expect(calls).toHaveLength(1);
    expect(calls[0].max).toBe(60);
    expect(after(calls[0].q)).toBe(Math.floor((NOW.getTime() + 60000 - 30 * 60000) / 1000));
    calls.length = 0;
    await scan(db, spy, { now: () => NOW.getTime() + 60 * 60000 }); // 04:00
    expect(calls).toHaveLength(2);
    calls.length = 0;
    await scan(db, spy, { now: () => NOW.getTime() + 61 * 60000 }); // the good scan a minute ago is fresh again
    expect(calls).toHaveLength(1);
    db.exec("INSERT OR REPLACE INTO config (key, value) VALUES ('scan_ok', '" + (NOW.getTime() - 3 * 3600000) + "')");
    calls.length = 0;
    await scan(db, spy, { now: () => NOW.getTime() + 62 * 60000 }); // the last good scan was hours ago
    expect(calls).toHaveLength(2);
  });
  it('mail that arrived in the last minutes is found by the short question', async () => {
    await scan(db, mail, { now: () => NOW.getTime() });
    const fresh = { who: 'addin', id: 'enewmail0001', from: mailbox[0].from, subject: mailbox[0].subject, epochMs: NOW.getTime() + 2 * 60000, body: mailbox[0].body, isHtml: mailbox[0].isHtml };
    mailbox.push(fresh);
    try {
      const r = await scan(db, mail, { now: () => NOW.getTime() + 3 * 60000 });
      expect(r.messages.map((m) => m.id)).toEqual(['enewmail0001']);
    } finally { mailbox.pop(); }
  });
  it('an email that failed to read is offered again (once a day at 10:00 Jakarta, not every minute); one that was skipped is not', async () => {
    const id = mailbox[0].id;
    db.exec(`INSERT OR REPLACE INTO config (key, value) VALUES ('read_signature', '${READ_SIGNATURE}')`);
    db.exec(`INSERT INTO tabs (tab, id, json) VALUES ('${TABS.inboxLog}', '${id}', '${JSON.stringify({ gmail_id: id, received: new Date(BASE).toISOString(), from: 'x', subject: 's', status: 'error', parser: 'bca', reason: 'no amount found', rows: 0, gmail: GMAIL })}');
      INSERT INTO tabs (tab, id, json) VALUES ('${TABS.inboxLog}', '${mailbox[1].id}', '${JSON.stringify({ gmail_id: mailbox[1].id, received: new Date(BASE).toISOString(), from: 'x', subject: 's', status: 'skip', parser: 'bca', reason: 'not a transaction email', rows: 0, gmail: GMAIL })}');`);
    const at = (iso) => scan(db, mail, { now: () => Date.parse(iso) });
    expect((await at('2026-11-11T03:00:00Z')).messages.map((m) => m.id)).toContain(id);
    // the retry list is kept in Config: a read error is not offered at other times of the day, and the retried batch is not offered twice
    db.exec("UPDATE config SET value = '[]' WHERE key = 'retry_pending'");
    expect((await at('2026-11-11T05:30:00Z')).messages.map((m) => m.id)).not.toContain(id);
    expect((await at('2026-11-11T05:00:00Z')).messages.map((m) => m.id)).not.toContain(id); // hourly: only waiting receipts
    const next = await at('2026-11-12T03:00:00Z');
    expect(next.messages.map((m) => m.id)).toContain(id);
    expect(next.messages.map((m) => m.id)).not.toContain(mailbox[1].id);
  });
  it('a mail service that fails is reported in the notes and does not stop the others', async () => {
    const broken = { list: async () => { throw new Error('mail service answered 500'); }, fetch: mail.fetch };
    const out = await scan(db, broken, { now: () => NOW.getTime() });
    expect(out.messages).toEqual([]);
    expect(out.notes[0]).toBe('addin: mail service answered 500');
  });
});

describe('processing emails', () => {
  it('the rows written equal what the app\'s planner makes from all rows, in the same order', async () => {
    const order = mailbox.map((m) => m.id);
    const ref = reference(order);
    const results = await run(order);
    expect(results.every((r) => r.statements <= 50)).toBe(true);
    const mine = sheetOrder(txRows());
    expect(mine.length).toBe(ref.all.length);
    expect(mine).toEqual(ref.all);
    expect(ref.added.length).toBeGreaterThan(3);
  });
  it('in any order the same rows come out', async () => {
    for (const order of [[...mailbox].reverse().map((m) => m.id), [mailbox[3], mailbox[0], mailbox[6], mailbox[1], mailbox[5], mailbox[2], mailbox[4]].map((m) => m.id)]) {
      beforeEachReset();
      const ref = reference(order);
      await run(order);
      expect(sheetOrder(txRows())).toEqual(ref.all);
    }
  });
  it('each email is logged once; the checkpoint moves to the newest email; the connection says when', async () => {
    await run();
    const log = db.sqlite.prepare(`SELECT json FROM tabs WHERE tab = '${TABS.inboxLog}' AND id LIKE 'e%'`).all().map((r) => JSON.parse(r.json));
    expect(log.map((l) => l.gmail_id).sort()).toEqual(mailbox.map((m) => m.id).sort());
    expect(log.every((l) => ['ok', 'skip', 'error', 'waiting'].includes(l.status))).toBe(true);
    const conn = JSON.parse(db.sqlite.prepare('SELECT json FROM tabs WHERE tab = ? AND id = ?').get(TABS.connections, GMAIL).json);
    expect(conn.checkpoint).toBe(mailbox[mailbox.length - 1].epochMs);
    expect(conn.last_sync).toBe(NOW.toISOString());
  });
  it('reading the same email twice adds nothing and logs nothing more', async () => {
    await run();
    const before = txRows().length;
    const logBefore = db.sqlite.prepare(`SELECT COUNT(*) AS n FROM tabs WHERE tab = '${TABS.inboxLog}'`).get().n;
    db.newRequest();
    const again = await processEmail(db, mail, { who: 'addin', id: mailbox[0].id }, { now: () => NOW });
    expect(again).toMatchObject({ added: 0, logged: 0 });
    expect(txRows().length).toBe(before);
    expect(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM tabs WHERE tab = '${TABS.inboxLog}'`).get().n).toBe(logBefore);
  });
  it('the stored monthly totals stay equal to what the app works out from all rows', async () => {
    await run();
    const tx = db.sqlite.prepare('SELECT * FROM transactions ORDER BY rowid').all().map(({ place_key: _p, ...r }) => r);
    const tabs = {};
    for (const r of db.sqlite.prepare('SELECT tab, json FROM tabs ORDER BY rowid').all()) (tabs[r.tab] ||= []).push(JSON.parse(r.json));
    const cfg = Object.fromEntries(db.sqlite.prepare('SELECT key, value FROM config').all().map((r) => [r.key, r.value]));
    const store = { read: (n) => (n === TABS.transactions ? tx : tabs[n] || []).map((r) => ({ ...r })), append() {}, update() {}, remove() {}, replace() {}, config: (k) => cfg[k] ?? '', setConfig() {}, slots: () => SLOTS, setSlots() {} };
    const api = createApi(store, { now: () => NOW, isOwner: true, meName: 'Me', myEmail: GMAIL });
    const stored = db.sqlite.prepare('SELECT owner, month, income, expense FROM monthly_totals').all();
    expect(stored.length).toBeGreaterThan(0);
    for (const r of stored) {
      const t = api.monthTotals({ month: r.month, owner: r.owner || undefined });
      expect(r.income, `${r.owner || 'Kita'} ${r.month} income`).toBeCloseTo(t.income, 4);
      expect(r.expense, `${r.owner || 'Kita'} ${r.month} expense`).toBeCloseTo(t.expense, 4);
    }
  });
});

// a fresh database between the permutations inside one test
function beforeEachReset() {
  db = localD1();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(execFileSync(process.execPath, ['scripts/gen-seed.mjs', '300'], { encoding: 'utf8', cwd: new URL('..', import.meta.url), maxBuffer: 50e6 }));
  db.exec(`INSERT INTO config (key, value) VALUES ('mail_accounts', '${JSON.stringify([{ who: 'addin', gmail: GMAIL, owner: 'Me' }])}');
    INSERT INTO tabs (tab, id, json) VALUES ('${TABS.connections}', '${GMAIL}', '${JSON.stringify({ gmail: GMAIL, owner: 'Me', checkpoint: 0, last_sync: '', last_status: '' })}');`);
}

// The Gmail sync on Cloudflare, in two parts that match the Apps Script version:
//   scan     (every minute, from the schedule)  which mail is new for each account, or must be read again? -> queue messages
//   process  (one queue message at a time)      fetch one email, read it with the app's parser, plan it with the app's planner against the
//                                               rows near it, write the rows, the log line, the rule hits and the checkpoint in one batch
import { jakarta } from './clock.js';
import { READ_SIGNATURE, SENDERS, backfillQuery, parseEmail } from '../vendor/core/parsers/index.js';
import { planSync } from '../vendor/core/plan.js';
import { retryable } from '../vendor/core/retry.js';
import { TABS } from '../vendor/core/schema.js';
import { alertUnread, notifyNewRows } from './push.js';
import { openNear } from './unit.js';

export const OVERLAP_MS = 2 * 24 * 3600 * 1000;
export const MAX_QUEUED_PER_RUN = 20; // new mail per account and run: a backlog is worked off over several runs
const MAX_RETRIES_PER_RUN = 10; // mail read again per run
// Mail that could not be read is not tried every minute (that would fill the free queue with the same failures):
// receipts still waiting for their charge every hour, read errors once a day at 10:00 (Jakarta), and everything once whenever the readers change.
const TX = TABS.transactions;
const LOG = TABS.inboxLog;
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

/** The accounts to read: [{ who, gmail, owner }] (who = the key in the mail Worker), kept in Config `mail_accounts`. */
export const accountsOf = (cfg) => { try { return JSON.parse(cfg.mail_accounts || '[]'); } catch { return []; } };

const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

/** Which of these Gmail ids are already in the transactions, and what the log last said about the others. */
async function knownIds(db, ids) {
  const inTx = new Set();
  const logged = new Map();
  for (const c of chunks(ids, 80)) {
    const marks = c.map((_, i) => `?${i + 1}`).join(', ');
    const [tx, log] = (await db.batch([
      db.prepare(`SELECT gmail_id FROM transactions WHERE gmail_id IN (${marks})`).bind(...c),
      db.prepare(`SELECT json FROM tabs WHERE tab = '${LOG}' AND id IN (${marks})`).bind(...c),
    ])).map((r) => r.results);
    tx.forEach((r) => inTx.add(r.gmail_id));
    log.forEach((r) => { const row = JSON.parse(r.json); logged.set(String(row.gmail_id), row); }); // the latest line of an email decides
  }
  return { inTx, logged };
}

const json = (v, fallback) => { try { return JSON.parse(v || ''); } catch { return fallback; } };
const KNOWN_PER_ACCOUNT = 400; // handled ids remembered per account (a few days of mail)
const STALE_AFTER_MS = 2 * 3600000; // the mail reader has not answered for this long: tell the owner
const ALERT_EVERY_MS = 12 * 3600000;
const QUEUED_FOR_MS = 20 * 60000;
const STAMP_EVERY_MS = 20 * 60000; // a mailbox that answered is marked as read at most this often (the app calls one that was not marked for 2 hours "stopped")
// An ordinary minute asks Gmail only about the last half hour, once per account (one short list instead of two long ones: a third of the CPU).
// The full pass (two days back from the checkpoint, plus the receipts since the start date) runs at the top of every hour, when the readers changed,
// on the first scan, and whenever the last good scan is more than half an hour old (after an outage), so nothing slips through for more than an hour.
const QUICK_WINDOW_MS = 30 * 60000;
const QUICK_IF_OK_WITHIN_MS = 30 * 60000; // an id sent to the queue is not sent again for this long

/**
 * For every account: the ids of mail to read (new ones, oldest first, and logged errors / waiting receipts that are due again).
 * Returns the queue messages and a short note per account.
 *
 * A quiet minute must cost almost nothing (D1 charges every row read, and this runs 1,440 times a day): the ids already handled are
 * remembered in Config (known_ids), the ids just sent to the queue too (queued_ids), so only mail never seen before reaches the database.
 */
export async function scan(db, mail, { now = () => Date.now(), full = false } = {}) {
  const keys = ['mail_accounts', 'start_date', 'read_signature', 'retry_pending', 'known_ids', 'queued_ids', 'scan_ok', 'scan_alerted'];
  const cfg = Object.fromEntries((await db.prepare(`SELECT key, value FROM config WHERE key IN (${keys.map((_, i) => `?${i + 1}`).join(', ')})`).bind(...keys).all()).results.map((r) => [r.key, r.value]));
  const accounts = accountsOf(cfg);
  const startMs = Date.parse(`${cfg.start_date || '1970-01-01'}T00:00:00Z`) || 0;
  const conns = (await db.prepare('SELECT json FROM tabs WHERE tab = ?1').bind(TABS.connections).all()).results.map((r) => JSON.parse(r.json));
  const known = json(cfg.known_ids, {});
  const queued = json(cfg.queued_ids, {});
  const knownBefore = JSON.stringify(known);
  const queuedBefore = JSON.stringify(queued);
  const messages = [];
  const notes = [];
  const looked = []; // per mailbox: did Gmail answer? (marks the connection, so a quiet mailbox is not reported as stopped)
  let failed = false;
  const t = new Date(now());
  const hourly = t.getUTCMinutes() === 0;
  const daily = hourly && t.getUTCHours() === 3;
  const changed = cfg.read_signature !== READ_SIGNATURE;
  const quick = !full && !changed && !hourly && Number(cfg.scan_ok) > 0 && now() - Number(cfg.scan_ok) < QUICK_IF_OK_WITHIN_MS;
  const pending = json(cfg.retry_pending, []);
  for (const id of Object.keys(queued)) if (now() - queued[id] > 3 * QUEUED_FOR_MS) delete queued[id];
  for (const a of accounts) {
    const conn = conns.find((c) => String(c.gmail).toLowerCase() === String(a.gmail).toLowerCase()) || {};
    const sinceMs = quick ? Math.max(startMs, now() - QUICK_WINDOW_MS) : Math.max(startMs, (Number(conn.checkpoint) || 0) - OVERLAP_MS);
    const query = `from:(${SENDERS.join(' OR ')}) after:${Math.floor(sinceMs / 1000)}`;
    let listed;
    try {
      listed = quick ? await mail.list(a.who, query, 60) : [...new Set([...(await mail.list(a.who, query, 200)), ...(await mail.list(a.who, backfillQuery(Math.floor(startMs / 1000)), 100))])];
    } catch (e) { notes.push(`${a.who}: ${e.message}`); failed = true; looked.push({ conn, ok: false, why: String(e.message || e).slice(0, 120) }); continue; }
    looked.push({ conn, ok: true });
    const mine = new Set(known[a.who] || []);
    const unseen = listed.filter((id) => !mine.has(id) && !(queued[id] && now() - queued[id] < QUEUED_FOR_MS));
    // Only mail not remembered reaches the database: is it already in the transactions or the log?
    const { inTx, logged } = unseen.length ? await knownIds(db, unseen) : { inTx: new Set(), logged: new Map() };
    const due = (r) => retryable(r.status, Date.parse(r.received) || 0, now(), { rescan: false, reason: r.reason });
    const fresh = [];
    for (const id of unseen) { if (inTx.has(id) || logged.has(id)) mine.add(id); else fresh.push(id); }
    fresh.reverse(); // oldest first
    const ids = fresh.slice(0, MAX_QUEUED_PER_RUN);
    for (const id of ids) { messages.push({ who: a.who, id }); queued[id] = now(); }
    known[a.who] = [...mine].slice(-KNOWN_PER_ACCOUNT);
    notes.push(`${a.who}: ${ids.length} to read`);
    if (changed || hourly) {
      const failed = (await db.prepare(`SELECT json FROM tabs WHERE tab = '${LOG}' AND (json LIKE '%"status":"error"%' OR json LIKE '%"status":"waiting"%')`).all()).results
        .map((r) => JSON.parse(r.json)).filter((r) => String(r.gmail).toLowerCase() === String(a.gmail).toLowerCase() && due(r)
          && (changed || r.status === 'waiting' || daily));
      const failedIds = failed.map((r) => String(r.gmail_id));
      const { inTx: done } = failedIds.length ? await knownIds(db, failedIds) : { inTx: new Set() };
      // the latest line of an email decides: one that has since been read (a later "ok" line) is not offered
      for (const r of failed) if (!done.has(r.gmail_id) && !pending.some((x) => x.id === String(r.gmail_id)) && !ids.includes(String(r.gmail_id))) pending.push({ who: a.who, id: String(r.gmail_id) });
    }
  }
  const retry = pending.slice(0, MAX_RETRIES_PER_RUN).filter((m) => !messages.some((x) => x.id === m.id));
  messages.push(...retry);
  const rest = pending.slice(MAX_RETRIES_PER_RUN);
  const put = (k, v) => db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?1, ?2)').bind(k, v);
  const writes = [put('scan_checked', String(now()))]; // when the mail was last looked at: the pages show it
  // Every mailbox Gmail answered for is marked as read now (not only when a bank e-mail turned up); one it did not answer for says why, and keeps its old time.
  const iso = new Date(now()).toISOString();
  let marked = false;
  for (const l of looked) {
    const c = l.conn;
    if (!c || !c.gmail) continue;
    const age = now() - (Date.parse(c.last_sync) || 0);
    const next = l.ok
      ? (age > STAMP_EVERY_MS || /^ERROR/.test(String(c.last_status || '')) ? { ...c, last_sync: iso, last_status: `live ok: ${iso.slice(0, 10)}` } : null)
      : (/^ERROR/.test(String(c.last_status || '')) ? null : { ...c, last_status: `ERROR: ${l.why}` });
    if (next) { writes.push(db.prepare('UPDATE tabs SET json = ?1 WHERE tab = ?2 AND id = ?3').bind(JSON.stringify(next), TABS.connections, c.gmail)); marked = true; }
  }
  if (marked) writes.push(put('data_stamp', String(now())));
  // The mail reader answering is what 'healthy' means. When it has not for STALE_AFTER_MS, say so once per ALERT_EVERY_MS (the caller sends the alert).
  const okAt = Number(cfg.scan_ok) || now();
  if (!failed && (!cfg.scan_ok || now() - okAt > 10 * 60000)) writes.push(put('scan_ok', String(now())));
  const stale = failed && now() - okAt > STALE_AFTER_MS && now() - (Number(cfg.scan_alerted) || 0) > ALERT_EVERY_MS;
  if (stale) writes.push(put('scan_alerted', String(now())));
  if (changed || pending.length !== rest.length) writes.push(put('retry_pending', JSON.stringify(rest)), put('read_signature', READ_SIGNATURE));
  if (JSON.stringify(known) !== knownBefore) writes.push(put('known_ids', JSON.stringify(known)));
  if (JSON.stringify(queued) !== queuedBefore) writes.push(put('queued_ids', JSON.stringify(queued)));
  await db.batch(writes);
  if (retry.length) notes.push(`${retry.length} read again`);
  return { messages, notes, stale: stale ? { hours: Math.floor((now() - okAt) / 3600000) } : null };
}

/**
 * The "Sinkron sekarang" button: looks at Gmail at once with the full pass (what the top of the hour does) and queues what is new. The emails are then read
 * one by one in the background, so the answer is how many were found.
 */
export async function syncNow({ db, mail, queue }, { now = () => Date.now() } = {}) {
  const { messages } = await scan(db, mail, { now, full: true });
  for (let i = 0; i < messages.length; i += 50) await queue.sendBatch(messages.slice(i, i + 50).map((body) => ({ body })));
  return { status: 'ok', added: messages.length };
}

/** What planSync needs to know about the household. */
function syncConfig(cfg, owner, slots) {
  const cash = String(cfg.cat_cash || 'Tarik Tunai');
  const known = [...slots.income, ...slots.expense].some((c) => String(c).trim().toLowerCase() === cash.toLowerCase());
  return {
    owner,
    ownerNames: String(cfg[owner === cfg.partner_name ? 'partner_bank_names' : 'owner_bank_names'] || '').split(',').map((s) => s.trim()).filter(Boolean),
    categories: { transfer: String(cfg.cat_transfer || 'trf ke bank lain'), fee: String(cfg.cat_fee || 'Biaya Admin'), dividend: String(cfg.cat_dividend || 'Dividen & Bunga'), cash: known ? cash : '' },
  };
}

/** One queue message: read one email and write what it means. Returns what happened (for the log and the tests). */
export async function processEmail(db, mail, { who, id }, { now = () => jakarta(), parse = parseEmail, push = null } = {}) {
  const email = await mail.fetch(who, id);
  const result = parse(email);
  const events = result.events || [];
  const unit = await openNear(db, events, [id], { rules: true, now });
  const { store } = unit;
  const cfg = Object.fromEntries((await db.prepare('SELECT key, value FROM config').all()).results.map((r) => [r.key, r.value]));
  const acct = accountsOf(cfg).find((a) => a.who === who) || { gmail: '', owner: cfg.owner_name };
  const existing = store.read(TX);
  const rules = store.read(TABS.rules);
  const plan = planSync({
    emails: [{ id: email.id, from: email.from, subject: email.subject, epochMs: email.epochMs, gmail: acct.gmail, result }],
    existing, accounts: store.read(TABS.accounts), rules, config: syncConfig(cfg, acct.owner, store.slots()), nowIso: now().toISOString(),
  });
  if (plan.add.length) store.append(TX, plan.add.filter(Boolean));
  if (plan.update.length) store.update(TX, plan.update);
  const last = await db.prepare(`SELECT json FROM tabs WHERE tab = '${LOG}' AND id = ?1 ORDER BY rowid DESC LIMIT 1`).bind(String(id)).first();
  const lastStatus = last ? JSON.parse(last.json).status : null;
  // a retry that ends the same way as the line already in the log is not logged twice; an email that already made rows is logged once
  const already = existing.some((r) => String(r.gmail_id) === String(id));
  const lines = already ? [] : plan.log.filter((l) => l.status !== lastStatus).map((l) => ({ gmail_id: l.gmailId, received: new Date(email.epochMs).toISOString(), from: email.from, subject: email.subject, status: l.status, parser: l.parser || '', reason: l.reason || '', rows: l.rows, gmail: acct.gmail }));
  if (lines.length) store.append(LOG, lines);
  for (const r of rules) if (plan.ruleHits[r.id]) store.update(TABS.rules, [{ id: r.id, changes: { hits: (Number(r.hits) || 0) + plan.ruleHits[r.id] } }]);
  const conn = store.read(TABS.connections).find((c) => String(c.gmail).toLowerCase() === String(acct.gmail).toLowerCase());
  if (conn) store.update(TABS.connections, [{ id: conn.gmail, changes: { checkpoint: Math.max(Number(conn.checkpoint) || 0, email.epochMs), last_sync: now().toISOString(), last_status: `live ok: ${day(email.epochMs)}` } }]);
  const written = await unit.flush();
  await notifyNewRows(db, cfg, push, plan.add.filter(Boolean)); // a phone notification about the new rows (never throws)
  await alertUnread(db, cfg, push, lines.filter((l) => l.status === 'error')); // a bank email that could not be read (never throws)
  return { added: plan.add.length, updated: plan.update.length, logged: lines.length, statements: written.statements, statuses: plan.log.map((l) => l.status) };
}

// "Cari langganan tahunan" (Kelola langganan): reads the bank e-mails and receipts of a year in the person's own Gmail accounts and finds the plans that renew once
// a year (the shared core's findYearly decides which). Nothing becomes a transaction; what is found goes to Config yearly_subs.
// A year of mail is too much for one request on the free plan, so the button only lists the e-mail ids and queues them in small batches; the queue reads
// one batch at a time (src/daily.js runJob) and the last batch merges the result.
import { SENDERS, parseEmail } from '../vendor/core/parsers/index.js';
import { findYearly, mergeYearly, yearlyQuery } from '../vendor/core/yearly.js';
import { personFor } from './identity.js';

const CHUNK = 15; // e-mails per queue message (each one is a request to the Gmail reader: stay well under the 50 subrequests of a free request)
const MAX_IDS = 250; // per mailbox, newest first
const json = (v, fallback) => { try { return JSON.parse(v || ''); } catch { return fallback; } };
const put = (db, k, v) => db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?1, ?2)').bind(k, v);

/** The button: lists the ids and queues the batches. Answers at once; the plans appear when the last batch has been read. */
export async function startYearlyScan({ db, mail, queue, email }, { now = () => new Date() } = {}) {
  const rows = (await db.prepare("SELECT key, value FROM config WHERE key IN ('mail_accounts', 'owner_name', 'owner_email', 'partner_name', 'partner_email')").all()).results;
  const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const person = personFor(cfg, email);
  const mine = json(cfg.mail_accounts, []).filter((a) => !a.owner || a.owner === person.name);
  if (!mine.length) throw new Error('no Gmail is connected for you');
  const today = now();
  const after = Math.floor(new Date(today.getFullYear() - 1, today.getMonth() - 1, 1).getTime() / 1000);
  const batches = [];
  for (const a of mine) {
    const ids = await mail.list(a.who, yearlyQuery(SENDERS, after), MAX_IDS);
    for (let i = 0; i < ids.length; i += CHUNK) batches.push({ who: a.who, ids: ids.slice(i, i + CHUNK) });
  }
  const iso = today.toISOString();
  const scanKey = person.owner ? 'yearly_scan' : 'partner_yearly_scan';
  if (!batches.length) { await db.batch([put(db, scanKey, iso), put(db, 'data_stamp', String(today.getTime()))]); return { queued: 0, read: 0, found: 0 }; }
  const run = String(today.getTime());
  const job = { run, by: person.name, first: cfg.owner_name || '', scanKey, total: batches.length, done: 0, read: 0, charges: [] };
  await put(db, 'yearly_job', JSON.stringify(job)).run(); // a new scan replaces one still running: the old one's batches are ignored (different run)
  for (let i = 0; i < batches.length; i += 50) await queue.sendBatch(batches.slice(i, i + 50).map((b) => ({ body: { job: 'yearly', run, ...b } })));
  return { queued: batches.length, read: 0, found: 0 };
}

/** One queue message: reads its e-mails, adds their money-out events to the job, and merges the result when it was the last. */
export async function yearlyChunk(db, mail, msg, { now = () => new Date(), parse = parseEmail } = {}) {
  const row = await db.prepare("SELECT value FROM config WHERE key = 'yearly_job'").first();
  const job = json(row && row.value, null);
  if (!job || job.run !== msg.run) return 'yearly: skipped (not the current scan)';
  for (const id of msg.ids || []) {
    let res;
    try { res = parse(await mail.fetch(msg.who, id)); } catch (e) { continue; } // an e-mail that cannot be read is left out, the rest goes on
    if (res.status !== 'ok') continue;
    for (const ev of res.events || []) if (ev.direction === 'out') job.charges.push({ date: ev.date, amount: ev.amount, description: ev.description, details: ev.details || '' });
  }
  job.done += 1;
  job.read += (msg.ids || []).length;
  if (job.done < job.total) { await put(db, 'yearly_job', JSON.stringify(job)).run(); return `yearly: ${job.done}/${job.total}`; }
  const found = findYearly(job.charges, { today: now() });
  const stored = json((await db.prepare("SELECT value FROM config WHERE key = 'yearly_subs'").first() || {}).value, []);
  await db.batch([
    put(db, 'yearly_subs', JSON.stringify(mergeYearly(stored, found, { by: job.by, firstPerson: job.first }))),
    put(db, job.scanKey, now().toISOString()),
    put(db, 'yearly_job', ''),
    put(db, 'data_stamp', String(now().getTime())),
  ]);
  return `yearly: done, ${job.read} e-mails, ${found.length} plan(s)`;
}

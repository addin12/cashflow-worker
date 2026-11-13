// "Cari langganan tahunan": the button lists the e-mails and queues them in batches; the queue reads one batch at a time; the last batch merges the result.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { run } from '../src/app.js';
import { runJob } from '../src/daily.js';
import { startYearlyScan, yearlyChunk } from '../src/yearly.js';
import { localD1 } from './d1shim.js';

const TODAY = new Date(2026, 10, 13);
let db;
let sent;
const set = (k, v) => db.sqlite.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(k, v);
const get = (k) => (db.sqlite.prepare('SELECT value FROM config WHERE key = ?').get(k) || {}).value;
const ids = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(3, '0')}`);
const queue = { sendBatch: async (msgs) => { sent.push(...msgs.map((m) => m.body)); } };
const charge = (description, date, amount = 169000) => ({ direction: 'out', date, amount, description, details: '' });
// a fake Gmail reader: `list` answers per mailbox, `fetch` hands back what the parse stub reads
const mailWith = (lists, mails) => ({ list: async (who) => lists[who] || [], fetch: async (who, id) => ({ id, stub: mails[id] }) });
const parse = (email) => { if (email.stub === 'broken') throw new Error('cannot read'); return email.stub || { status: 'skip' }; };
const ok = (...events) => ({ status: 'ok', events });

beforeEach(() => {
  sent = [];
  db = localD1();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  set('owner_name', 'Me'); set('owner_email', 'me@example.com'); set('partner_name', 'Dewi'); set('partner_email', 'dewi@example.com');
  set('mail_accounts', JSON.stringify([{ who: 'addin', gmail: 'me@example.com', owner: 'Me' }, { who: 'dewi', gmail: 'dewi@example.com', owner: 'Dewi' }]));
});

const runAll = async (mail) => { for (const msg of sent) await yearlyChunk(db, mail, msg, { now: () => TODAY, parse }); };

describe('starting the scan', () => {
  it('lists the e-mails of the caller\'s own mailboxes only and queues them in batches of 15', async () => {
    const mail = mailWith({ addin: ids('a', 40), dewi: ids('d', 5) }, {});
    const r = await startYearlyScan({ db, mail, queue, email: 'me@example.com' }, { now: () => TODAY });
    expect(r).toEqual({ queued: 3, read: 0, found: 0 });
    expect(sent.map((m) => [m.job, m.who, m.ids.length])).toEqual([['yearly', 'addin', 15], ['yearly', 'addin', 15], ['yearly', 'addin', 10]]);
    expect(JSON.parse(get('yearly_job'))).toMatchObject({ by: 'Me', total: 3, done: 0, scanKey: 'yearly_scan' });
  });

  it('the partner scans her own Gmail and is recorded under her own key', async () => {
    const mail = mailWith({ addin: ids('a', 3), dewi: ids('d', 2) }, {});
    await startYearlyScan({ db, mail, queue, email: 'dewi@example.com' }, { now: () => TODAY });
    expect(sent.map((m) => m.who)).toEqual(['dewi']);
    expect(JSON.parse(get('yearly_job')).scanKey).toBe('partner_yearly_scan');
  });

  it('nothing to read still counts as a scan done; someone outside the household, or with no Gmail connected, is refused', async () => {
    const r = await startYearlyScan({ db, mail: mailWith({}, {}), queue, email: 'me@example.com' }, { now: () => TODAY });
    expect(r).toEqual({ queued: 0, read: 0, found: 0 });
    expect(get('yearly_scan')).toBe(TODAY.toISOString());
    await expect(startYearlyScan({ db, mail: mailWith({}, {}), queue, email: 'stranger@example.com' })).rejects.toThrow('not part of the household');
    set('mail_accounts', JSON.stringify([{ who: 'dewi', gmail: 'dewi@example.com', owner: 'Dewi' }]));
    await expect(startYearlyScan({ db, mail: mailWith({}, {}), queue, email: 'me@example.com' })).rejects.toThrow('no Gmail is connected for you');
  });
});

describe('reading the batches', () => {
  it('the last batch finds the yearly plans and stores them, and clears the job', async () => {
    const mail = mailWith({ addin: ids('a', 20) }, { a000: ok(charge('Canva Pro yearly', '2025-12-01')), a001: ok(charge('Bakso', '2026-10-01', 20000)), a015: ok(charge('Canva Pro yearly', '2024-12-01')), a002: 'broken' });
    await startYearlyScan({ db, mail, queue, email: 'me@example.com' }, { now: () => TODAY });
    await yearlyChunk(db, mail, sent[0], { now: () => TODAY, parse });
    expect(get('yearly_subs')).toBeUndefined(); // not yet: one batch to go
    await yearlyChunk(db, mail, sent[1], { now: () => TODAY, parse });
    const plans = JSON.parse(get('yearly_subs'));
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ name: 'Canva Pro yearly', amount: 169000, lastDate: '2025-12-01', nextDate: '2026-12-01', by: 'Me' });
    expect(get('yearly_job')).toBe('');
    expect(get('yearly_scan')).toBe(TODAY.toISOString());
    expect(Number(get('data_stamp'))).toBe(TODAY.getTime()); // the open app sees it
  });

  it('a scan replaces only the plans of the person who scanned', async () => {
    set('yearly_subs', JSON.stringify([{ key: 'dewi plan', name: 'Dewi plan', amount: 1, lastDate: '2026-01-01', nextDate: '2027-01-01', guess: true, by: 'Dewi' }, { key: 'old mine', name: 'Old mine', amount: 1, lastDate: '2025-01-01', nextDate: '2026-12-01', guess: true, by: 'Me' }]));
    const mail = mailWith({ addin: ids('a', 3) }, { a000: ok(charge('Canva Pro yearly', '2025-12-01')) });
    await startYearlyScan({ db, mail, queue, email: 'me@example.com' }, { now: () => TODAY });
    await runAll(mail);
    expect(JSON.parse(get('yearly_subs')).map((p) => [p.name, p.by]).sort()).toEqual([['Canva Pro yearly', 'Me'], ['Dewi plan', 'Dewi']]);
  });

  it('batches of an older scan are ignored once a new scan has started', async () => {
    const mail = mailWith({ addin: ids('a', 20) }, { a000: ok(charge('Canva Pro yearly', '2025-12-01')) });
    await startYearlyScan({ db, mail, queue, email: 'me@example.com' }, { now: () => new Date(2026, 10, 13, 9) });
    const old = sent.splice(0);
    await startYearlyScan({ db, mail, queue, email: 'me@example.com' }, { now: () => new Date(2026, 10, 13, 10) });
    expect(await yearlyChunk(db, mail, old[0], { now: () => TODAY, parse })).toMatch(/skipped/);
    expect(JSON.parse(get('yearly_job')).done).toBe(0);
  });

  it('goes through the daily-job runner the queue uses, and through the app\'s method', async () => {
    const mail = mailWith({ addin: ids('a', 2) }, { a000: ok(charge('Canva Pro yearly', '2025-12-01')) });
    await startYearlyScan({ db, mail, queue, email: 'me@example.com' }, { now: () => TODAY });
    expect(await runJob(db, sent[0], { mail })).toMatch(/^yearly:/);
    // the method: the Worker's own (it reads Gmail), answering at once
    const binding = { fetch: async (url, init) => { const call = JSON.parse(init.body).params; return new Response(JSON.stringify({ result: { content: [{ text: JSON.stringify(call.name === 'gmail_addin_list' ? ids('z', 4) : []) }] } }), { status: 200 }); } };
    db.newRequest();
    sent.length = 0;
    const r = await run({ DB: db, MAIL: binding, MAIL_TOKEN: 'x'.repeat(24), SYNC_QUEUE: queue }, 'scanYearly', {}, { email: 'me@example.com' });
    expect(r.result).toEqual({ queued: 1, read: 0, found: 0 });
    expect(sent).toHaveLength(1);
  });
});

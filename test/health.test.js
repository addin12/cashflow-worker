import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { TABS } from '../vendor/core/schema.js';
import { alertUnread, staleNotice } from '../src/push.js';
import { scan } from '../src/sync.js';
import { localD1 } from './d1shim.js';

const NOW = Date.parse('2026-11-11T03:00:00Z');
const HOUR = 3600000;
let db;
const set = (k, v) => db.sqlite.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(k, v);
const get = (k) => (db.sqlite.prepare('SELECT value FROM config WHERE key = ?').get(k) || {}).value;
const okMail = { list: async () => [], fetch: async () => { throw new Error('none'); } };
const downMail = { list: async () => { throw new Error('mail service answered 503'); }, fetch: okMail.fetch };

beforeEach(() => {
  db = localD1();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  set('mail_accounts', JSON.stringify([{ who: 'addin', gmail: 'a@example.com', owner: 'Me' }]));
  set('start_date', '2026-09-01');
  set('owner_name', 'Me');
  db.exec(`INSERT INTO tabs (tab, id, json) VALUES ('${TABS.connections}', 'a@example.com', '{"gmail":"a@example.com","checkpoint":0}')`);
});

describe('the mail reader going silent', () => {
  it('a healthy scan remembers when it last worked, without writing every minute', async () => {
    await scan(db, okMail, { now: () => NOW });
    expect(get('scan_ok')).toBe(String(NOW));
    await scan(db, okMail, { now: () => NOW + 60000 });
    expect(get('scan_ok')).toBe(String(NOW)); // not rewritten a minute later
    await scan(db, okMail, { now: () => NOW + 11 * 60000 });
    expect(get('scan_ok')).toBe(String(NOW + 11 * 60000));
  });
  it('no alert for a short outage', async () => {
    set('scan_ok', String(NOW - HOUR));
    expect((await scan(db, downMail, { now: () => NOW })).stale).toBeNull();
  });
  it('an outage of more than two hours is reported once, then not again for twelve hours', async () => {
    set('scan_ok', String(NOW - 3 * HOUR));
    expect((await scan(db, downMail, { now: () => NOW })).stale).toEqual({ hours: 3 });
    expect((await scan(db, downMail, { now: () => NOW + 60000 })).stale).toBeNull();
    expect((await scan(db, downMail, { now: () => NOW + 13 * HOUR })).stale).toEqual({ hours: 16 });
  });
  it('the notice says how long', () => {
    expect(staleNotice(3).body).toContain('3 jam');
    expect(staleNotice(3, 'en').body).toContain('3 hours');
  });
});

describe('bank mail that could not be read', () => {
  it('goes to the owner only', async () => {
    const sent = [];
    const push = { site: 'https://s', secret: 'x'.repeat(24), fetch: async (u, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ results: [] })); } };
    const dev = (owner, n) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) }, owner });
    set('push_devices', JSON.stringify([dev('Me', 'one'), dev('Dewi', 'two')]));
    const cfg = Object.fromEntries(db.sqlite.prepare('SELECT key, value FROM config').all().map((r) => [r.key, r.value]));
    await alertUnread(db, cfg, push, [{ subject: 'Mutasi rekening', reason: 'format baru' }]);
    expect(sent).toHaveLength(1);
    expect(sent[0].subscriptions.map((s) => s.endpoint)).toEqual([dev('Me', 'one').endpoint]);
    expect(sent[0].notification.body).toContain('Mutasi rekening · format baru');
    await alertUnread(db, cfg, push, []);
    expect(sent).toHaveLength(1);
  });
});

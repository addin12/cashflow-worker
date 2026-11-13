// A mailbox that Gmail answered for counts as read even when no bank e-mail turned up (the app calls a mailbox "stopped" after 2 hours without a mark).
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { TABS } from '../vendor/core/schema.js';
import { staleSyncs } from '../vendor/core/synchealth.js';
import { scan } from '../src/sync.js';
import { localD1 } from './d1shim.js';

const NOW = Date.parse('2026-11-13T04:30:00Z');
const MIN = 60000;
let db;
const set = (k, v) => db.sqlite.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(k, v);
const get = (k) => (db.sqlite.prepare('SELECT value FROM config WHERE key = ?').get(k) || {}).value;
const conn = (gmail) => JSON.parse(db.sqlite.prepare('SELECT json FROM tabs WHERE tab = ? AND id = ?').get(TABS.connections, gmail).json);
const quiet = { list: async () => [], fetch: async () => { throw new Error('none'); } };
const down = { list: async () => { throw new Error('mail service answered 503'); }, fetch: quiet.fetch };

beforeEach(() => {
  db = localD1();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  set('mail_accounts', JSON.stringify([{ who: 'addin', gmail: 'a@example.com', owner: 'Me' }]));
  set('start_date', '2026-09-01');
  set('owner_name', 'Me');
  const row = { gmail: 'a@example.com', checkpoint: 0, last_sync: new Date(NOW - 5 * 3600000).toISOString(), last_status: 'live ok: 2026-11-12' };
  db.exec(`INSERT INTO tabs (tab, id, json) VALUES ('${TABS.connections}', 'a@example.com', '${JSON.stringify(row)}')`);
});

describe('marking a mailbox as read', () => {
  it('a quiet scan (no new bank e-mail) refreshes the time, so the mailbox is no longer "stopped"', async () => {
    expect(staleSyncs([conn('a@example.com')], new Date(NOW))).toHaveLength(1); // 5 hours old: stopped, before
    await scan(db, quiet, { now: () => NOW });
    expect(conn('a@example.com').last_sync).toBe(new Date(NOW).toISOString());
    expect(conn('a@example.com').last_status).toBe('live ok: 2026-11-13');
    expect(staleSyncs([conn('a@example.com')], new Date(NOW))).toEqual([]);
    expect(Number(get('data_stamp'))).toBe(NOW); // the open app sees the change
  });

  it('is not rewritten every minute: only when the mark is older than 20 minutes', async () => {
    await scan(db, quiet, { now: () => NOW });
    const first = conn('a@example.com').last_sync;
    await scan(db, quiet, { now: () => NOW + 5 * MIN });
    expect(conn('a@example.com').last_sync).toBe(first);
    await scan(db, quiet, { now: () => NOW + 25 * MIN });
    expect(conn('a@example.com').last_sync).toBe(new Date(NOW + 25 * MIN).toISOString());
  });

  it('a mailbox Gmail did not answer for keeps its old time (so a real stop is still reported) and says why', async () => {
    const before = conn('a@example.com').last_sync;
    await scan(db, down, { now: () => NOW });
    expect(conn('a@example.com').last_sync).toBe(before);
    expect(conn('a@example.com').last_status).toBe('ERROR: mail service answered 503');
    expect(staleSyncs([conn('a@example.com')], new Date(NOW))).toHaveLength(1);
  });

  it('after an outage, the next good scan clears the error and the "stopped" mark', async () => {
    await scan(db, down, { now: () => NOW });
    await scan(db, quiet, { now: () => NOW + 3 * MIN });
    expect(conn('a@example.com')).toMatchObject({ last_status: 'live ok: 2026-11-13', last_sync: new Date(NOW + 3 * MIN).toISOString() });
  });

  it('writes nothing for a mailbox that has no connection row', async () => {
    set('mail_accounts', JSON.stringify([{ who: 'addin', gmail: 'a@example.com', owner: 'Me' }, { who: 'dewi', gmail: 'nobody@example.com', owner: 'Dewi' }]));
    await expect(scan(db, quiet, { now: () => NOW })).resolves.toBeDefined();
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM tabs WHERE tab = ?').get(TABS.connections).n).toBe(1);
  });
});

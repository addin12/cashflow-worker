// A request reuses what the one before it loaded while nothing changed, and never when something did.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { TABS } from '../vendor/core/schema.js';
import { cuts } from '../src/app.js';
import { clearWindowCache, openUnit } from '../src/unit.js';
import { localD1 } from './d1shim.js';

const NOW = new Date('2026-11-11T03:00:00Z');
const who = () => ({ name: 'Me', email: 'a@example.com', owner: true });
const CUT = cuts(NOW).main;
let db;
const stamp = (v) => db.sqlite.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('data_stamp', ?)").run(String(v));
const open = (opts = {}, cut = CUT) => { db.newRequest(); return openUnit(db, cut, { rules: true, now: () => NOW, who, ...opts }); };
const loads = () => db.log.filter((s) => /UNION ALL SELECT id FROM transactions WHERE status/.test(s)).length; // the window query

beforeEach(() => {
  db = localD1();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(execFileSync(process.execPath, ['scripts/gen-seed.mjs', '300'], { encoding: 'utf8', cwd: new URL('..', import.meta.url), maxBuffer: 50e6 }));
  db.exec("INSERT OR REPLACE INTO config (key, value) VALUES ('known_ids', '{\"x\":[\"1\"]}'), ('scan_checked', '1')");
  stamp(1);
});

describe('the kept window', () => {
  it('the second request, whichever screen, loads nothing but the stamp', async () => {
    await open({ inbox: true });
    expect(loads()).toBe(1);
    db.newRequest(); db.resetRows();
    const before = db.log.length;
    const unit = await open({ inbox: false }); // another screen: it needs fewer tabs than were loaded
    expect(loads()).toBe(1);
    expect(db.log.slice(before)).toEqual(["SELECT value FROM config WHERE key = 'data_stamp'"]);
    expect(db.rowsRead()).toBe(1);
    expect(unit.store.read(TABS.inboxLog)).toEqual([]); // and only the tabs asked for are in the unit
  });

  it('answers exactly as an unkept load would', async () => {
    await open();
    const kept = (await open()).api.dashboard({ part: 'main' });
    clearWindowCache();
    const fresh = (await open()).api.dashboard({ part: 'main' });
    expect(JSON.stringify(kept)).toBe(JSON.stringify(fresh));
  });

  it('a change made elsewhere (another Worker instance moves data_stamp) is seen at once', async () => {
    await open();
    const id = db.sqlite.prepare("SELECT id FROM transactions WHERE status = 'approved' ORDER BY date DESC LIMIT 1").get().id;
    db.sqlite.prepare('UPDATE transactions SET amount = 123456 WHERE id = ?').run(id);
    stamp(2);
    const rows = (await open()).store.read(TABS.transactions);
    expect(rows.find((r) => r.id === id).amount).toBe(123456);
    expect(loads()).toBe(2);
  });

  it('a write through a unit empties what was kept, so the next request loads again and sees it', async () => {
    const unit = await open();
    const id = unit.store.read(TABS.transactions).find((r) => r.status === 'approved').id;
    await unit.call('update', { id, fields: { description: 'CHANGED' } });
    const again = await open();
    expect(again.store.read(TABS.transactions).find((r) => r.id === id).description).toBe('CHANGED');
    expect(loads()).toBe(2);
  });

  it('requests that arrive together (the page asks six things at once) share ONE load', async () => {
    db.newRequest();
    const units = await Promise.all([0, 1, 2, 3, 4, 5].map(() => openUnit(db, CUT, { rules: true, now: () => NOW, who })));
    expect(units).toHaveLength(6);
    expect(loads()).toBe(1);
  });

  it('a load that fails is not kept: the next request tries again', async () => {
    const real = db.batch.bind(db);
    let broken = true;
    db.batch = async (st) => { if (broken && st.length > 4) throw new Error('boom'); return real(st); };
    await expect(open()).rejects.toThrow('boom');
    broken = false;
    await expect(open()).resolves.toBeTruthy();
  });

  it('with no data_stamp nothing is kept', async () => {
    db.sqlite.prepare("DELETE FROM config WHERE key = 'data_stamp'").run();
    await open(); await open();
    expect(loads()).toBe(2);
  });

  it('another window start is its own entry, and only a few are kept', async () => {
    await open({}, cuts(NOW).bills);
    await open();
    await open({}, cuts(NOW).bills);
    expect(loads()).toBe(2);
    for (let i = 1; i <= 7; i += 1) await open({}, `${2019 + i}-01-28`);
    const before = loads();
    await open({}, cuts(NOW).bills); // the oldest was let go
    expect(loads()).toBe(before + 1);
  });

  it('the mail scan\'s own bookkeeping is not loaded by a screen', async () => {
    const cfg = (await open()).config();
    expect(Object.keys(cfg)).not.toContain('known_ids');
    expect(Object.keys(cfg)).not.toContain('scan_checked');
    expect(Object.keys(cfg)).toContain('owner_name');
  });
});

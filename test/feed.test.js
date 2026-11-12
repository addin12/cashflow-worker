import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildFeed, fold, toIcs } from '../src/feed.js';
import feedWorker from '../src/feed-worker.js';
import { localD1 } from './d1shim.js';

const NOW = new Date('2026-11-11T03:00:00Z');
const OWNER_TOKEN = 'o'.repeat(32);
const PARTNER_TOKEN = 'p'.repeat(32);
let db;
const set = (k, v) => db.sqlite.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(k, v);
const feedRow = (who) => db.sqlite.prepare("SELECT json FROM tabs WHERE tab = 'feed' AND id = ?").get(who);

beforeEach(() => {
  db = localD1();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(execFileSync(process.execPath, ['scripts/gen-seed.mjs', '300'], { encoding: 'utf8', cwd: new URL('..', import.meta.url), maxBuffer: 50e6 }));
  set('owner_email', 'a@example.com');
  set('partner_email', 'x@example.com');
  set('payday_day', '28');
  set('partner_payday_day', '25');
});

describe('toIcs', () => {
  it('writes all-day events with a 09:00-the-day-before reminder, escaped and with CRLF lines', () => {
    const ics = toIcs(['2026-11-28|💼 Gajian', '2026-12-01|Netflix, Spotify; semicolon · Rp186.000'], { stamp: NOW });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261128\r\nDTEND;VALUE=DATE:20261129');
    expect(ics).toContain('SUMMARY:Netflix\\, Spotify\\; semicolon');
    expect(ics).toContain('TRIGGER:-PT15H');
    expect(toIcs(['2026-11-28|💼 Gajian'], { stamp: NOW })).toBe(toIcs(['2026-11-28|💼 Gajian'], { stamp: NOW })); // UIDs are stable
  });
  it('folds long lines at 75 bytes without cutting a character', () => {
    const line = fold(`SUMMARY:${'💼'.repeat(40)}`);
    for (const part of line.split('\r\n')) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(line.split('\r\n ').join('')).toBe(`SUMMARY:${'💼'.repeat(40)}`);
  });
});

describe('buildFeed', () => {
  it('stores a feed per person, each with their own payday', async () => {
    expect(await buildFeed(db, 'owner', { now: () => NOW })).toBeGreaterThan(0);
    expect(await buildFeed(db, 'partner', { now: () => NOW })).toBeGreaterThan(0);
    const owner = JSON.parse(feedRow('owner').json).ics;
    const partner = JSON.parse(feedRow('partner').json).ics;
    expect(owner).toContain('DTSTART;VALUE=DATE:20261127'); // the 28th is a Saturday: paid on the Friday before
    expect(owner).toContain('Gajian');
    expect(partner).toContain('DTSTART;VALUE=DATE:20261125');
    expect(partner).not.toBe(owner);
  });
  it('rebuilding replaces the row instead of adding one', async () => {
    await buildFeed(db, 'owner', { now: () => NOW });
    await buildFeed(db, 'owner', { now: () => NOW });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM tabs WHERE tab = 'feed'").get().n).toBe(1);
  });
  it('a person who does not exist gets nothing', async () => {
    set('partner_name', '');
    expect(await buildFeed(db, 'partner', { now: () => NOW })).toBe(0);
    expect(feedRow('partner')).toBeUndefined();
  });
  it('does not read the whole history to do it', async () => {
    db.resetRows();
    await buildFeed(db, 'owner', { now: () => NOW });
    expect(db.rowsRead()).toBeLessThan(900);
  });
});

describe('the feed Worker', () => {
  const env = () => ({ DB: db, FEED_OWNER: OWNER_TOKEN, FEED_PARTNER: PARTNER_TOKEN });
  const get = (path) => feedWorker.fetch(new Request(`https://feed.example${path}`), env());
  it('serves the right person their calendar at their secret address only', async () => {
    await buildFeed(db, 'owner', { now: () => NOW });
    const ok = await get(`/${OWNER_TOKEN}.ics`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toContain('text/calendar');
    expect(await ok.text()).toContain('BEGIN:VCALENDAR');
    expect((await get(`/${'x'.repeat(32)}.ics`)).status).toBe(404);
    expect((await get('/index.ics')).status).toBe(404);
    expect((await get('/')).status).toBe(404);
    expect((await get(`/${PARTNER_TOKEN}.ics`)).status).toBe(503); // valid address, feed not built yet
  });
  it('a missing or short secret never opens anything', async () => {
    const r = await feedWorker.fetch(new Request(`https://feed.example/${'a'.repeat(32)}.ics`), { DB: db });
    expect(r.status).toBe(404);
  });
});

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '../src/app.js';
import { dueJobs, runJob } from '../src/daily.js';
import { route } from '../src/index.js';
import { acceptDevice, deliver, notifyNewRows, pushOf, targets } from '../src/push.js';
import { localD1 } from './d1shim.js';

const NOW = new Date('2026-11-11T03:00:00Z');
const key = (c) => c.repeat(90).slice(0, 87);
const SUB = (n, owner) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, keys: { p256dh: key('B'), auth: 'a'.repeat(22) }, owner, label: n });
const ENV = { PUSH_SITE: 'https://site.example/', PUSH_SECRET: 's'.repeat(24) };
let db;
let calls;
const fakeSite = (statusOf = () => 201) => async (url, init) => {
  const body = JSON.parse(init.body);
  calls.push({ url, auth: init.headers.authorization, body });
  return new Response(JSON.stringify({ results: body.subscriptions.map((s) => ({ endpoint: s.endpoint, status: statusOf(s) })) }), { status: 200 });
};
const set = (k, v) => db.sqlite.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(k, v);
const cfg = () => Object.fromEntries(db.sqlite.prepare('SELECT key, value FROM config').all().map((r) => [r.key, r.value]));
const push = (f) => ({ site: 'https://site.example', secret: ENV.PUSH_SECRET, fetch: f });

beforeEach(() => {
  calls = [];
  db = localD1();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(execFileSync(process.execPath, ['scripts/gen-seed.mjs', '300'], { encoding: 'utf8', cwd: new URL('..', import.meta.url), maxBuffer: 50e6 }));
  set('owner_email', 'a@example.com');
  set('worker_push', 'on');
  set('push_devices', JSON.stringify([SUB('me-phone', 'Me'), SUB('dewi-phone', 'Dewi')]));
});
afterEach(() => vi.unstubAllGlobals());

describe('deliver', () => {
  it('sends to the devices the notice is for, with the secret, and only to them', async () => {
    const r = await deliver(db, cfg(), push(fakeSite()), { title: 'T', body: 'B' }, { only: 'Dewi' });
    expect(r).toEqual({ sent: 1, gone: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://site.example/api/push');
    expect(calls[0].auth).toBe(`Bearer ${ENV.PUSH_SECRET}`);
    expect(calls[0].body.subscriptions.map((s) => s.endpoint)).toEqual([SUB('dewi-phone').endpoint]);
  });
  it('drops devices the push service says are gone', async () => {
    const r = await deliver(db, cfg(), push(fakeSite((s) => (s.endpoint.endsWith('me-phone') ? 410 : 201))), { title: 'T' }, {});
    expect(r).toEqual({ sent: 1, gone: 1 });
    expect(JSON.parse(cfg().push_devices).map((d) => d.label)).toEqual(['dewi-phone']);
  });
  it('a person who switched an event off does not get it', async () => {
    set('partner_push_events', 'none');
    await deliver(db, cfg(), push(fakeSite()), { title: 'T' }, { event: 'bills' });
    expect(calls[0].body.subscriptions.map((s) => s.endpoint)).toEqual([SUB('me-phone').endpoint]);
    expect(targets({ ...cfg(), push_devices: '[]' })).toEqual([]);
  });
  it('says so when the site refuses', async () => {
    await expect(deliver(db, cfg(), push(async () => new Response('no', { status: 401 })), { title: 'T' })).rejects.toThrow('HTTP 401');
  });
  it('does nothing when notifications are not set up or nobody joined', async () => {
    expect(await deliver(db, cfg(), null, { title: 'T' })).toMatchObject({ sent: 0 });
    set('push_devices', '[]');
    expect(await deliver(db, cfg(), push(fakeSite()), { title: 'T' })).toMatchObject({ sent: 0 });
    expect(calls).toHaveLength(0);
  });
  it('pushOf needs both the site and the secret', () => {
    expect(pushOf({})).toBeNull();
    expect(pushOf({ PUSH_SITE: 'https://x' })).toBeNull();
    expect(pushOf(ENV).site).toBe('https://site.example');
  });
});

describe('a phone joining', () => {
  const sub = JSON.stringify({ endpoint: 'https://fcm.googleapis.com/fcm/send/new-phone', keys: { p256dh: key('C'), auth: 'b'.repeat(22) } });
  it('is added with the right one-time code, once', async () => {
    set('push_nonce', `abc123 ${NOW.getTime()}`);
    expect(await acceptDevice(db, sub, 'abc123', 'Chrome', 'Dewi', { now: () => NOW.getTime() + 60000 })).toBe(true);
    const list = JSON.parse(cfg().push_devices);
    expect(list[0]).toMatchObject({ label: 'Chrome', owner: 'Dewi' });
    expect(list).toHaveLength(3);
    expect(cfg().push_nonce).toBe('');
    expect(await acceptDevice(db, sub, 'abc123', 'Chrome', 'Dewi', { now: () => NOW.getTime() + 61000 })).toBe(false); // the code is used up
  });
  it('is refused with a wrong or old code or an endpoint that is not a browser push service', async () => {
    set('push_nonce', `abc123 ${NOW.getTime()}`);
    expect(await acceptDevice(db, sub, 'wrong1', 'x', 'Dewi', { now: () => NOW.getTime() })).toBe(false);
    expect(await acceptDevice(db, sub, 'abc123', 'x', 'Dewi', { now: () => NOW.getTime() + 31 * 60000 })).toBe(false);
    expect(await acceptDevice(db, sub.replace('fcm.googleapis.com', 'evil.example'), 'abc123', 'x', 'Dewi', { now: () => NOW.getTime() })).toBe(false);
    expect(JSON.parse(cfg().push_devices)).toHaveLength(2);
  });
  it('through the page: ?push= adds the phone of whoever is signed in and tells the screen', async () => {
    set('push_nonce', `abc123 ${Date.now()}`);
    const env = { DB: db, ACCESS_TEAM: '', APP_TOKEN: 't'.repeat(30), ASSETS: { fetch: async () => new Response('<script>window.__INIT__=null;</script>', { headers: { 'content-type': 'text/html' } }) } };
    const url = `https://app.example/?tab=settings&n=abc123&label=Pixel&push=${encodeURIComponent(sub)}`;
    const res = await route(new Request(url, { headers: { authorization: `Bearer ${env.APP_TOKEN}` } }), env);
    const html = await res.text();
    expect(html).toContain('window.__PUSH__="ok"');
    expect(html).toContain('window.__TAB__="settings"');
    expect(JSON.parse(cfg().push_devices)[0]).toMatchObject({ label: 'Pixel', owner: 'Me' });
  });
});

describe('the app asking to send', () => {
  it('pushTest goes out after the method and answers with how many phones got it', async () => {
    vi.stubGlobal('fetch', fakeSite());
    const { result } = await run({ DB: db, ...ENV }, 'pushTest', {}, { email: '' });
    expect(result.sent).toBe(1); // the owner's own phone
    expect(calls[0].body.notification.title).toMatch(/Cashflow/);
  });
  it('without the site configured the app says notifications are not set up', async () => {
    await expect(run({ DB: db }, 'pushTest', {}, { email: '' })).rejects.toThrow('not set up');
  });
});

describe('new rows', () => {
  it('each person hears about their own rows; big spending first', async () => {
    const rows = [
      { owner: 'Me', direction: 'out', amount: 2500000, description: 'TOKO BESAR', status: 'approved', stream: 'BCA' },
      { owner: 'Dewi', direction: 'out', amount: 20000, description: 'WARUNG', status: 'approved', stream: 'GoPay' },
    ];
    await notifyNewRows(db, cfg(), push(fakeSite()), rows);
    expect(calls).toHaveLength(2);
    const a = calls.find((c) => c.body.subscriptions[0].endpoint.endsWith('me-phone'));
    expect(a.body.notification.title).toBe('Pengeluaran besar');
    expect(calls.find((c) => c.body.subscriptions[0].endpoint.endsWith('dewi-phone')).body.notification.body).toContain('WARUNG');
  });
  it('the automatic notifications stay off until cutover (worker_push), so the phones do not get everything twice', async () => {
    set('worker_push', '');
    await notifyNewRows(db, cfg(), push(fakeSite()), [{ owner: 'Me', direction: 'out', amount: 2500000, description: 'X', status: 'approved' }]);
    expect(await runJob(db, { job: 'alerts' }, { now: () => new Date('2026-11-27T01:00:00Z'), push: push(fakeSite()) })).toContain('off until cutover');
    expect(await runJob(db, { job: 'close', who: 'owner' }, { now: () => NOW, push: push(fakeSite()) })).toBe('close: off');
    expect(calls).toHaveLength(0);
  });
  it('a failing site never breaks the sync', async () => {
    await expect(notifyNewRows(db, cfg(), push(async () => { throw new Error('down'); }), [{ owner: 'Me', direction: 'out', amount: 1, description: 'x', status: 'approved' }])).resolves.toBeUndefined();
  });
});

describe('the daily jobs', () => {
  it('start once a day, in their hour only', async () => {
    const at = (h, m = 0) => Date.UTC(2026, 10, 11, h, m);
    expect(await dueJobs(db, at(5))).toEqual([]);
    expect(await dueJobs(db, at(1))).toEqual([{ job: 'plans' }, { job: 'alerts' }]);
    expect(await dueJobs(db, at(1, 1))).toEqual([]);
    expect(await dueJobs(db, Date.UTC(2026, 10, 12, 1))).toHaveLength(2); // the next day
    expect(await dueJobs(db, at(2))).toEqual([{ feed: 'owner' }, { feed: 'partner' }]);
  });
  it('the morning alerts: bills tomorrow and payday reach the phones that have them on', async () => {
    const day = (iso) => new Date(`${iso}T01:00:00Z`);
    set('payday_day', '28');
    const out = await runJob(db, { job: 'alerts' }, { now: () => day('2026-11-27'), push: push(fakeSite()) }); // the 28th is a Saturday: payday is the 27th
    expect(out).toContain('payday owner');
    expect(calls.some((c) => c.body.notification.tag === 'payday' && c.body.subscriptions.every((s) => s.endpoint.endsWith('me-phone')))).toBe(true);
  });
  it('the evening nudge goes only to who switched it on', async () => {
    set('push_events', 'new,big,bills,payday,close');
    const out = await runJob(db, { job: 'close', who: 'owner' }, { now: () => new Date('2026-11-11T14:00:00Z'), push: push(fakeSite()) });
    expect(['close: sent', 'close: not needed']).toContain(out);
    expect(await runJob(db, { job: 'close', who: 'partner' }, { now: () => NOW, push: push(fakeSite()) })).toBe('close: off');
  });
  it('planned transactions are created by the morning job', async () => {
    expect(await runJob(db, { job: 'plans' }, { now: () => NOW, push: null })).toMatch(/^plans: \d+ created$/);
  });
});

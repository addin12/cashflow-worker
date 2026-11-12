// Who may come in, which of the two people is asking, the page, the sign-in cookie and the "did anything change" check, end to end through route().
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { forgetKeys } from '../src/access.js';
import { route } from '../src/index.js';
import { localD1 } from './d1shim.js';

const TOKEN = 'app-token-0123456789-abcdefghijkl';
const TEAM = 'household';
const AUD = 'app-aud-1';
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
const json = (o) => b64url(Buffer.from(JSON.stringify(o)));
let db; let pair; let jwk;

const page = { fetch: async (req) => new Response(`PAGE ${new URL(req.url).pathname}`, { headers: { 'content-type': 'text/html' } }) };
const tokenEnv = () => ({ DB: db, APP_TOKEN: TOKEN, ASSETS: page });
const accessEnv = () => ({ DB: db, APP_TOKEN: TOKEN, ASSETS: page, ACCESS_TEAM: TEAM, ACCESS_AUD: AUD });
const req = (path, { method = 'GET', headers = {}, body } = {}) => new Request(`https://cashflow.example${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
const bearer = { authorization: `Bearer ${TOKEN}` };
async function accessToken(email, extra = {}) {
  const head = json({ alg: 'RS256', kid: 'k1' });
  const body = json({ iss: `https://${TEAM}.cloudflareaccess.com`, aud: [AUD], exp: Date.now() / 1000 + 600, email, ...extra });
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}
const asAccess = async (email, path, init = {}) => route(req(path, { ...init, headers: { 'cf-access-jwt-assertion': await accessToken(email), ...(init.headers || {}) } }), accessEnv());

beforeAll(async () => {
  pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1' };
  globalThis.fetch = async (url) => (String(url).includes('/cdn-cgi/access/certs') ? new Response(JSON.stringify({ keys: [jwk] })) : new Response('no', { status: 404 }));
});
beforeEach(() => {
  forgetKeys();
  db = localD1();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(execFileSync(process.execPath, ['scripts/gen-seed.mjs', '200'], { encoding: 'utf8', cwd: new URL('..', import.meta.url), maxBuffer: 50e6 }));
  db.exec("INSERT OR REPLACE INTO config (key, value) VALUES ('owner_email', 'me@example.com'), ('partner_email', 'dewi@example.com, dewi2@example.com'), ('partner_name', 'Dewi')");
});

describe('token mode (before Cloudflare Access is set up)', () => {
  it('lets nobody in without the token: not the page, not the API, not a wrong token', async () => {
    for (const r of [req('/'), req('/api/bootstrap', { method: 'POST', body: {} }), req('/api/bootstrap', { method: 'POST', headers: { authorization: 'Bearer wrong-wrong-wrong-wrong-wrong-wrong' }, body: {} }), req('/dashboard')]) {
      expect((await route(r, tokenEnv())).status).toBe(401);
    }
  });
  it('a missing or short secret lets nobody in, whatever is sent', async () => {
    expect((await route(req('/api/bootstrap', { method: 'POST', headers: { authorization: 'Bearer short' }, body: {} }), { ...tokenEnv(), APP_TOKEN: 'short' })).status).toBe(401);
    expect((await route(req('/api/bootstrap', { method: 'POST', headers: { authorization: 'Bearer ' }, body: {} }), { ...tokenEnv(), APP_TOKEN: undefined })).status).toBe(401);
  });
  it('with the token it is the owner who asks, and the page is served', async () => {
    const res = await route(req('/api/bootstrap', { method: 'POST', headers: bearer, body: {} }), tokenEnv());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ me: 'Me' });
    const home = await route(req('/', { headers: bearer }), tokenEnv());
    expect(await home.text()).toBe('PAGE /index.html');
  });
  it('/login keeps the token in a cookie (and only for the right token), and the cookie opens the page and the API', async () => {
    expect((await route(req('/login?token=nope'), tokenEnv())).status).toBe(401);
    const ok = await route(req(`/login?token=${TOKEN}`), tokenEnv());
    expect(ok.status).toBe(302);
    const cookie = ok.headers.get('set-cookie');
    expect(cookie).toMatch(/HttpOnly; Secure; SameSite=Strict/);
    const sent = { cookie: cookie.split(';')[0] };
    expect(await (await route(req('/', { headers: sent }), tokenEnv())).text()).toBe('PAGE /index.html');
    expect((await route(req('/api/stamp', { method: 'POST', headers: sent, body: {} }), tokenEnv())).status).toBe(200);
    expect((await route(req('/api/stamp', { method: 'POST', headers: { cookie: 'app_token=wrong' }, body: {} }), tokenEnv())).status).toBe(401);
  });
});

describe('Cloudflare Access mode', () => {
  it('only a valid Access token comes in: the bearer token, no token and a forged token are all refused', async () => {
    expect((await route(req('/api/bootstrap', { method: 'POST', headers: bearer, body: {} }), accessEnv())).status).toBe(401);
    expect((await route(req('/api/bootstrap', { method: 'POST', body: {} }), accessEnv())).status).toBe(401);
    expect((await route(req('/api/bootstrap', { method: 'POST', headers: { 'cf-access-jwt-assertion': 'a.b.c' }, body: {} }), accessEnv())).status).toBe(401);
    expect((await route(req('/login?token=' + TOKEN), accessEnv())).status).toBe(401); // no cookie login behind Access
  });
  it('each of the two people is who they are: the owner\'s address gives the owner, either of the partner\'s gives the partner', async () => {
    const owner = await (await asAccess('Me@Example.com', '/api/bootstrap', { method: 'POST', body: {} })).json();
    expect(owner.data).toMatchObject({ me: 'Me' });
    const partner = await (await asAccess('dewi2@example.com', '/api/bootstrap', { method: 'POST', body: {} })).json();
    expect(partner.data).toMatchObject({ me: 'Dewi' });
  });
  it('a Google account that is neither of them is refused, however well signed in', async () => {
    const res = await asAccess('stranger@example.com', '/api/bootstrap', { method: 'POST', body: {} });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('not part of the household');
  });
  it('what the partner saves is saved as the partner', async () => {
    const res = await asAccess('dewi@example.com', '/api/add', { method: 'POST', body: { kind: 'out', amount: 12000, date: '2026-11-10', stream: 'GoPay', category: 'Food & Beverages', description: 'TEH TEST' } });
    expect(res.status).toBe(200);
    expect(db.sqlite.prepare("SELECT updated_by FROM transactions WHERE description = 'TEH TEST'").get()).toEqual({ updated_by: 'Dewi' });
  });
  it('serves the page to the two of them', async () => {
    expect(await (await asAccess('me@example.com', '/')).text()).toBe('PAGE /index.html');
  });
  it('the install files (manifest, icons) come with the same sign-in, and nothing else is served as a file', async () => {
    expect(await (await asAccess('me@example.com', '/manifest.webmanifest')).text()).toBe('PAGE /manifest.webmanifest');
    expect(await (await asAccess('dewi@example.com', '/icon-192.png')).text()).toBe('PAGE /icon-192.png');
    expect((await route(req('/manifest.webmanifest'), accessEnv())).status).toBe(401);
    expect((await asAccess('me@example.com', '/secrets.json')).status).toBe(404);
  });
  it('/backup.csv gives every transaction to the two of them and nobody else', async () => {
    const res = await asAccess('dewi@example.com', '/backup.csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const lines = (await res.text()).trim().split('\n');
    expect(lines.length).toBe(1 + db.sqlite.prepare('SELECT COUNT(*) AS n FROM transactions').get().n);
    expect(lines[0]).toContain('id');
    expect((await asAccess('stranger@example.com', '/backup.csv')).status).toBe(403);
    expect((await route(req('/backup.csv'), accessEnv())).status).toBe(401);
  });
});

describe('the API', () => {
  it('an unknown method is 404, a method that fails is a short message with a 500, and nothing is written by the failed one', async () => {
    expect((await route(req('/api/dropEverything', { method: 'POST', headers: bearer, body: {} }), tokenEnv())).status).toBe(404);
    const before = db.sqlite.prepare('SELECT COUNT(*) AS n FROM transactions').get().n;
    const res = await route(req('/api/approve', { method: 'POST', headers: bearer, body: { id: 'does-not-exist', category: 'Hobi' } }), tokenEnv());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/not found/);
    expect(body.error.length).toBeLessThan(300);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM transactions').get().n).toBe(before);
  });
  it('"did anything change?": zero before any write, the time of the last write after one, and when the mail was last looked at', async () => {
    const ask = async () => (await (await route(req('/api/stamp', { method: 'POST', headers: bearer, body: {} }), tokenEnv())).json()).data;
    expect(await ask()).toEqual({ stamp: 0, checked: null, today: 0 });
    const out = await route(req('/api/add', { method: 'POST', headers: bearer, body: { kind: 'out', amount: 5000, date: '2026-11-10', stream: 'BCA', category: 'Food & Beverages', description: 'PERMEN' } }), tokenEnv());
    expect(out.status).toBe(200);
    const s = await ask();
    expect(s.stamp).toBeGreaterThan(Date.now() - 60000);
    db.exec("INSERT OR REPLACE INTO config (key, value) VALUES ('scan_checked', '1793000000000')");
    expect((await ask()).checked).toBe(1793000000000);
  });
  it('reading screens by GET works with the token, and answers with the same data as POST', async () => {
    const get = await (await route(req('/dashboard?part=main', { headers: bearer }), tokenEnv())).json();
    const post = (await (await route(req('/api/dashboard', { method: 'POST', headers: bearer, body: { part: 'main' } }), tokenEnv())).json()).data;
    expect(get).toEqual(post);
    expect(Object.keys(get)).toContain('summary');
  });
});

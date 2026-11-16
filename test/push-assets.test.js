// Notifications join at the app's own address: the page, its service worker and the install page are served by the Worker (behind the same sign-in), and the page
// says the right thing for every iPhone situation (an iPhone only allows web notifications from the installed app itself).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { route } from '../src/index.js';
import { afterAsk, stateOf } from '../assets-src/notifikasi-state.js';

const TOKEN = 't'.repeat(32);
const served = [];
const env = {
  APP_TOKEN: TOKEN, DB: null,
  ASSETS: { fetch: async (req) => { const p = new URL(req.url).pathname; served.push(p); return new Response(p === '/index.html' ? '<script>window.__INIT__=null;</script>' : `asset ${p}`, { headers: { 'content-type': 'text/plain' } }); } },
};
const get = (path, auth = true) => route(new Request(`https://app.example${path}`, { headers: auth ? { authorization: `Bearer ${TOKEN}` } : {} }), env);
const read = (f) => readFileSync(new URL(`../assets-src/${f}`, import.meta.url), 'utf8');

describe('the files', () => {
  it('are served to someone signed in, and refused to anyone else', async () => {
    for (const p of ['/sw.js', '/notifikasi', '/notifikasi.js', '/notifikasi-state.js', '/pasang', '/pasang.js', '/site.css', '/badge-96.png']) {
      served.length = 0;
      const res = await get(p);
      expect(res.status, p).toBe(200);
      expect(served, p).toEqual([p]);
      expect((await get(p, false)).status, `${p} without sign-in`).toBe(401);
    }
  });
  it('the service worker is never cached for long, so a new one is picked up at the next visit', async () => { expect((await get('/sw.js')).headers.get('cache-control')).toBe('no-cache'); });
  it('the short links open their screen at the app\'s own address (also what a notification opens)', async () => {
    for (const [path, tab] of [['/cek', 'review'], ['/tambah', 'add'], ['/ringkasan', 'dashboard'], ['/transaksi', 'transactions'], ['/pengaturan', 'settings']]) {
      served.length = 0;
      const res = await get(path);
      expect(served, path).toEqual(['/index.html']);
      expect(res.status).toBe(200);
      expect(await res.text(), path).toContain(`window.__TAB__=${JSON.stringify(tab)}`);
    }
  });
  it('nothing in them points at another address (that is what made the iPhone refuse)', () => {
    for (const f of ['notifikasi.js', 'notifikasi.html', 'pasang.html', 'pasang.js', 'sw.js']) expect(read(f), f).not.toMatch(/karjimut|vercel|https?:\/\/[a-z0-9-]+\.workers\.dev/);
    expect(read('notifikasi.js')).toContain("location.replace(`/?${q}`)");
  });
});

describe('what the notification page says', () => {
  const base = { code: 'abc123', ios: false, installed: false, supported: true, permission: 'default' };
  it('without the code from the app it was not opened from the app', () => { expect(stateOf({ ...base, code: '' }).kind).toBe('nocode'); });
  it('on an iPhone outside the installed app: how to install it (no permission button)', () => { expect(stateOf({ ...base, ios: true, installed: false }).kind).toBe('ios-install'); });
  it('on an iPhone in the installed app: ready, or told that notifications are switched off for it', () => {
    expect(stateOf({ ...base, ios: true, installed: true }).kind).toBe('ready');
    expect(stateOf({ ...base, ios: true, installed: true, permission: 'denied' })).toEqual({ kind: 'denied', ios: true });
  });
  it('a browser without push says so; elsewhere a refused permission points at the browser settings', () => {
    expect(stateOf({ ...base, supported: false })).toEqual({ kind: 'unsupported', ios: false });
    expect(stateOf({ ...base, permission: 'denied' })).toEqual({ kind: 'denied', ios: false });
    expect(stateOf(base).kind).toBe('ready');
  });
  it('after the person answers', () => {
    expect(afterAsk('granted', true)).toEqual({ kind: 'granted' });
    expect(afterAsk('denied', true)).toEqual({ kind: 'denied', ios: true });
    expect(afterAsk('default', false)).toEqual({ kind: 'denied', ios: false });
  });
});

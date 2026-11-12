// Defences of the live app: no request started by another site may change data, and every answer carries the anti-framing and no-sniff headers.
import { describe, expect, it } from 'vitest';
import worker, { crossSite, hardened, route } from '../src/index.js';

const TOKEN = 't'.repeat(32);
const env = { APP_TOKEN: TOKEN, DB: null, ASSETS: { fetch: async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }) } };
const post = (headers = {}) => new Request('https://app.example/api/pushTest', { method: 'POST', body: '{}', headers: { authorization: `Bearer ${TOKEN}`, ...headers } });

describe('crossSite', () => {
  const req = (h) => new Request('https://app.example/api/x', { method: 'POST', headers: h });
  it('refuses what a browser says came from another site, or from another origin', () => {
    expect(crossSite(req({ 'sec-fetch-site': 'cross-site' }))).toBe(true);
    expect(crossSite(req({ 'sec-fetch-site': 'same-site' }))).toBe(true); // a sibling subdomain is not the app either
    expect(crossSite(req({ origin: 'https://evil.example' }))).toBe(true);
  });
  it('lets the app\'s own pages, and callers that are not browsers, through', () => {
    expect(crossSite(req({ 'sec-fetch-site': 'same-origin', origin: 'https://app.example' }))).toBe(false);
    expect(crossSite(req({ 'sec-fetch-site': 'none' }))).toBe(false);
    expect(crossSite(req({}))).toBe(false);
  });
});

describe('the app\'s API', () => {
  it('answers 403 to a POST that another site started, before touching any data', async () => {
    const res = await route(post({ 'sec-fetch-site': 'cross-site' }), env);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/cross-site/);
  });
  it('still reaches the method for the app\'s own request (it fails only because this test has no database)', async () => {
    const res = await route(post({ 'sec-fetch-site': 'same-origin' }), env);
    expect(res.status).not.toBe(403);
  });
  it('a page of another site can still send the person back with a GET (the phone joining notifications is a cross-site navigation)', async () => {
    const res = await route(new Request('https://app.example/?tab=settings', { headers: { authorization: `Bearer ${TOKEN}`, 'sec-fetch-site': 'cross-site' } }), env);
    expect(res.status).toBe(200);
  });
});

describe('every answer', () => {
  it('carries the hardening headers, also the refusals', async () => {
    for (const res of [await worker.fetch(new Request('https://app.example/'), env), await worker.fetch(new Request('https://app.example/', { headers: { authorization: `Bearer ${TOKEN}` } }), env)]) {
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
      expect(res.headers.get('permissions-policy')).toContain('camera=()');
    }
  });
  it('keeps status and body', async () => {
    const out = hardened(new Response('x', { status: 418, headers: { 'content-type': 'text/plain' } }));
    expect(out.status).toBe(418);
    expect(await out.text()).toBe('x');
  });
});

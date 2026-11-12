// The Cloudflare Access token check, with keys made here: it lets the right token in and nothing else.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { forgetKeys, verifyAccess } from '../src/access.js';

const TEAM = 'household';
const AUD = 'app-aud-tag-123';
const NOW = Date.parse('2026-11-11T05:00:00Z');
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
const json = (o) => b64url(Buffer.from(JSON.stringify(o)));
let pair; let other; let jwk; let calls;

async function sign(payload, { header = { alg: 'RS256', kid: 'k1' }, key = pair.privateKey } = {}) {
  const body = `${json(header)}.${json(payload)}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(body));
  return `${body}.${b64url(new Uint8Array(sig))}`;
}
const good = (extra = {}) => ({ iss: `https://${TEAM}.cloudflareaccess.com`, aud: [AUD], exp: NOW / 1000 + 600, email: 'Dewi@Example.com', ...extra });
const fetchImpl = async (url) => { calls.push(String(url)); return { ok: true, status: 200, json: async () => ({ keys: [{ ...jwk, kid: 'k1' }] }) }; };
const verify = (token, opts = {}) => verifyAccess(token, { team: TEAM, aud: AUD }, { fetchImpl, now: () => NOW, ...opts });

beforeAll(async () => {
  const make = () => crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  pair = await make();
  other = await make();
  jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
});
beforeEach(() => { forgetKeys(); calls = []; });

describe('verifyAccess', () => {
  it('returns the email (lower case) for a token signed by the team, for this application, not expired', async () => {
    expect(await verify(await sign(good()))).toBe('dewi@example.com');
  });
  it('an audience as a single string works too', async () => {
    expect(await verify(await sign(good({ aud: AUD })))).toBe('dewi@example.com');
  });
  it('refuses another application\'s token, another team, an expired one', async () => {
    expect(await verify(await sign(good({ aud: ['someone-else'] })))).toBeNull();
    expect(await verify(await sign(good({ iss: 'https://other.cloudflareaccess.com' })))).toBeNull();
    expect(await verify(await sign(good({ exp: NOW / 1000 - 1 })))).toBeNull();
  });
  it('refuses a token signed with another key, a changed payload, and an algorithm that is not RS256', async () => {
    expect(await verify(await sign(good(), { key: other.privateKey }))).toBeNull();
    const t = await sign(good());
    const [h, , s] = t.split('.');
    expect(await verify(`${h}.${json(good({ email: 'attacker@example.com' }))}.${s}`)).toBeNull();
    expect(await verify(`${json({ alg: 'none', kid: 'k1' })}.${json(good())}.`)).toBeNull();
    expect(await verify(await sign(good(), { header: { alg: 'HS256', kid: 'k1' } }))).toBeNull();
  });
  it('refuses a missing, malformed or email-less token, and a key id the team does not publish', async () => {
    for (const t of [undefined, '', 'abc', 'a.b', 'a.b.c', '....']) expect(await verify(t)).toBeNull();
    expect(await verify(await sign(good({ email: '' })))).toBeNull();
    expect(await verify(await sign(good(), { header: { alg: 'RS256', kid: 'unknown' } }))).toBeNull();
  });
  it('without a team or application set up it lets nobody in', async () => {
    expect(await verifyAccess(await sign(good()), { team: '', aud: AUD }, { fetchImpl, now: () => NOW })).toBeNull();
    expect(await verifyAccess(await sign(good()), { team: TEAM, aud: '' }, { fetchImpl, now: () => NOW })).toBeNull();
  });
  it('keeps the team\'s keys for an hour (one fetch), looks again once for a key it does not know, and survives a keys outage', async () => {
    const t = await sign(good());
    await verify(t); await verify(t); await verify(t);
    expect(calls).toHaveLength(1);
    forgetKeys(); calls = [];
    await verify(await sign(good(), { header: { alg: 'RS256', kid: 'rotated' } }));
    expect(calls).toHaveLength(2); // the cached list had no such key: one more look, then no
    forgetKeys();
    expect(await verifyAccess(t, { team: TEAM, aud: AUD }, { fetchImpl: async () => ({ ok: false, status: 500 }), now: () => NOW })).toBeNull();
  });
});

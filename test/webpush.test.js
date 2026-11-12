// Web Push without a library: the message is encrypted the way RFC 8291 says (checked against the RFC's own example and against Node's own crypto),
// and signed with the app's key (VAPID, checked by verifying the signature).
import { createDecipheriv, createECDH, createPublicKey, createVerify, hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { allowedEndpoint, b64u, encrypt, payloadOf, sendOne, unb64u, vapidHeader } from '../src/webpush.js';

// RFC 8291, section 5 and appendix A.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

const importPair = async (priv, pub) => {
  const raw = unb64u(pub);
  const jwk = { kty: 'EC', crv: 'P-256', x: b64u(raw.slice(1, 33)), y: b64u(raw.slice(33)), d: priv };
  return {
    privateKey: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']),
    publicKey: await crypto.subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, true, []),
  };
};

describe('encrypt', () => {
  it('gives the exact bytes of the RFC 8291 example', async () => {
    const body = await encrypt(RFC.plaintext, { p256dh: RFC.uaPublic, auth: RFC.auth }, { ephemeral: await importPair(RFC.asPrivate, RFC.asPublic), salt: unb64u(RFC.salt) });
    expect(b64u(body)).toBe(RFC.body);
  });
  it('can be opened by the phone (Node\'s own crypto), and is different every time', async () => {
    const phone = createECDH('prime256v1');
    phone.generateKeys();
    const auth = Buffer.from('0123456789abcdef');
    const sub = { p256dh: b64u(phone.getPublicKey()), auth: b64u(auth) };
    const a = Buffer.from(await encrypt('hello, dompet', sub));
    const b = Buffer.from(await encrypt('hello, dompet', sub));
    expect(a.equals(b)).toBe(false);
    const salt = a.subarray(0, 16);
    const idlen = a[20];
    const senderPublic = a.subarray(21, 21 + idlen);
    const sealed = a.subarray(21 + idlen);
    const ikm = Buffer.from(hkdfSync('sha256', phone.computeSecret(senderPublic), auth, Buffer.concat([Buffer.from('WebPush: info\0'), phone.getPublicKey(), senderPublic]), 32));
    const cek = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: aes128gcm\0', 16));
    const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: nonce\0', 12));
    const d = createDecipheriv('aes-128-gcm', cek, nonce);
    d.setAuthTag(sealed.subarray(sealed.length - 16));
    const plain = Buffer.concat([d.update(sealed.subarray(0, sealed.length - 16)), d.final()]);
    expect(plain.toString()).toBe('hello, dompet\u0002'); // the message and the "last record" marker
  });
});

describe('vapidHeader', () => {
  it('is a signed token for the push service\'s own address that the app\'s public key verifies', async () => {
    const ec = createECDH('prime256v1');
    ec.generateKeys();
    const publicKey = b64u(ec.getPublicKey());
    const header = await vapidHeader('https://fcm.googleapis.com/fcm/send/abc', { subject: 'https://site.example', publicKey, privateKey: b64u(ec.getPrivateKey()) }, 1_000_000);
    const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header);
    expect(k).toBe(publicKey);
    const [h, c, sig] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url'))).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(Buffer.from(c, 'base64url'))).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1000 + 12 * 3600, sub: 'https://site.example' });
    const pub = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(ec.getPublicKey().subarray(1, 33)), y: b64u(ec.getPublicKey().subarray(33)) }, format: 'jwk' });
    const ok = createVerify('SHA256').update(`${h}.${c}`).verify({ key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
    expect(ok).toBe(true);
  });
});

describe('sendOne', () => {
  const vapid = async () => {
    const ec = createECDH('prime256v1');
    ec.generateKeys();
    return { subject: 'https://site.example', publicKey: b64u(ec.getPublicKey()), privateKey: b64u(ec.getPrivateKey()) };
  };
  const phone = () => { const e = createECDH('prime256v1'); e.generateKeys(); return { endpoint: 'https://fcm.googleapis.com/fcm/send/xyz', keys: { p256dh: b64u(e.getPublicKey()), auth: b64u(Buffer.from('0123456789abcdef')) } }; };
  it('posts the encrypted notice to the phone\'s push service and returns its status', async () => {
    let seen;
    const status = await sendOne(phone(), { title: 'T', body: 'B' }, await vapid(), { fetchImpl: async (url, init) => { seen = { url, init }; return new Response('', { status: 201 }); } });
    expect(status).toBe(201);
    expect(seen.url).toBe('https://fcm.googleapis.com/fcm/send/xyz');
    expect(seen.init.headers['content-encoding']).toBe('aes128gcm');
    expect(seen.init.headers.ttl).toBe('86400');
    expect(seen.init.body.length).toBeGreaterThan(80);
  });
  it('hands back 410 so the phone can be dropped, and 0 when the push service cannot be reached', async () => {
    expect(await sendOne(phone(), { title: 'T' }, await vapid(), { fetchImpl: async () => new Response('', { status: 410 }) })).toBe(410);
    expect(await sendOne(phone(), { title: 'T' }, await vapid(), { fetchImpl: async () => { throw new Error('down'); } })).toBe(0);
  });
  it('never calls an address that is not a browser push service', async () => {
    let called = false;
    const sub = { ...phone(), endpoint: 'https://evil.example/fcm.googleapis.com/' };
    expect(allowedEndpoint(sub.endpoint)).toBe(false);
    expect(await sendOne(sub, { title: 'T' }, await vapid(), { fetchImpl: async () => { called = true; return new Response(''); } })).toBe(0);
    expect(called).toBe(false);
  });
});

describe('payloadOf', () => {
  it('cuts long texts and only allows a path inside the app\'s own site', () => {
    const p = JSON.parse(payloadOf({ title: 't'.repeat(300), body: 'b'.repeat(900), tag: 'x'.repeat(99), url: 'https://evil.example/' }));
    expect([p.title.length, p.body.length, p.tag.length, p.url]).toEqual([100, 500, 40, '/']);
    expect(JSON.parse(payloadOf({ title: 'T', url: '/?tab=review' })).url).toBe('/?tab=review');
    expect(JSON.parse(payloadOf({ title: 'T', url: '//evil.example' })).url).toBe('/');
  });
});

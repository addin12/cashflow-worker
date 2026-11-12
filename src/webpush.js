// Web Push from the Worker itself: the message is encrypted (RFC 8291, aes128gcm) and signed (VAPID, RFC 8292) with the platform's WebCrypto, no library.
// It replaces a small relay function that used to run on the app's old site.
const text = new TextEncoder();

/** The push services of the browsers; a stored endpoint anywhere else is never called. */
const PUSH_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(fcm\.googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com)\//i;
export const allowedEndpoint = (e) => typeof e === 'string' && e.length <= 1000 && PUSH_HOSTS.test(e);

export const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (String(s).length % 4)) % 4)), (c) => c.charCodeAt(0));
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; parts.forEach((p) => { out.set(p, at); at += p.length; }); return out; };

const hkdf = async (ikm, salt, info, bytes) => new Uint8Array(await crypto.subtle.deriveBits(
  { name: 'HKDF', hash: 'SHA-256', salt, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), bytes * 8));

/**
 * The body of the push request: salt, record size, sender key, then the encrypted message. `ephemeral` (a key pair) and `salt` are only for tests
 * (the RFC's own example); in use both are fresh every time.
 */
export async function encrypt(message, { p256dh, auth }, { ephemeral, salt } = {}) {
  const phone = unb64u(p256dh);
  const pair = ephemeral || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const mine = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const theirs = await crypto.subtle.importKey('raw', phone, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: theirs }, pair.privateKey, 256));
  const ikm = await hkdf(shared, unb64u(auth), cat(text.encode('WebPush: info\0'), phone, mine), 32);
  const s = salt || crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', await hkdf(ikm, s, text.encode('Content-Encoding: aes128gcm\0'), 16), 'AES-GCM', false, ['encrypt']);
  const iv = await hkdf(ikm, s, text.encode('Content-Encoding: nonce\0'), 12);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, cat(text.encode(message), new Uint8Array([2])))); // 2 = the last (only) record
  return cat(s, new Uint8Array([0, 0, 0x10, 0, mine.length]), mine, sealed); // record size 4096
}

/** The Authorization header that proves the message comes from the holder of the app's key. */
export async function vapidHeader(endpoint, { subject, publicKey, privateKey }, nowMs = Date.now()) {
  const pub = unb64u(publicKey);
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33)), d: privateKey }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const part = (o) => b64u(text.encode(JSON.stringify(o)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: subject })}`;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, text.encode(unsigned)));
  return `vapid t=${unsigned}.${b64u(signature)}, k=${publicKey}`;
}

const cut = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
/** What the phone's service worker receives: title, body, tag and a path inside the app's site. */
export const payloadOf = (n) => {
  const url = cut(n.url, 200);
  return JSON.stringify({ title: cut(n.title, 100), body: cut(n.body, 500), tag: cut(n.tag, 40), url: /^\/(?!\/)/.test(url) ? url : '/' });
};

/** Sends one notice to one phone; the answer is the push service's HTTP status (0: not sent). 404 and 410 mean the phone is gone. */
export async function sendOne(sub, notice, vapid, { fetchImpl = (...a) => fetch(...a), now = Date.now } = {}) {
  if (!allowedEndpoint(sub.endpoint) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return 0;
  try {
    const res = await fetchImpl(sub.endpoint, {
      method: 'POST',
      headers: { authorization: await vapidHeader(sub.endpoint, vapid, now()), 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: '86400' },
      body: await encrypt(payloadOf(notice), sub.keys),
    });
    return res.status;
  } catch (e) { return 0; }
}

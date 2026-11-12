// Cloudflare Access puts a signed token (RS256 JWT) on every request it lets through. This checks that token and returns the signed-in email,
// or null: signature against the team's published keys, the issuer (the team), the audience (this application) and the expiry.

const enc = new TextEncoder();
const keysCache = new Map(); // team -> { keys, until }

const b64urlBytes = (s) => { const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); };
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

async function teamKeys(team, fetchImpl, now) {
  const hit = keysCache.get(team);
  if (hit && hit.until > now()) return hit.keys;
  const res = await fetchImpl(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access keys answered ${res.status}`);
  const keys = (await res.json()).keys || [];
  keysCache.set(team, { keys, until: now() + 3600000 });
  return keys;
}
export const forgetKeys = () => keysCache.clear();

/** @returns {Promise<string|null>} the email of the signed-in person, or null when the token is missing, expired, forged or for another application */
export async function verifyAccess(token, { team, aud }, { fetchImpl = fetch, now = Date.now } = {}) {
  try {
    if (!token || !team || !aud) return null;
    const [h, p, sig] = String(token).split('.');
    if (!h || !p || !sig) return null;
    const header = b64urlJson(h);
    if (header.alg !== 'RS256') return null; // never "none", never a shared-secret algorithm
    const payload = b64urlJson(p);
    if (payload.iss !== `https://${team}.cloudflareaccess.com`) return null;
    if (!(Array.isArray(payload.aud) ? payload.aud : [payload.aud]).includes(aud)) return null;
    if (!(Number(payload.exp) * 1000 > now())) return null;
    let jwk = (await teamKeys(team, fetchImpl, now)).find((k) => k.kid === header.kid);
    if (!jwk) { keysCache.delete(team); jwk = (await teamKeys(team, fetchImpl, now)).find((k) => k.kid === header.kid); } // keys rotate: look once more
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(sig), enc.encode(`${h}.${p}`));
    return valid && typeof payload.email === 'string' && payload.email ? payload.email.toLowerCase() : null;
  } catch { return null; }
}

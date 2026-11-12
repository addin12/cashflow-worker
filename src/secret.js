const enc = new TextEncoder();

/** Compares a presented secret with the real one without leaking where they differ (both are hashed first, so length does not leak either). */
export async function sameSecret(presented, secret) {
  if (!secret || secret.length < 20) return false; // a missing or weak secret never lets anyone in
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(String(presented || ''))), crypto.subtle.digest('SHA-256', enc.encode(secret))]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = presented ? 0 : 1;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}

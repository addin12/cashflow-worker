// Which of the two people is asking. The household is in Config: owner_name / owner_email and partner_name / partner_email
// (an address list is comma separated). Anyone else, however well signed in, is refused.

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const list = (v) => String(v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/** The person an email belongs to, or null. */
export function personOf(cfg, email) {
  const e = String(email || '').toLowerCase();
  if (e && list(cfg.owner_email).includes(e)) return { name: cfg.owner_name, email: e, owner: true };
  if (e && cfg.partner_name && list(cfg.partner_email).includes(e)) return { name: cfg.partner_name, email: e, owner: false };
  return null;
}

/**
 * The person for a request. With an email (Cloudflare Access said who signed in) it must be one of the two. Without (the token mode used
 * before Access is set up: whoever has the token) it is the owner.
 */
export function personFor(cfg, email) {
  if (email) {
    const p = personOf(cfg, email);
    if (!p) throw new HttpError(403, 'this Google account is not part of the household');
    return p;
  }
  return { name: cfg.owner_name, email: list(cfg.owner_email)[0] || '', owner: true };
}

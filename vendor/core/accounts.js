// Which of the owner's streams (Accounts tab rows) an email refers to.
//
// Accounts.match_hint is a comma-separated list of what identifies the account in emails:
// account numbers or their last digits ("1234567856", "56"), card last 4 ("1111"), and for
// pockets "Kantong <name>" / "Pocket <name>".

import { knownInstitution } from './parsers/common.js';

const POCKET = /^(kantong|pocket)\s+/i;

function hintsOf(account) {
  return String(account.match_hint || '').split(',').map((h) => h.trim()).filter(Boolean);
}

const isPocketAccount = (a) => hintsOf(a).some((h) => POCKET.test(h));
const institutionKey = (s) => (knownInstitution(s) || String(s || '').trim()).toLowerCase();

/** Digit strings refer to the same account when one ends with the other (masked numbers). */
export function digitsMatch(a, b, minLength = 2) {
  const x = String(a || '').replace(/\D/g, '');
  const y = String(b || '').replace(/\D/g, '');
  if (Math.min(x.length, y.length) < minLength) return false;
  return x.endsWith(y) || y.endsWith(x);
}

/**
 * @param {{institution: string, hint?: string, pocket?: string}} ref
 * @param {object[]} accounts  Accounts tab rows
 * @param {{strict?: boolean, minDigits?: number}} opts
 *   strict: only a hint/pocket match counts (no "the only account at that bank" fallback)
 * @returns {string} stream name, or '' when unknown
 */
export function resolveAccount(ref, accounts, { strict = false, minDigits = 2 } = {}) {
  if (!ref || !ref.institution) return '';
  const inst = institutionKey(ref.institution);
  const same = accounts.filter((a) => institutionKey(a.institution) === inst);
  if (!same.length) return '';
  if (ref.pocket) {
    const p = ref.pocket.trim().toLowerCase();
    const hit = same.find((a) => hintsOf(a).some((h) => POCKET.test(h) && h.replace(POCKET, '').trim().toLowerCase() === p));
    if (hit) return hit.stream;
    // A pocket the app doesn't track separately (e.g. BCA pockets) belongs to the main account.
  }
  if (ref.hint) {
    const hit = same.find((a) => !isPocketAccount(a) && hintsOf(a).some((h) => digitsMatch(h, ref.hint, minDigits)));
    if (hit) return hit.stream;
    if (strict) return '';
  } else if (strict && !ref.pocket) {
    return '';
  }
  const main = same.filter((a) => !isPocketAccount(a));
  return main.length === 1 ? main[0].stream : '';
}

const normName = (s) => String(s || '').toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Banks print the owner's name in full or truncated ("M BUDI SANTOSO PUT"). */
export function isOwnerName(name, ownerNames) {
  const n = normName(name);
  if (n.length < 3) return false;
  return (ownerNames || []).some((raw) => {
    const o = normName(raw);
    return n === o || (n.length >= 10 && o.startsWith(n)) || (o.length >= 10 && n.startsWith(o));
  });
}

/**
 * Is the event's counterparty one of the owner's own accounts?
 * @returns {{own: boolean, stream: string, why: string}}
 */
export function ownCounterparty(ev, accounts, ownerNames) {
  const cp = ev.counterparty || {};
  const pocketMove = ev.account?.pocket || cp.pocket;
  const ownSide = cp.pocket || !cp.name || cp.name === cp.institution || isOwnerName(cp.name, ownerNames);
  if (pocketMove && ownSide && cp.institution && cp.institution === ev.account?.institution) {
    return { own: true, stream: resolveAccount(cp, accounts), why: 'pocket' };
  }
  if (cp.institution && cp.account) {
    // A real account number: needs at least 4 matching digits to call it the owner's.
    const stream = resolveAccount({ institution: cp.institution, hint: cp.account }, accounts, { strict: true, minDigits: 4 });
    if (stream) return { own: true, stream, why: 'account number' };
  }
  if (isOwnerName(cp.name, ownerNames)) {
    return { own: true, stream: resolveAccount({ institution: cp.institution, hint: cp.account }, accounts), why: 'owner name' };
  }
  if (ev.type === 'topup' && cp.institution) {
    const stream = resolveAccount({ institution: cp.institution, hint: cp.account }, accounts);
    if (stream) return { own: true, stream, why: 'own wallet' };
  }
  return { own: false, stream: '', why: '' };
}

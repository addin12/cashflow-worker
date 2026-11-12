// A transfer between a person's own accounts has two sides. When only one side carries the transfer's id and exactly one
// other row looks like the other side, the person is asked to link them (never done on its own: it changes what counts as spending).

import { knownInstitution } from './parsers/common.js';

const DAY = 86400000;
const dayNumber = (date) => { const [y, m, d] = String(date).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY; };

/**
 * @param {object[]} rows  every transaction row
 * @returns {{id: string, withId: string, amount: number, date: string, stream: string, withStream: string}[]}
 *   one entry per transfer side that has exactly one matching row on another account of the same owner, opposite direction,
 *   same amount, within a day, not yet linked and not ignored
 */
export function linkableTransfers(rows) {
  const sides = new Map();
  for (const r of rows) if (r.transfer_id) sides.set(r.transfer_id, (sides.get(r.transfer_id) || 0) + 1);
  const free = rows.filter((r) => !r.transfer_id && r.status !== 'ignored' && r.status !== 'waiting');
  const out = [];
  for (const lone of rows) {
    if (!lone.transfer_id || sides.get(lone.transfer_id) !== 1 || lone.status === 'ignored') continue;
    const candidates = free.filter((c) => c.direction !== lone.direction && Number(c.amount) === Number(lone.amount) && c.owner === lone.owner
      && c.stream !== lone.stream && Math.abs(dayNumber(c.date) - dayNumber(lone.date)) <= 1);
    if (candidates.length === 1) out.push({ id: lone.id, withId: candidates[0].id, amount: Number(lone.amount), date: String(lone.date).slice(0, 10), stream: lone.stream, withStream: candidates[0].stream });
  }
  return out;
}

const institutionKey = (s) => (knownInstitution(s) || String(s || '').trim()).toLowerCase();
const TOPUP = /^top[- ]?up\s+(.+)$/i;

/**
 * Past top-ups ("Top-up OVO") that were recorded as spending, or as a transfer with no wallet side, for a wallet the person has since added as an
 * account: they can become transfers into it, so the wallet's balance and its own spending are right. (A top-up already in the transfer category
 * counts as no spending today and still does; only the wallet side is added.) Only when exactly one account of the person is that wallet.
 * @returns {{id: string, stream: string, wallet: string, institution: string, amount: number, date: string}[]}
 */
export function convertibleTopups(rows, accounts) {
  const out = [];
  for (const r of rows) {
    if (r.direction !== 'out' || r.status === 'ignored' || r.transfer_id) continue;
    const m = String(r.description || '').match(TOPUP);
    const institution = m ? knownInstitution(m[1]) : '';
    if (!institution) continue;
    const wallets = accounts.filter((a) => institutionKey(a.institution) === institutionKey(institution) && a.stream !== r.stream && (!a.owner || !r.owner || a.owner === r.owner));
    if (wallets.length === 1) out.push({ id: r.id, stream: r.stream, wallet: wallets[0].stream, institution, amount: Number(r.amount), date: String(r.date).slice(0, 10) });
  }
  return out;
}

/** The convertible top-ups counted per wallet account: what the app offers. */
export function topupsByWallet(list) {
  const by = new Map();
  for (const x of list) {
    const g = by.get(x.wallet) || { wallet: x.wallet, institution: x.institution, count: 0, total: 0 };
    g.count += 1;
    g.total += x.amount;
    by.set(x.wallet, g);
  }
  return [...by.values()].sort((a, b) => b.total - a.total);
}

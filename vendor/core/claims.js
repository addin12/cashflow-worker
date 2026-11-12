import { cmp } from './order.js';
// Insurance claims: a payment you will claim back from an insurer by a deadline. The marks live in
// Config `claims` ({ transactionId: { s: 'open' | 'claimed' | 'skip', due: 'YYYY-MM-DD' } }); the
// deadline is the payment date plus Config `claim_days` (insurers differ; the owner sets it).

export const CLAIM_STATUSES = ['open', 'claimed', 'skip'];
export const DEFAULT_CLAIM_DAYS = 30;

const DAY = 86400000;
const toMs = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/** The last day to claim a payment made on `date`. */
export const claimDue = (date, days = DEFAULT_CLAIM_DAYS) => isoOf(toMs(String(date).slice(0, 10)) + Math.max(1, Number(days) || DEFAULT_CLAIM_DAYS) * DAY);

/** The marks after setting `status` ('' clears) on a payment. Re-opening keeps the deadline already set. */
export function markClaim(claims, id, status, { date, days }) {
  const next = { ...claims };
  if (!status) delete next[id];
  else next[id] = { s: status, due: status === 'open' && claims[id] ? claims[id].due : claimDue(date, days) };
  return next;
}

/**
 * Claims still to make, the nearest deadline first.
 * @returns {{id, description, amount, date, due, daysLeft, stream, owner}[]}
 */
export function openClaims(rows, claims, today) {
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  return Object.entries(claims)
    .filter(([id, c]) => c && c.s === 'open' && byId.has(id))
    .map(([id, c]) => {
      const r = byId.get(id);
      return { id, description: r.description || r.details || '', amount: Number(r.amount) || 0, date: String(r.date).slice(0, 10), due: c.due, daysLeft: Math.round((toMs(c.due) - t) / DAY), stream: r.stream || '', owner: r.owner || '' };
    })
    .sort((a, b) => cmp(a.due, b.due));
}

// Spending the two of you share. A payment tagged #bersama is split between you by Config
// shared_split (the first person's percentage, 50 by default); whoever paid more than their part
// is owed the difference. "Tandai lunas" records a settle-up (Config settlements), which counts
// against what is owed, so nothing depends on guessing which transfers were settlements.

const SHARED_TAG = 'bersama';
const TAG_END = '(?![\\p{L}\\p{N}_-])';
const HAS_TAG = new RegExp(`(?:^|[^\\p{L}\\p{N}_-])#${SHARED_TAG}${TAG_END}`, 'iu');
const num = (v) => Number(v) || 0;
const round2 = (n) => Math.round(n * 100) / 100;

/** Is this payment tagged #bersama (in its name or its notes)? */
export const isShared = (r) => HAS_TAG.test(` ${r.description || ''} ${r.details || ''}`);

/** The notes with the tag added, or taken out when it is there. */
export function toggleSharedTag(details) {
  const text = String(details || '');
  if (!isShared({ details: text })) return `${text.trim()} #${SHARED_TAG}`.trim();
  return text.replace(new RegExp(`\\s*#${SHARED_TAG}${TAG_END}`, 'giu'), '').trim();
}

/**
 * Who paid what for the shared costs, what each should have paid, and who owes whom after the settle-ups.
 * @param {{rows: object[], people: [string, string], pct?: number, settlements?: {id, date, from, to, amount}[], range?: {from, to}}} p
 *   people: the two names (a row of anyone else counts as the first person's); pct: the first person's part, 1-99;
 *   range: the dates `monthTotal` is counted over
 * @returns {{count, total, monthTotal, people: {name, paid, share, pct}[], owes: {from, to, amount} | null, settlements: object[]}}
 */
export function sharedBalance({ rows, people, pct = 50, settlements = [], range = null }) {
  const [a, b] = people;
  const part = Math.min(99, Math.max(1, Math.round(num(pct)) || 50));
  const shared = rows.filter((r) => r.status === 'approved' && r.direction === 'out' && isShared(r));
  const paid = { [a]: 0, [b]: 0 };
  let monthTotal = 0;
  for (const r of shared) {
    paid[r.owner === b ? b : a] += num(r.amount);
    const d = String(r.date).slice(0, 10);
    if (range && d >= range.from && d <= range.to) monthTotal += num(r.amount);
  }
  const total = round2(paid[a] + paid[b]);
  const shareA = round2((total * part) / 100);
  const share = { [a]: shareA, [b]: round2(total - shareA) };
  // net > 0: b owes a. A settle-up from b to a lowers it; from a to b raises it.
  let net = round2(paid[a] - shareA);
  for (const s of settlements) net = round2(net + (s.from === a ? num(s.amount) : -num(s.amount)));
  const owes = net > 0.004 ? { from: b, to: a, amount: net } : net < -0.004 ? { from: a, to: b, amount: -net } : null;
  return {
    count: shared.length, total, monthTotal: round2(monthTotal),
    people: [a, b].map((name, i) => ({ name, paid: round2(paid[name]), share: share[name], pct: i === 0 ? part : 100 - part })),
    owes, settlements: [...settlements].reverse().slice(0, 5),
  };
}

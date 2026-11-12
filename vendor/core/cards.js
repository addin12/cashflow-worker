// Credit cards and paylater: each is an account with a statement day and a due day (Config cards).
// The bill is what the last statement covered (spending since the statement before, minus refunds);
// payments are transfers into the card after that statement. Spending since the last statement is
// the next bill building up.

const num = (v) => Number(v) || 0;
const round2 = (n) => Math.round(n * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Day `day` of a month (the month's last day when it is shorter), as a local date. */
const dayIn = (year, monthIndex, day) => new Date(year, monthIndex, Math.min(day, new Date(year, monthIndex + 1, 0).getDate()));

/** Checks a card setting; returns problems (empty when fine). */
export function cardProblems(cards, accounts) {
  const known = new Set(accounts.map((a) => a.stream));
  const seen = new Set();
  const out = [];
  cards.forEach((c, i) => {
    const n = c.stream || `card ${i + 1}`;
    if (!known.has(c.stream)) out.push(`${n}: choose an account`);
    if (seen.has(c.stream)) out.push(`${n}: listed twice`);
    seen.add(c.stream);
    for (const k of ['statement', 'due']) if (!Number.isInteger(Number(c[k])) || Number(c[k]) < 1 || Number(c[k]) > 31) out.push(`${n}: ${k} day must be 1-31`);
  });
  return out;
}

/**
 * @param {{stream, statement: number, due: number}[]} cards
 * @param {object[]} rows  Transactions
 * @param {Date} today
 * @param {string} transferCategory  money moved between your own accounts (a card payment)
 * @returns {{stream, statementDate, dueDate, bill, paid, left, current, daysLeft}[]}
 */
export function cardBills(cards, rows, today, transferCategory) {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return cards.map((c) => {
    const sd = Number(c.statement);
    let last = dayIn(t.getFullYear(), t.getMonth(), sd);
    if (last > t) last = dayIn(t.getFullYear(), t.getMonth() - 1, sd);
    const prev = dayIn(last.getFullYear(), last.getMonth() - 1, sd);
    let due = dayIn(last.getFullYear(), last.getMonth(), Number(c.due));
    if (due <= last) due = dayIn(last.getFullYear(), last.getMonth() + 1, Number(c.due));
    const [lastIso, prevIso] = [iso(last), iso(prev)];
    const mine = rows.filter((r) => r.stream === c.stream && r.status !== 'ignored').map((r) => ({ ...r, date: String(r.date).slice(0, 10) }));
    const spent = (from, to) => mine.filter((r) => r.date > from && r.date <= to && !(r.direction === 'in' && r.category === transferCategory))
      .reduce((s, r) => s + (r.direction === 'out' ? num(r.amount) : -num(r.amount)), 0);
    const bill = round2(Math.max(0, spent(prevIso, lastIso)));
    const paid = round2(mine.filter((r) => r.direction === 'in' && r.category === transferCategory && r.date > lastIso).reduce((s, r) => s + num(r.amount), 0));
    return {
      stream: c.stream, statementDate: lastIso, dueDate: iso(due), bill, paid, left: round2(Math.max(0, bill - paid)),
      current: round2(spent(lastIso, '9999-12-31')), daysLeft: Math.round((due - t) / 86400000),
    };
  });
}

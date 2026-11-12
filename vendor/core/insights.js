// Report pieces: top places, biggest expenses, a year month by month, and the money flow
// (income into accounts, transfers between them, spending out of them). Pure functions.

const num = (v) => Number(v) || 0;
const round2 = (v) => Math.round(v * 100) / 100;
const inRange = (r, { from, to }) => { const d = String(r.date).slice(0, 10); return d >= from && d <= to; };
const isSpending = (r, exp) => r.status === 'approved' && r.direction === 'out' && exp.has(r.category);
/** "CIRCLEKA INDONESIA UTAMA" and "Circleka Indonesia Utama 2" are the same place. */
export const placeKey = (s) => String(s || '').toLowerCase().replace(/\d+/g, ' ').replace(/[^a-z& ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Payments to a place never paid before ("Pertama kali"): the first money-out row of each payee
 * from an email or statement, in the last `days` days. Nothing counts in the app's first 30 days,
 * when every place is new to it.
 * @param {Set<string>|null} earlier  place keys already paid before the oldest row given (a store that keeps only recent rows says so)
 * @returns {Set<string>} row ids
 */
export function newPlaceIds(rows, { start = '', today, days = 60, skipCategories = [], earlier = null }) {
  const skip = new Set(skipCategories);
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const dayMs = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const from = Math.max(t - days * 86400000, start ? dayMs(String(start).slice(0, 10)) + 30 * 86400000 : 0);
  const firsts = new Map();
  for (const r of rows) {
    if (r.direction !== 'out' || r.status === 'ignored' || skip.has(r.category) || String(r.ref_no || '').startsWith('split:')) continue;
    const k = placeKey(r.description);
    if (!k || (earlier && earlier.has(k))) continue; // paid before the rows given: not a first time
    const d = String(r.date).slice(0, 10);
    const f = firsts.get(k);
    if (!f || d < f.d || (d === f.d && String(r.time || '') < f.time)) firsts.set(k, { d, time: String(r.time || ''), r });
  }
  return new Set([...firsts.values()].filter((f) => ['email', 'import'].includes(f.r.source) && dayMs(f.d) >= from).map((f) => String(f.r.id)));
}

/**
 * How often one category was paid lately: times, total, average, and about how many days apart.
 * @param {{date: string, amount: number}[]} rows  the category's approved rows
 * @returns {{n: number, sum: number, avg: number, every: number} | null}  null under 2 payments
 */
export function categoryHabit(rows, { today, days = 90 }) {
  const since = new Date(Date.parse(today) - days * 86400000).toISOString().slice(0, 10);
  const lately = rows.filter((r) => String(r.date).slice(0, 10) >= since && String(r.date).slice(0, 10) <= today);
  if (lately.length < 2) return null;
  const sum = round2(lately.reduce((t, r) => t + num(r.amount), 0));
  return { n: lately.length, sum, avg: round2(sum / lately.length), every: Math.max(1, Math.round(days / lately.length)) };
}

/**
 * Days so far this period: how many stayed within the budget's daily share (`allowance`, 0 = no budgets)
 * and how many had no spending at all.
 * @param {{date: string, amount: number}[]} daily  one entry per day of the period
 */
export function underBudget(daily, { today, from = '', allowance = 0 }) {
  const days = daily.filter((d) => d.date <= today && (!from || d.date >= from));
  if (!days.length) return null;
  return {
    elapsed: days.length, noSpend: days.filter((d) => !(d.amount > 0)).length,
    under: allowance > 0 ? days.filter((d) => d.amount <= allowance).length : null, allowance: Math.round(allowance),
  };
}

/** Where the money went, by place (transaction name): times and total, biggest first. */
export function topPlaces(rows, cats, range, limit = 8) {
  const exp = new Set(cats.expense);
  const by = new Map();
  for (const r of rows) {
    if (!isSpending(r, exp) || !inRange(r, range)) continue;
    const k = placeKey(r.description) || placeKey(r.details);
    if (!k) continue;
    const p = by.get(k) || { name: r.description || r.details, count: 0, total: 0, category: r.category };
    p.count += 1;
    p.total += num(r.amount);
    by.set(k, p);
  }
  return [...by.values()].map((p) => ({ ...p, total: round2(p.total) })).sort((a, b) => b.total - a.total).slice(0, limit);
}

/** The largest single payments. */
export function biggestExpenses(rows, cats, range, limit = 5) {
  const exp = new Set(cats.expense);
  return rows.filter((r) => isSpending(r, exp) && inRange(r, range))
    .sort((a, b) => num(b.amount) - num(a.amount)).slice(0, limit)
    .map((r) => ({ id: r.id, description: r.description || r.details || '', amount: round2(num(r.amount)), date: String(r.date).slice(0, 10), time: r.time || '', category: r.category, stream: r.stream || '', direction: 'out', status: r.status }));
}

/** Spending by weekday (Monday first) and by time of day, for "when do I spend most". */
export function spendingPattern(rows, cats, range) {
  const exp = new Set(cats.expense);
  const weekdays = [0, 0, 0, 0, 0, 0, 0];
  const parts = { morning: 0, noon: 0, afternoon: 0, evening: 0, night: 0 };
  for (const r of rows) {
    if (!isSpending(r, exp) || !inRange(r, range)) continue;
    const d = String(r.date).slice(0, 10);
    const wd = (new Date(`${d}T00:00:00`).getDay() + 6) % 7;
    weekdays[wd] += num(r.amount);
    const h = Number(String(r.time || '').slice(0, 2));
    if (!String(r.time || '').trim() || !Number.isFinite(h)) continue;
    const k = h < 5 ? 'night' : h < 11 ? 'morning' : h < 15 ? 'noon' : h < 18 ? 'afternoon' : 'evening';
    parts[k] += num(r.amount);
  }
  return { weekdays: weekdays.map(round2), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, round2(v)])) };
}

/** Totals per #tag (written in a transaction's name or notes): money out and in, how many. */
export function tagTotals(rows, range) {
  const by = new Map();
  for (const r of rows) {
    if (r.status !== 'approved' || !inRange(r, range)) continue;
    const tags = new Set([...`${r.description || ''} ${r.details || ''}`.matchAll(/#([\p{L}\p{N}_-]+)/gu)].map((m) => m[1].toLowerCase()));
    for (const t of tags) {
      const x = by.get(t) || { tag: t, out: 0, in: 0, count: 0, first: '', last: '' };
      x[r.direction === 'in' ? 'in' : 'out'] += num(r.amount);
      x.count += 1;
      const d = String(r.date).slice(0, 10);
      if (!x.first || d < x.first) x.first = d;
      if (d > x.last) x.last = d;
      by.set(t, x);
    }
  }
  return [...by.values()].map((x) => ({ ...x, out: round2(x.out), in: round2(x.in) })).sort((a, b) => b.out - a.out);
}

/**
 * Money flow for a period: income by account, transfers between own accounts (paired by
 * transfer_id; an unpaired one goes to/from "outside"), and spending by account.
 */
export function moneyFlow(rows, cats, range, transferCategory) {
  const inc = new Set(cats.income);
  const exp = new Set(cats.expense);
  const income = new Map();
  const spent = new Map();
  const pairs = new Map();
  for (const r of rows) {
    if (r.status !== 'approved' || !inRange(r, range) || !r.stream) continue;
    const a = num(r.amount);
    if (r.direction === 'in' && inc.has(r.category)) income.set(r.stream, (income.get(r.stream) || 0) + a);
    else if (r.direction === 'out' && exp.has(r.category)) spent.set(r.stream, (spent.get(r.stream) || 0) + a);
    else if (r.category === transferCategory && r.transfer_id) {
      const p = pairs.get(r.transfer_id) || {};
      p[r.direction] = r;
      pairs.set(r.transfer_id, p);
    }
  }
  const moves = new Map();
  for (const p of pairs.values()) {
    if (!p.out || !p.in || p.out.stream === p.in.stream) continue;
    const k = `${p.out.stream}\u0000${p.in.stream}`;
    moves.set(k, (moves.get(k) || 0) + num(p.out.amount));
  }
  const list = (m) => [...m].map(([stream, amount]) => ({ stream, amount: round2(amount) })).sort((a, b) => b.amount - a.amount);
  return {
    income: list(income),
    spent: list(spent),
    transfers: [...moves].map(([k, amount]) => { const [from, to] = k.split('\u0000'); return { from, to, amount: round2(amount) }; }).sort((a, b) => b.amount - a.amount),
  };
}

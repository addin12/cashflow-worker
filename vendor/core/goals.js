// Savings goals: a target for an account by a date, and how far along it is.

const num = (v) => Number(v) || 0;
const ymOf = (iso) => String(iso).slice(0, 7);
const monthsBetween = (fromYm, toYm) => {
  const [a, b] = fromYm.split('-').map(Number);
  const [c, d] = toYm.split('-').map(Number);
  return (c - a) * 12 + (d - b);
};

/**
 * @param {{stream, name, target, target_date}[]} goals  rows of the Goals tab
 * @param {{stream, balance}[]} balances  today's balances (core/app.js streamBalances)
 * @param {Date} today
 * @returns {{stream, name, target, targetDate, saved, left, percent, monthsLeft, perMonth, done}[]}
 */
export function goalProgress(goals, balances, today) {
  const now = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  return goals.filter((g) => g.stream && num(g.target) > 0).map((g) => {
    const saved = Math.max(0, num((balances.find((b) => b.stream === g.stream) || {}).balance));
    const target = num(g.target);
    const left = Math.max(0, Math.round((target - saved) * 100) / 100);
    const targetDate = String(g.target_date || '').slice(0, 10);
    // Months still to save in, counting the current one; none when there is no date or it has passed.
    const monthsLeft = targetDate ? Math.max(0, monthsBetween(now, ymOf(targetDate)) + 1) : 0;
    return {
      stream: g.stream, name: String(g.name || g.stream), target, targetDate, saved, left,
      percent: Math.min(100, Math.floor((saved / target) * 100)), monthsLeft,
      perMonth: monthsLeft > 0 ? Math.ceil(left / monthsLeft) : 0, done: left === 0,
    };
  });
}

/** Problems with goals as typed in Settings (empty = fine). */
export function goalProblems(goals, accounts) {
  const streams = new Set(accounts.map((a) => a.stream));
  const out = [];
  goals.forEach((g, i) => {
    if (!streams.has(g.stream)) out.push(`goal ${i + 1}: choose an account`);
    if (!(num(g.target) > 0)) out.push(`goal ${i + 1}: the target must be above 0`);
    if (g.target_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(g.target_date))) out.push(`goal ${i + 1}: the date must be YYYY-MM-DD`);
  });
  return out;
}

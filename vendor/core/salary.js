// Salary that no email reports. BCA only emails money going out, so the salary landing there is
// never seen by the sync: on each payday since the start date the app asks for it in Review
// (a "salary card"), until it is recorded or the owner says there was none that month.
// The payday period ("Oktober" = 28 Sep - 27 Oct for payday 28) is also here. A payday on a weekend
// or national holiday moves to the working day before it, and the period with it.

import { cmp } from './order.js';
import { workdayOnOrBefore } from './holidays.js';

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const lastDay = (y, m) => new Date(y, m + 1, 0).getDate();
/** Payday in month 'YYYY-MM' as YYYY-MM-DD (a day the month lacks becomes its last day; weekends and holidays move it earlier). */
export function paydayOf(month, day) {
  const [y, m] = month.split('-').map(Number);
  return iso(workdayOnOrBefore(new Date(y, m - 1, Math.min(day, lastDay(y, m - 1)))));
}
const monthAdd = (ym, k) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + k, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const dayShift = (isoDate, k) => {
  const [y, m, d] = isoDate.split('-').map(Number);
  return iso(new Date(y, m - 1, d + k));
};

/** The income category used for salary: "Gaji" (any case), else the first income category. */
export function salaryCategory(incomeCategories) {
  return incomeCategories.find((c) => /^gaji$/i.test(c)) || incomeCategories.find((c) => /gaji|salary/i.test(c)) || incomeCategories[0] || '';
}

/**
 * Paydays from the start date up to today with no salary recorded.
 * A month counts as recorded when an income row of the salary category (not ignored) is dated
 * within 10 days of that payday, or carries ref_no "salary:YYYY-MM".
 * @returns {{month: string, date: string, amount: number}[]} oldest first; amount = suggested
 */
export function missingSalaries(rows, { start, today, payday, category, skipped = [], expected = 0, refOf = (m) => `salary:${m}` }) {
  if (!start || !category || !payday) return [];
  const todayIso = iso(today);
  const skip = new Set(skipped);
  const salaries = rows.filter((r) => r.direction === 'in' && r.status !== 'ignored' && r.category === category)
    .map((r) => ({ date: String(r.date).slice(0, 10), ref: String(r.ref_no || ''), amount: Number(r.amount) || 0 }))
    .sort((a, b) => cmp(a.date, b.date));
  const last = salaries.length ? salaries[salaries.length - 1].amount : 0;
  const out = [];
  for (let m = String(start).slice(0, 7); ; m = monthAdd(m, 1)) {
    const date = paydayOf(m, payday);
    if (date > todayIso) break;
    if (date < String(start).slice(0, 10) || skip.has(m)) continue;
    const from = dayShift(date, -10);
    const to = dayShift(date, 10);
    if (salaries.some((s) => s.ref === refOf(m) || (s.date >= from && s.date <= to))) continue;
    out.push({ month: m, date, amount: Number(expected) || last });
  }
  return out;
}

/**
 * The payday period a month name stands for: "2026-10" = 28 Sep .. 27 Oct (payday 28).
 * @returns {{from: string, to: string}} inclusive YYYY-MM-DD
 */
export function paydayPeriod(month, payday) {
  return { from: paydayOf(monthAdd(month, -1), payday), to: dayShift(paydayOf(month, payday), -1) };
}

/** The payday period that holds `today`, as its month name. */
export function currentPaydayMonth(today, payday) {
  const m = iso(today).slice(0, 7);
  return iso(today) >= paydayOf(m, payday) ? monthAdd(m, 1) : m;
}

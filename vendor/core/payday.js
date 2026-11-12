// Next payday: the configured day of this month if it is still ahead, otherwise next month's.
// A day that doesn't exist in a month (e.g. 31 in February) falls back to that month's last day.
// Payday itself counts as "already paid", so on the 28th the next payday is next month's 28th.
// A payday on a weekend or a national holiday moves to the working day before it (holidays.js).

import { workdayOnOrBefore, holidaysFormulaArray } from './holidays.js';

function lastDayOfMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function paydayIn(year, monthIndex, day) {
  return workdayOnOrBefore(new Date(year, monthIndex, Math.min(day, lastDayOfMonth(year, monthIndex))));
}

/** @param {Date} today local date (time ignored) @param {number} day 1..31 */
export function nextPayday(today, day) {
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error(`payday day must be 1..31, got ${day}`);
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const thisMonth = paydayIn(t.getFullYear(), t.getMonth(), day);
  if (t < thisMonth) return thisMonth;
  return paydayIn(t.getFullYear(), t.getMonth() + 1, day);
}

/** Is today payday (the configured day, the month's last day when the month is shorter, moved before a weekend or holiday)? */
export function isPayday(today, day) {
  return [0, 1].some((k) => paydayIn(today.getFullYear(), today.getMonth() + k, day).toDateString() === new Date(today.getFullYear(), today.getMonth(), today.getDate()).toDateString());
}

/** Whole days from today until the next payday (always >= 1). */
export function daysUntilPayday(today, day) {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((nextPayday(t, day) - t) / 86400000);
}

/** Same rule as a Google Sheets formula. `dayRef` is a cell or named range holding the day. */
export function nextPaydayFormula(dayRef, todayRef = 'TODAY()') {
  // WORKDAY(date+1,-1,h) is the date itself on a working day, else the working day before.
  const thisMonth = 'WORKDAY(DATE(YEAR(t),MONTH(t),MIN(p,DAY(EOMONTH(t,0))))+1,-1,h)';
  const nextMonth = 'WORKDAY(DATE(YEAR(t),MONTH(t)+1,MIN(p,DAY(EOMONTH(t,1))))+1,-1,h)';
  return `=LET(t,${todayRef},p,${dayRef},h,${holidaysFormulaArray()},a,${thisMonth},IF(t<a,a,${nextMonth}))`;
}

// Indonesian national holidays and cuti bersama (SKB 3 Menteri), when banks and payroll stop.
// A payday on a weekend or one of these days moves to the working day before it.
// shortcut: only the years listed here are known (weekends still count after that); add the next
// year's SKB dates when they are published (the self-test warns from October of the last year).

const HOLIDAYS = new Set([
  // 2026
  '2026-01-01', '2026-01-16', '2026-02-16', '2026-02-17', '2026-03-18', '2026-03-19', '2026-03-20', '2026-03-21', '2026-03-22',
  '2026-03-23', '2026-03-24', '2026-04-03', '2026-04-05', '2026-05-01', '2026-05-14', '2026-05-15', '2026-05-27', '2026-05-28',
  '2026-05-31', '2026-06-01', '2026-06-16', '2026-08-17', '2026-08-25', '2026-12-24', '2026-12-25',
  // 2027
  '2027-01-01', '2027-01-05', '2027-02-05', '2027-02-06', '2027-03-08', '2027-03-09', '2027-03-10', '2027-03-11', '2027-03-12',
  '2027-03-15', '2027-03-25', '2027-03-26', '2027-03-28', '2027-05-01', '2027-05-06', '2027-05-17', '2027-05-18', '2027-05-19',
  '2027-05-20', '2027-06-01', '2027-06-06', '2027-08-15', '2027-08-17', '2027-12-24', '2027-12-25', '2027-12-26',
]);

/** The last year the list covers. */
export const HOLIDAYS_UNTIL = Math.max(...[...HOLIDAYS].map((d) => Number(d.slice(0, 4))));

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Is this local date a working day (not Saturday, Sunday or a listed holiday)? */
export function isWorkday(date) {
  const day = date.getDay();
  return day !== 0 && day !== 6 && !HOLIDAYS.has(iso(date));
}

/** The date itself when it is a working day, else the working day before it. */
export function workdayOnOrBefore(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  while (!isWorkday(d)) d.setDate(d.getDate() - 1);
  return d;
}

/** The holidays as a Google Sheets array of dates, for WORKDAY(). */
export function holidaysFormulaArray() {
  return `{${[...HOLIDAYS].map((d) => `DATE(${Number(d.slice(0, 4))},${Number(d.slice(5, 7))},${Number(d.slice(8, 10))})`).join(';')}}`;
}

// "Hari gajian": on payday (and the two days after) what the salary has to cover before the next one,
// the bills due until then and the monthly amount each savings goal asks for, and what is left to spend.

const num = (v) => Number(v) || 0;
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {{salary: number, bills: {name, amount, date}[], goals: {name, amount}[], days: number}} p
 *   salary: what you usually get (0 = not known); days: until the next payday
 * @returns {{salary, bills, billsTotal, goals, saveTotal, free: number | null, perDay: number | null, days}}
 *   free: the salary less the bills and the saving (null without a salary); perDay: free / days when there is something left
 */
export function paydayPlan({ salary, bills, goals, days }) {
  const billsTotal = round2(bills.reduce((t, b) => t + num(b.amount), 0));
  const saveTotal = round2(goals.reduce((t, g) => t + num(g.amount), 0));
  const free = num(salary) > 0 ? round2(num(salary) - billsTotal - saveTotal) : null;
  return {
    salary: num(salary), bills: bills.map((b) => ({ name: b.name, amount: num(b.amount), date: b.date })), billsTotal,
    goals: goals.map((g) => ({ name: g.name, amount: num(g.amount) })), saveTotal, free,
    perDay: free !== null && free > 0 && days > 0 ? Math.floor(free / days) : null, days,
  };
}

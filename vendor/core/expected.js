// Reference implementation of the template's reports, used by the self-test to check the real
// spreadsheet. It follows the template's rules (docs/TEMPLATE-ANALYSIS.md §2):
//   - only approved transactions of the Setup year count;
//   - income categories (K5:K10) sum Debit = direction "in";
//   - expense, adjustment and transfer rows (K11:K40) sum Credit = direction "out";
//   - Income = K5:K10, Expense = K11:K38 (adjustment and transfer are left out);
//   - a stream's monthly change = IN - OUT over all categories; yearly adds its opening balance.

import { CF, SLOTS, FIXED_CATEGORIES, EMPTY_SLOT } from './schema.js';

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const QUARTERS = [['E', 1], ['P', 4], ['AA', 7], ['AL', 10]];

/** "2026-03-31" -> { year: 2026, month: 3 } */
function ym(date) {
  const [y, m] = String(date).split('-').map(Number);
  return { year: y, month: m };
}

/**
 * @param {object} input
 * @param {number} input.year
 * @param {{income: string[], expense: string[]}} input.slots  padded category slots (6 + 28)
 * @param {{stream: string, type: 'Spending'|'Saving', opening_balance?: number}[]} input.accounts
 * @param {{date: string, stream: string, direction: 'in'|'out', amount: number, category: string, status: string}[]} input.transactions
 * @param {number} input.budgetMonth  month shown in BUDGET TRACKER (1-12)
 * @returns {Map<string, number>} "SHEET!A1" -> expected value
 */
export function expectedReport({ year, slots, accounts, transactions, budgetMonth = 1 }) {
  const out = new Map();
  const put = (sheet, cell, v) => out.set(`${sheet}!${cell}`, v);
  const ledger = transactions.filter((t) => t.status === 'approved' && ym(t.date).year === year);

  const rowNames = {};
  slots.income.forEach((n, i) => { rowNames[CF.incomeRows[0] + i] = { name: n, dir: 'in' }; });
  slots.expense.forEach((n, i) => { rowNames[CF.expenseRows[0] + i] = { name: n, dir: 'out' }; });
  rowNames[CF.adjustmentRow] = { name: FIXED_CATEGORIES.adjustment, dir: 'out' };
  rowNames[CF.transferRow] = { name: FIXED_CATEGORIES.transfer, dir: 'out' };

  const catMonth = (name, dir, month) => (name === EMPTY_SLOT ? 0 : sum(ledger
    .filter((t) => t.category === name && t.direction === dir && ym(t.date).month === month)
    .map((t) => t.amount)));

  // CASHFLOW category matrix, yearly column X, Income/Expense/Balance rows.
  const matrix = {};
  for (const [row, { name, dir }] of Object.entries(rowNames)) {
    matrix[row] = CF.monthCols.map((_, i) => catMonth(name, dir, i + 1));
    CF.monthCols.forEach((col, i) => put('CASHFLOW', `${col}${row}`, matrix[row][i]));
    put('CASHFLOW', `X${row}`, sum(matrix[row]));
  }
  const income = CF.monthCols.map((_, i) => sum(slots.income.map((__, k) => matrix[CF.incomeRows[0] + k][i])));
  const expense = CF.monthCols.map((_, i) => sum(slots.expense.map((__, k) => matrix[CF.expenseRows[0] + k][i])));
  CF.monthCols.forEach((col, i) => {
    put('CASHFLOW', `${col}3`, income[i]);
    put('CASHFLOW', `${col}4`, expense[i]);
    put('CASHFLOW', `${col}41`, income[i] - expense[i]);
  });
  put('CASHFLOW', 'X3', sum(income));
  put('CASHFLOW', 'Y3', sum(expense));
  put('CASHFLOW', 'X41', sum(income) - sum(expense));

  // Streams: the template's 8 spending + 8 saving slots, in Accounts order, unused = "-".
  // Opening balance of the year: the account's own plus every approved row before 1 January.
  const carried = (name) => sum(transactions.filter((t) => t.status === 'approved' && t.stream === name && String(t.date) < `${year}-01-01`)
    .map((t) => (t.direction === 'in' ? t.amount : -t.amount)));
  const withCarry = (list) => list.map((a) => ({ ...a, opening_balance: Number(a.opening_balance || 0) + carried(a.stream) }));
  const pad = (list, n) => [...withCarry(list), ...Array(n - list.length).fill({ stream: EMPTY_SLOT, opening_balance: 0 })];
  const spending = pad(accounts.filter((a) => a.type === 'Spending'), SLOTS.spending);
  const saving = pad(accounts.filter((a) => a.type === 'Saving'), SLOTS.saving);
  const streamMonth = (name, month) => (name === EMPTY_SLOT ? 0 : sum(ledger
    .filter((t) => t.stream === name && ym(t.date).month === month)
    .map((t) => (t.direction === 'in' ? t.amount : -t.amount))));
  const streamRows = (list, firstRow) => list.map((a, k) => {
    const months = CF.monthCols.map((_, i) => streamMonth(a.stream, i + 1));
    const row = firstRow + k;
    CF.monthCols.forEach((col, i) => put('CASHFLOW', `${col}${row}`, months[i]));
    const yearly = sum(months) + Number(a.opening_balance || 0);
    put('CASHFLOW', `X${row}`, yearly);
    return { stream: a.stream, months, yearly, opening: Number(a.opening_balance || 0) };
  });
  const sp = streamRows(spending, CF.spendingStreamRows[0]);
  const sv = streamRows(saving, CF.savingStreamRows[0]);
  CF.monthCols.forEach((col, i) => {
    put('CASHFLOW', `${col}63`, sum(sp.map((s) => s.months[i])));
    put('CASHFLOW', `${col}64`, sum(sv.map((s) => s.months[i])));
    put('CASHFLOW', `${col}65`, sum([...sp, ...sv].map((s) => s.months[i])));
  });
  put('CASHFLOW', 'X63', sum(sp.map((s) => s.yearly)));
  put('CASHFLOW', 'X64', sum(sv.map((s) => s.yearly)));
  put('CASHFLOW', 'X65', sum([...sp, ...sv].map((s) => s.yearly)));

  // QUARTER REPORT: income rows 9-14 (+ total 15), expense rows 17-44 (+ total 45), balance 46.
  for (const [col, startMonth] of QUARTERS) {
    const q = (row) => matrix[row].slice(startMonth - 1, startMonth + 2);
    let inc = 0;
    for (let k = 0; k < SLOTS.income; k += 1) {
      const v = sum(q(CF.incomeRows[0] + k));
      put('QUARTER REPORT', `${col}${9 + k}`, v);
      inc += v;
    }
    put('QUARTER REPORT', `${col}15`, inc);
    let exp = 0;
    for (let k = 0; k < SLOTS.expense; k += 1) {
      const v = sum(q(CF.expenseRows[0] + k));
      put('QUARTER REPORT', `${col}${17 + k}`, v);
      exp += v;
    }
    put('QUARTER REPORT', `${col}45`, exp);
    put('QUARTER REPORT', `${col}46`, inc - exp);
  }

  // FINAL STATEMENT: yearly per category and per stream.
  let dTotal = 0;
  for (let k = 0; k < SLOTS.income; k += 1) {
    const v = sum(matrix[CF.incomeRows[0] + k]);
    // Lookups find the first row with the same name, so every "-" slot reads the first "-" row (0).
    put('FINAL STATEMENT', `D${6 + k}`, slots.income[k] === EMPTY_SLOT ? 0 : v);
    dTotal += v;
  }
  put('FINAL STATEMENT', 'D12', dTotal);
  let fTotal = 0;
  for (let k = 0; k < SLOTS.expense; k += 1) {
    const v = sum(matrix[CF.expenseRows[0] + k]);
    put('FINAL STATEMENT', `F${6 + k}`, slots.expense[k] === EMPTY_SLOT ? 0 : v);
    fTotal += v;
  }
  put('FINAL STATEMENT', 'F34', fTotal);
  put('FINAL STATEMENT', 'F35', dTotal - fTotal);
  const firstDash = (list) => list.find((s) => s.stream === EMPTY_SLOT);
  const lookupYearly = (s) => (s.stream === EMPTY_SLOT ? (firstDash([...sp, ...sv])?.yearly ?? 0) : s.yearly);
  sp.forEach((s, k) => put('FINAL STATEMENT', `S${6 + k}`, lookupYearly(s)));
  sv.forEach((s, k) => put('FINAL STATEMENT', `U${6 + k}`, lookupYearly(s)));
  const s14 = sum(sp.map(lookupYearly));
  const u14 = sum(sv.map(lookupYearly));
  put('FINAL STATEMENT', 'S14', s14);
  put('FINAL STATEMENT', 'U14', u14);
  put('FINAL STATEMENT', 'U15', s14 + u14);

  // BUDGET TRACKER (month = budgetMonth for every block).
  const m = budgetMonth - 1;
  let e35 = 0;
  slots.income.forEach((n, k) => {
    const v = n === EMPTY_SLOT ? 0 : matrix[CF.incomeRows[0] + k][m];
    put('BUDGET TRACKER', `E${29 + k}`, v);
    e35 += v;
  });
  put('BUDGET TRACKER', 'E35', e35);
  let h57 = 0;
  slots.expense.forEach((n, k) => {
    const v = n === EMPTY_SLOT ? 0 : matrix[CF.expenseRows[0] + k][m];
    put('BUDGET TRACKER', `H${29 + k}`, v);
    h57 += v;
  });
  put('BUDGET TRACKER', 'H57', h57);
  // Streams here are cumulative balances up to the chosen month, including the opening balance.
  const cumulative = (s) => sum(s.months.slice(0, budgetMonth)) + s.opening;
  const firstDashCum = () => { const d = firstDash(sp) || firstDash(sv); return d ? cumulative(d) : 0; };
  const budgetStream = (s) => (s.stream === EMPTY_SLOT ? firstDashCum() : cumulative(s));
  sp.forEach((s, k) => put('BUDGET TRACKER', `J${29 + k}`, budgetStream(s)));
  sv.forEach((s, k) => put('BUDGET TRACKER', `L${29 + k}`, budgetStream(s)));
  put('BUDGET TRACKER', 'J37', sum(sp.map(budgetStream)));
  put('BUDGET TRACKER', 'L37', sum(sv.map(budgetStream)));

  return out;
}

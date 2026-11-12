// Every change setup makes to the template, as data. See docs/TEMPLATE-ANALYSIS.md §4.
// Patch shapes:
//   { op: 'formula', sheet, cell, formula }      one cell
//   { op: 'formulas', sheet, range, formulas }    2-D array of formulas
//   { op: 'values', sheet, range, values }        2-D array of plain values
//   { op: 'clear', sheet, range, validations }    clear contents (and data validation)
// `replacesValue: true` marks the two cells where a template value (not a formula) is replaced on purpose.
// Formulas use en-US syntax (commas), which Apps Script setFormula expects in every locale.

import { CF, TX_COL, TABS, SLOTS, EMPTY_SLOT } from './schema.js';
import { nextPaydayFormula } from './payday.js';

const YEAR = 'Setup!$D$3';
const T = TABS.transactions;

const MONTH_NAMES = '{"JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"}';

/** Month number of a CASHFLOW column, read from its header in row 1 ("JAN".."DEC"). */
function monthOf(col) {
  return `MATCH(${col}$1,${MONTH_NAMES},0)`;
}

function monthBounds() {
  return `$B$6:$B,">="&DATE(${YEAR},m,1),$B$6:$B,"<"&DATE(${YEAR},m+1,1)`;
}

/** Monthly total of one category (K<row>) in one month column, from Debit (G) or Credit (H). */
export function categoryCellFormula(row, col, amountCol) {
  return `=IF(OR($K${row}="",$K${row}="${EMPTY_SLOT}"),0,LET(m,${monthOf(col)},SUMIFS($${amountCol}$6:$${amountCol},$C$6:$C,$K${row},${monthBounds()})))`;
}

/** Monthly IN (Debit) or OUT (Credit) of the stream named in K<nameRow>. */
function streamCellFormula(nameRow, col, amountCol) {
  return `=IF(OR($K${nameRow}="",$K${nameRow}="${EMPTY_SLOT}"),0,LET(m,${monthOf(col)},SUMIFS($${amountCol}$6:$${amountCol},$D$6:$D,$K${nameRow},${monthBounds()})))`;
}

/**
 * CASHFLOW!B6: every approved transaction of the Setup year as the template's 7 ledger columns
 * (Date, Category, Streams, Description, Details, Debit, Credit), sorted by date and time.
 */
export function ledgerFormula() {
  const c = (h) => `${T}!${TX_COL[h]}2:${TX_COL[h]}`;
  const ok = `(${c('status')}="approved")*(YEAR(${c('date')})=${YEAR})`;
  const cols = [
    c('date'), c('category'), c('stream'), c('description'), c('details'),
    `IF(${c('direction')}="in",${c('amount')},"")`,
    `IF(${c('direction')}="out",${c('amount')},"")`,
  ].join(',');
  const key = `${c('date')}+IF(ISNUMBER(${c('time')}),${c('time')},0)`;
  return `=ARRAYFORMULA(LET(ok,${ok},rows,FILTER({${cols}},ok),keys,FILTER(${key},ok),IFERROR(SORT(rows,keys,TRUE),"")))`;
}

/**
 * Setup!B6:E13 read the account lists from the Accounts tab; unused slots show "-". The opening
 * balance of the Setup year is the account's starting balance plus everything approved before
 * 1 January of that year, so a new year starts where the old one ended.
 */
export function setupSlotFormulas() {
  const A = TABS.accounts;
  const c = (h) => `${T}!$${TX_COL[h]}$2:$${TX_COL[h]}`;
  const pick = (col, type, k, fallback) => `IFERROR(INDEX(FILTER(${A}!$${col}$2:$${col},${A}!$B$2:$B="${type}"),${k}),${fallback})`;
  const before = (nameCell, dir) => `SUMIFS(${c('amount')},${c('stream')},${nameCell},${c('direction')},"${dir}",${c('status')},"approved",${c('date')},"<"&DATE(${YEAR},1,1))`;
  const opening = (type, k, nameCell) => `=${pick('F', type, k, 0)}+IF(OR(${nameCell}="",${nameCell}="${EMPTY_SLOT}"),0,${before(nameCell, 'in')}-${before(nameCell, 'out')})`;
  const rows = [];
  for (let k = 1; k <= SLOTS.spending; k += 1) {
    const r = 5 + k;
    rows.push([
      `=${pick('A', 'Spending', k, `"${EMPTY_SLOT}"`)}`,
      opening('Spending', k, `$B${r}`),
      `=${pick('A', 'Saving', k, `"${EMPTY_SLOT}"`)}`,
      opening('Saving', k, `$D${r}`),
    ]);
  }
  return rows;
}

function grid(rows, cols, fn) {
  return Array.from({ length: rows[1] - rows[0] + 1 }, (_, i) => cols.map((col) => fn(rows[0] + i, col)));
}

/** All patches, in the order setup applies them. */
export function templatePatches() {
  const p = [];
  const first = CF.monthCols[0];
  const last = CF.monthCols[CF.monthCols.length - 1];

  // Fix #1/#2: ledger comes from Transactions; month sums use real dates instead of TEXT(date,"mmm").
  p.push({ op: 'clear', sheet: CF.sheet, range: 'B5:B5', validations: true, why: 'month label inside the ledger area' });
  p.push({ op: 'clear', sheet: CF.sheet, range: 'B6:H', validations: true, why: 'sample rows, separators, notes' });
  p.push({ op: 'formula', sheet: CF.sheet, cell: 'B6', formula: ledgerFormula(), replacesValue: true, why: 'ledger pulled from Transactions' });
  p.push({ op: 'formulas', sheet: CF.sheet, range: `${first}${CF.incomeRows[0]}:${last}${CF.incomeRows[1]}`,
    formulas: grid(CF.incomeRows, CF.monthCols, (r, col) => categoryCellFormula(r, col, 'G')), why: 'income by month' });
  p.push({ op: 'formulas', sheet: CF.sheet, range: `${first}${CF.expenseRows[0]}:${last}${CF.transferRow}`,
    formulas: grid([CF.expenseRows[0], CF.transferRow], CF.monthCols, (r, col) => categoryCellFormula(r, col, 'H')), why: 'expense, adjustment and transfer by month' });
  for (let i = 0; i < CF.streamBlockCount; i += 1) {
    const n = CF.streamBlockFirstRow + 4 * i;
    p.push({ op: 'formulas', sheet: CF.sheet, range: `${first}${n + 1}:${last}${n + 2}`,
      formulas: [CF.monthCols.map((col) => streamCellFormula(n, col, 'G')), CF.monthCols.map((col) => streamCellFormula(n, col, 'H'))],
      why: `stream block ${i + 1} IN/OUT` });
  }

  // Accounts tab feeds the template's Setup slots.
  p.push({ op: 'formulas', sheet: 'Setup', range: 'B6:E13', formulas: setupSlotFormulas(), why: 'account slots from Accounts tab' });

  // Fix #3: payday from Config instead of a hard-coded 2025 date.
  p.push({ op: 'formula', sheet: CF.sheet, cell: CF.payday.payday, formula: nextPaydayFormula('CFG_PAYDAY'), replacesValue: true, why: 'next payday (was a fixed date)' });
  p.push({ op: 'values', sheet: CF.sheet, range: `${CF.payday.label}:${CF.payday.label}`, values: [['DAYS LEFT TO PAYDAY']], why: 'label' });
  p.push({ op: 'formula', sheet: CF.sheet, cell: CF.payday.perDay, formula: `=IFERROR(X63/${CF.payday.daysLeft},0)`, why: 'budget per day' });

  // Fixes #4-#6 and the extra ones found by the formula scan: totals that skipped rows.
  const fix = (sheet, cell, formula, why) => p.push({ op: 'formula', sheet, cell, formula, why });
  fix('BUDGET TRACKER', 'E35', '=SUM(E29:E34)', 'income total skipped 2 of 6 rows');
  fix('BUDGET TRACKER', 'J37', '=SUM(J29:J36)', 'spending streams total skipped 2 of 8');
  fix('BUDGET TRACKER', 'L37', '=SUM(L29:L36)', 'saving streams total skipped 5 of 8');
  fix('BUDGET TRACKER', 'H57', '=SUM(H29:H56)', 'expense total skipped 2 of 28 rows');
  fix('FINAL STATEMENT', 'S14', '=SUM(S6:S13)', 'spending streams total skipped 2 of 8');
  fix('FINAL STATEMENT', 'U14', '=SUM(U6:U13)', 'saving streams total skipped 2 of 8');
  // Fix #7 (wider than first reported): Q3/Q4 income rows 11-14 read one row too low; all quarter income totals skipped row 14.
  const quarters = [['E', 'L', 'N'], ['P', 'O', 'Q'], ['AA', 'R', 'T'], ['AL', 'U', 'W']];
  for (const [valueCol, from, to] of quarters) {
    for (let r = 9; r <= 14; r += 1) fix('QUARTER REPORT', `${valueCol}${r}`, `=SUM(CASHFLOW!${from}${r - 4}:${to}${r - 4})`, 'quarter income row');
    fix('QUARTER REPORT', `${valueCol}15`, `=SUM(${valueCol}9:${valueCol}14)`, 'quarter income total skipped row 14');
  }

  // Monthly budget block (rows 6-8): an empty or unknown category showed #N/A and an empty target #DIV/0!.
  for (let r = 6; r <= 8; r += 1) {
    fix('BUDGET TRACKER', `E${r}`, `=IFERROR(VLOOKUP(C${r},CASHFLOW!$K$1:$W$40,rawdata!$A$5+1,FALSE),0)`, 'budget realization (income)');
    fix('BUDGET TRACKER', `F${r}`, `=IFERROR((E${r}-G${r})/G${r},"")`, 'budget percentage (income)');
    fix('BUDGET TRACKER', `J${r}`, `=IFERROR(VLOOKUP(H${r},CASHFLOW!$K$1:$W$40,rawdata!$B$5+1,FALSE),0)`, 'budget realization (expense)');
    fix('BUDGET TRACKER', `K${r}`, `=IFERROR((L${r}-J${r})/J${r},"")`, 'budget percentage (expense)');
  }

  // Fix #8: dead helper cells that point at a deleted "MONTHLY REPORT" tab.
  p.push({ op: 'clear', sheet: 'rawdata', range: 'S1:W', validations: false, why: '#REF! helpers for a deleted tab' });

  // Fix #10: GUIDELINE links that point at old row numbers.
  const g = (cell, value) => p.push({ op: 'values', sheet: 'GUIDELINE', range: `${cell}:${cell}`, values: [[value]], why: 'guideline link' });
  g('J12', 'CASHFLOW!K5:K10');
  g('J13', 'CASHFLOW!K11:K38');
  g('J14', 'CASHFLOW!K40');
  g('K14', '');
  g('J17', 'CASHFLOW!K41:W41');
  g('K17', 'CASHFLOW!X41:Y41');
  g('J18', 'CASHFLOW!K46:W53');
  g('K18', 'CASHFLOW!X46:X53');
  g('J19', 'CASHFLOW!K55:W62');
  g('K19', 'CASHFLOW!X55:X62');
  g('J20', 'CASHFLOW!K67:W129');
  g('E7', 'Kategori jenis transaksi debit maupun kredit. Diatur di kolom "K" sel 5–38 (pemasukan 5–10, pengeluaran 11–38). / Income and expense categories live in column K, rows 5–38.');
  g('E6', 'Diisi otomatis dari tab Transactions (hanya status "approved"). Tambah atau ubah transaksi lewat aplikasi atau tab Transactions, bukan di CASHFLOW. / Filled automatically from the Transactions tab.');

  return p;
}

/** Range notation helper for tests and setup: 'B6:H' style ranges are open-ended. */
export function isOpenEnded(range) {
  return /^[A-Z]+\d+:[A-Z]+$/.test(range);
}

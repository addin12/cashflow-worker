import { cmp } from './order.js';
// CSV files people open in Excel or Sheets: the transaction export, the SPT list, and the backup that
// comes with the monthly email. A text cell that starts like a formula gets a leading ' so a
// description such as "=HYPERLINK(...)" can't run when the file is opened. Numbers are left alone.

const FORMULA_START = /^(?:[=+@\t\r]|-(?!\d+(?:[.,]\d+)?$))/; // a lone "-" or a "-" in front of anything but a plain number ("-2+3+cmd|...") is text a spreadsheet would run

export function csvCell(v) {
  if (typeof v === 'number') return String(v);
  let s = String(v ?? '');
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Head + rows -> CSV text with a BOM (Excel then reads it as UTF-8). */
export const toCsv = (head, rows) => `﻿${[head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}`;

/** CSV text -> rows of cells (quotes, doubled quotes, commas and line breaks inside quotes; a BOM is ignored). */
export function parseCsv(text) {
  const s = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false; } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const BACKUP_HEAD = ['id', 'date', 'time', 'owner', 'stream', 'direction', 'amount', 'category', 'description', 'details', 'source', 'status', 'ref_no', 'transfer_id', 'gmail_id'];

/** A backup file back as transactions (the quote csvCell put before formula-like text is taken off again). */
export function parseBackupCsv(text) {
  const [head, ...body] = parseCsv(text);
  if (!head || !['id', 'date', 'direction', 'amount'].every((h) => head.includes(h))) throw new Error('this is not a Cashflow backup file');
  const col = Object.fromEntries(head.map((h, i) => [h, i]));
  return body.filter((r) => r.some((x) => x !== '')).map((r) => {
    const o = {};
    for (const h of BACKUP_HEAD) if (h in col) o[h] = String(r[col[h]] ?? '').replace(/^'(?=[=+@\t\r-])/, '');
    o.amount = Number(o.amount) || 0;
    return o;
  });
}

/** Every transaction, oldest first, with the columns needed to rebuild the sheet. */
export function backupCsv(rows) {
  const sorted = [...rows].sort((a, b) => cmp(`${String(a.date).slice(0, 10)}${a.time}`, `${String(b.date).slice(0, 10)}${b.time}`));
  return toCsv(BACKUP_HEAD, sorted.map((r) => BACKUP_HEAD.map((h) => (h === 'date' ? String(r.date).slice(0, 10) : h === 'amount' ? Number(r.amount) || 0 : r[h] ?? ''))));
}

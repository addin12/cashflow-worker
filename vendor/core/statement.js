// Bank statement import (CSV). BCA never emails money coming in, but its statement ("mutasi
// rekening") lists everything: reading it fills in the salary, transfers in and refunds the app
// can't see. The rows the app already has (from email or typed in) are found and skipped.
//
// Formats: KlikBCA's export (dates as 'DD/MM, the year in the "Periode" line, amounts with DB/CR),
// and any CSV with a header row naming a date, a description and either a signed amount, a
// debit/credit pair of columns, or an amount with a type column.

/** CSV text -> rows of cells. Handles quotes ("" inside), CRLF, and ; or , as separator. */
export function parseCsv(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const head = src.split(/\r?\n/).slice(0, 15).join('\n').replace(/"[^"]*"/g, '');
  const sep = (head.match(/;/g) || []).length > (head.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
}

/** "1,500,000.00" / "1.500.000,00" / "-25000" / "Rp 25.000" -> number (NaN when not a number). */
export function parseAmount(raw) {
  let s = String(raw ?? '').replace(/[^\d.,-]/g, '');
  if (!/\d/.test(s)) return NaN;
  const neg = s.startsWith('-') || /^\(.*\)$/.test(String(raw).trim());
  s = s.replace(/-/g, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    s = s.split(dec === '.' ? ',' : '.').join('').replace(dec, '.');
  } else if (lastComma >= 0) {
    // "25,50" is a decimal; "1,500,000" groups thousands
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.split(',').join('') : s.replace(',', '.');
  } else if (lastDot >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.split('.').join('');
  const v = Number(s);
  return Number.isFinite(v) ? (neg ? -v : v) : NaN;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, agu: 8, agt: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12 };
const pad = (n) => String(n).padStart(2, '0');
/** A statement date -> YYYY-MM-DD ('' when it isn't one). `year` fills in day/month-only dates. */
export function parseDate(raw, year) {
  const s = String(raw || '').replace(/^'/, '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?(?!\d)/);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : year;
    const mo = Number(m[2]);
    const d = Number(m[1]);
    return y && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(mo)}-${pad(d)}` : '';
  }
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(m[1])}`;
  return '';
}

const COLS = {
  date: /^(tanggal|tgl|date|waktu|posting|transaction date)/i,
  description: /(keterangan|deskripsi|description|uraian|title|judul|catatan|note|merchant|remark)/i,
  debit: /(debit|debet|keluar|pengeluaran|withdraw)/i,
  credit: /(kredit|credit|masuk|pemasukan|deposit)/i,
  amount: /(jumlah|amount|nominal|nilai|mutasi)/i,
  type: /^(tipe|type|jenis|db\/cr|d\/k|dk|cr\/db)$/i,
  balance: /^(saldo|balance)/i,
};
const OUT_WORDS = /^(db|d|debit|debet|out|keluar|expense|pengeluaran|withdrawal)$/i;
const IN_WORDS = /^(cr|c|k|kredit|credit|in|masuk|income|pemasukan|deposit)$/i;

/**
 * Statement CSV -> { format, rows: [{date, description, amount, direction}], skipped }.
 * Throws with a plain message when no transaction table is found.
 */
export function parseStatement(text) {
  const rows = parseCsv(text);
  // KlikBCA: "Periode : 01/09/2026 - 30/09/2026" then "Tanggal Transaksi,Keterangan,Cabang,Jumlah,,Saldo".
  const period = rows.find((r) => /^periode/i.test(r[0] || ''));
  const periodText = period ? period.join(' ') : '';
  const years = [...periodText.matchAll(/\d{1,2}\/(\d{1,2})\/(\d{4})/g)].map((m) => ({ month: Number(m[1]), year: Number(m[2]) }));
  const headerAt = rows.findIndex((r) => r.some((c) => COLS.date.test(c)) && r.some((c) => COLS.amount.test(c) || COLS.debit.test(c) || COLS.credit.test(c)));
  if (headerAt < 0) throw new Error('no transaction table found (a header row with a date and an amount)');
  const header = rows[headerAt].map((c) => c.toLowerCase());
  const find = (re, not) => header.findIndex((h) => re.test(h) && !(not && not.test(h)));
  const col = {
    date: find(COLS.date), description: find(COLS.description),
    debit: find(COLS.debit, /saldo|balance/), credit: find(COLS.credit, /saldo|balance/),
    amount: find(COLS.amount, /saldo|balance/), type: find(COLS.type), balance: find(COLS.balance),
  };
  const klikbca = !!period && col.amount >= 0 && col.debit < 0 && col.credit < 0;
  const out = [];
  let skipped = 0;
  for (const r of rows.slice(headerAt + 1)) {
    if (/^(saldo awal|mutasi kredit|mutasi debet|saldo akhir)/i.test(r[0] || '')) break; // KlikBCA's totals
    const rawDate = r[col.date] || '';
    if (/^'?pend/i.test(rawDate)) { skipped += 1; continue; } // not booked yet: it comes in the next statement
    let year = years.length ? years[0].year : new Date().getFullYear();
    // A statement over New Year: December rows belong to the first year, January rows to the second.
    const dm = rawDate.replace(/^'/, '').match(/^\d{1,2}\/(\d{1,2})$/);
    if (dm && years.length === 2 && Number(dm[1]) < years[0].month) year = years[1].year;
    const date = parseDate(rawDate, year);
    let amount = NaN;
    let direction = '';
    if (col.debit >= 0 || col.credit >= 0) {
      const d = parseAmount(r[col.debit]);
      const c = parseAmount(r[col.credit]);
      if (d > 0) { amount = d; direction = 'out'; } else if (c > 0) { amount = c; direction = 'in'; }
    } else if (col.amount >= 0) {
      amount = parseAmount(r[col.amount]);
      // KlikBCA puts DB/CR in the (unnamed) cell after the amount; others have a type column or a sign.
      const marker = (klikbca ? r[col.amount + 1] : col.type >= 0 ? r[col.type] : '') || String(r[col.amount]).match(/\b(DB|CR)\b/i)?.[1] || '';
      if (OUT_WORDS.test(marker.trim())) direction = 'out';
      else if (IN_WORDS.test(marker.trim())) direction = 'in';
      else if (amount < 0) direction = 'out';
      else if (amount > 0 && !marker && col.type < 0 && !klikbca) direction = 'in';
      amount = Math.abs(amount);
    }
    if (!date || !(amount > 0) || !direction) { skipped += 1; continue; }
    const description = String(col.description >= 0 ? r[col.description] : '').replace(/\s+/g, ' ').trim();
    out.push({ date, description, amount: Math.round(amount * 100) / 100, direction });
  }
  if (!out.length) throw new Error('no transactions could be read from this file');
  return { format: klikbca ? 'klikbca' : 'csv', rows: out, skipped };
}

const dayNo = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86400000;

/**
 * Marks the statement rows the app already has: same account, same direction, the same amount,
 * dated within `days` days (banks book some payments a day or two later). Each app row is used once.
 * @returns rows with `matchId` (the app's row) or '' (new)
 */
export function matchStatement(rows, existing, { stream, days = 2 }) {
  const pool = existing.filter((x) => x.stream === stream && x.status !== 'ignored')
    .map((x) => ({ id: String(x.id), date: String(x.date).slice(0, 10), amount: Number(x.amount) || 0, direction: x.direction, used: false }));
  return rows.map((r) => {
    let best = null;
    for (const x of pool) {
      if (x.used || x.direction !== r.direction || Math.abs(x.amount - r.amount) >= 0.5) continue;
      const gap = Math.abs(dayNo(x.date) - dayNo(r.date));
      if (gap <= days && (!best || gap < best.gap)) best = { x, gap };
    }
    if (best) best.x.used = true;
    return { ...r, matchId: best ? best.x.id : '' };
  });
}

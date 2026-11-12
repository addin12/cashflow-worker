// Grab e-receipts (no-reply@grab.com). A ride or order paid from a wallet is spending of that wallet: an expense on the OVO (or GoPay, DANA,
// ShopeePay) account, which is the only place wallet spending shows in the mail. Paid in cash, by card or with points it is skipped: cash has
// no account to leave, a card payment has its own bank email, and points are not money.
//
// Layouts seen (plain text, one piece per line):
//   ride (English)    "Picked up on 05 November 2026", "Booking ID: …", "Total Paid" then the amount, "Paid by" then the wallet
//   tip (English)     "Date: 05 Nov 26 12:34 +0700", "Total Paid", "Paid by"
//   food (Indonesian) "WAKTU" then "05 Nov 26 12:34 +0700", "Pesanan Dari:" the restaurant, "Pesanan ID", "Detail Pembayaran:" then "OVO Cash : Rp 38.000"
//                     (the amount paid after promos) or "OVO Cash" and the amount under "TOTAL" ("IDR 38.000")
//   mart (Indonesian) "Diantar pada" then the time, "Total harga", "Metode Pembayaran:" then "OVO Cash : Rp 38.000"
import { monthNumber, parseDateTime } from '../money.js';
import { findToken } from '../text.js';
import { ok, skip, amountOf, joinDetails, knownInstitution } from './common.js';

const WALLETS = ['OVO', 'GoPay', 'DANA', 'ShopeePay'];
const walletOf = (text) => WALLETS.find((w) => knownInstitution(text) === knownInstitution(w));
const pad = (n) => String(n).padStart(2, '0');

/** The token after the first token that is exactly `label` (and is not a bare number). */
const after = (tokens, label) => {
  const re = new RegExp(`^${label}$`, 'i');
  for (let i = 0; i < tokens.length - 1; i += 1) if (re.test(tokens[i]) && !/^[\d.,\s]+$/.test(tokens[i + 1])) return tokens[i + 1];
  return '';
};

/** "05 Nov 26 12:34 +0700" (two-digit year, local time), or any "5 November 2026" in the text. */
function when(raw) {
  const s = String(raw || '');
  const m = s.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{2,4})\s+(\d{1,2}):(\d{2})/);
  const month = m ? monthNumber(m[2]) : 0;
  if (m && month) return { date: `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${pad(month)}-${pad(m[1])}`, time: `${pad(m[4])}:${m[5]}:00` };
  const d = parseDateTime(s);
  return d ? { date: d.date, time: d.time } : null;
}

/** The date from a labelled token ("Picked up on …", "Date: …") or the one after a label ("WAKTU", "Diantar pada"); else the first date-and-time token. */
function receiptDate(t) {
  const inline = t.find((x) => /^(picked up on|date:)/i.test(x));
  const byLabel = after(t, 'WAKTU') || after(t, 'Diantar pada');
  return when(inline) || when(byLabel) || when(t.find((x) => /^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}\s+\d{1,2}:\d{2}/.test(x)));
}

/** { method, total }: from "OVO Cash : Rp 38.000" (the amount actually paid), or "Paid by" / "Detail Pembayaran:" / "Metode Pembayaran:" and the total line. */
function payment(t) {
  const line = t.map((x) => x.match(/^(.+?)\s*:\s*(?:Rp|IDR)\s*([\d.,]+)$/i)).find((m) => m && !/^(subtotal|pajak|total)/i.test(m[1]));
  const method = line ? line[1] : after(t, 'Paid by') || after(t, 'Detail Pembayaran:') || after(t, 'Metode Pembayaran:');
  const total = line ? line[2] : after(t, 'Total Paid') || after(t, 'TOTAL') || after(t, 'Total harga');
  return { method, total };
}

export const grab = {
  id: 'grab',
  matches: (m) => /@grab\.com$/i.test(m.from) && /e-?receipt/i.test(m.subject),
  parse(m) {
    const t = m.tokens;
    const { method, total } = payment(t);
    if (/semua orang membayar/i.test(method)) return skip('group order: everyone pays their own');
    if (!method) throw new Error('no payment method on the receipt');
    if (/points?/i.test(method)) return skip('paid with points');
    const wallet = walletOf(method);
    if (!wallet) return skip(`paid by ${method.replace(/\d/g, '#').slice(0, 20)}: not a wallet`);
    const day = receiptDate(t);
    if (!day) throw new Error('no receipt date');

    const tip = /tips?\b/i.test(t[0] || '');
    const kind = after(t, 'Jenis Kendaraan:') || after(t, 'Dipesan dengan:');
    const place = after(t, 'Pesanan Dari:').trim();
    const service = (t[findToken(t, /^Hope you enjoyed|^Thank you|^Terima kasih|^Thanks!/i) - 1] || '').trim();
    const order = (after(t, 'Pesanan ID') || (t[findToken(t, /^Booking ID:/i)] || '').replace(/^Booking ID:\s*/i, '')).trim();
    const name = tip ? 'Grab tip' : kind ? `${kind}${place ? ` ${place}` : ''}` : `Grab${service && !/^\d+$/.test(service) ? ` ${service}` : ''}`;
    return ok({
      type: 'payment', direction: 'out', date: day.date, time: day.time || '', amount: amountOf(total), fee: 0,
      account: { institution: wallet, hint: '' }, counterparty: { name: place || 'Grab' }, description: name,
      details: joinDetails(tip ? 'Grab tip' : kind || 'Grab', order), refNo: order,
    });
  },
};

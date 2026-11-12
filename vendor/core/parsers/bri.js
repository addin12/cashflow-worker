// BRI (BRImo emails from bankbri@bri.co.id). Four layouts, all with the label and its value on one line or on two:
//   "Pembelian QRIS Berhasil" / "Pembayaran QR Berhasil"  a QRIS payment: merchant and place
//   "Top Up <wallet> Berhasil"                            a top-up: the wallet and its number
//   "Pemindahan Dana Sesama Rekening BRI"                 a transfer: who and which account
//   "Notification BRI"                                    one line: "Dana Rp … keluar dari / masuk ke rekening ***1234 pada 06/11/26 12:34:56. Ket.: …"
import { parseDateTime, parseTime } from '../money.js';
import { valueAfter, findToken } from '../text.js';
import { ok, skip, amountOf, feeOf, remark, joinDetails, institutionOf } from './common.js';

const LABELS = [
  'Tanggal Transaksi', 'Nomor Referensi', 'No. Ref', 'Rekening Sumber Dana', 'Nama Sumber Dana', 'Sumber Dana', 'Jenis Transaksi',
  'Nama Merchant', 'Lokasi Merchant', 'Nama Penerbit', 'Nama Pengakuisisi', 'Kode PAN Pelanggan', 'Merchant PAN', 'ID Terminal',
  'Catatan', 'Nominal', 'Biaya Admin', 'Total Transaksi', 'Total', 'Tujuan', 'Bank Tujuan', 'Nomor Tujuan', 'Nama Tujuan',
];

/** The last digits of the masked number ("1234 **** **** 567" or "***1234"): what Accounts.match_hint is compared with. */
function sourceHint(tokens) {
  const i = findToken(tokens, /\*{2,}/);
  const m = i < 0 ? null : tokens[i].match(/(\d+)\s*$/);
  return m ? m[1] : '';
}

/** "06 November 2026 &#44; 12:34:56 WIB": some mail tools leave an entity where the comma was. */
const stamp = (raw) => parseDateTime(String(raw || '').replace(/&#?\w+;/g, ','));

function notification(m) {
  const line = m.tokens.find((t) => /^Dana\s+Rp/i.test(t));
  const x = line && line.match(/Dana\s+Rp\s*([\d.,]+)\s+(keluar dari|masuk ke)\s+rekening\s+(\S+)\s+pada\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}[:.]\d{2}(?:[:.]\d{2})?)\.?\s*(?:Ket\.?:?\s*(.*))?$/i);
  if (!x) throw new Error('unreadable BRI notification line');
  const out = /keluar/i.test(x[2]);
  const note = String(x[8] || '').trim();
  // A QRIS payment also has its own email with the merchant; recording both would count it twice.
  if (out && /^QRIS/i.test(note)) return skip('QRIS payment: its own email has the details');
  const year = x[6].length === 2 ? `20${x[6]}` : x[6];
  return ok({
    type: out ? 'payment' : 'income', direction: out ? 'out' : 'in',
    date: `${year}-${x[5].padStart(2, '0')}-${x[4].padStart(2, '0')}`, time: parseTime(x[7]),
    amount: amountOf(x[1]), fee: 0, account: { institution: 'BRI', hint: (x[3].match(/(\d+)$/) || [])[1] || '' },
    counterparty: { name: '' }, description: out ? 'Dana keluar BRI' : 'Dana masuk BRI', details: note, refNo: '',
  });
}

export const bri = {
  id: 'bri',
  matches: (m) => /@bri\.co\.id$/i.test(m.from),
  parse(m) {
    if (/notification bri/i.test(m.subject)) return notification(m);
    if (/gagal|tidak berhasil/i.test(m.subject)) return skip('failed transaction');
    if (!/berhasil|pemindahan dana/i.test(m.subject)) return skip('not a transaction email');
    const t = m.tokens;
    const get = (l) => valueAfter(t, l, LABELS, true);
    const day = stamp(get('Tanggal Transaksi') || get('Tanggal')) || stamp(t[findToken(t, /^\d{1,2}\s+[A-Za-z]+\s+\d{4}/)]);
    if (!day) throw new Error('no transaction date');
    const when = { date: day.date, time: day.time };
    const account = { institution: 'BRI', hint: sourceHint(t) };
    const refNo = get('Nomor Referensi') || get('No. Ref');
    const amount = amountOf(get('Nominal'));
    const fee = feeOf(get('Biaya Admin'));

    if (/top ?up/i.test(m.subject)) {
      const at = findToken(t, /^Tujuan$/i);
      const wallet = get('Tujuan');
      const number = (t[at + 2] || '').replace(/\D/g, ''); // "OVO 0812…" under the wallet's name
      return ok({
        type: 'topup', direction: 'out', ...when, amount, fee, account,
        counterparty: { name: wallet, institution: institutionOf(wallet), account: number }, description: `Top-up ${wallet}`, details: '', refNo,
      });
    }

    if (/pemindahan dana|transfer/i.test(m.subject)) {
      const name = get('Nama Tujuan');
      const bank = institutionOf(get('Bank Tujuan'));
      const number = get('Nomor Tujuan').replace(/\D/g, '');
      return ok({
        type: 'transfer', direction: 'out', ...when, amount, fee, account,
        counterparty: { name, institution: bank, account: number }, description: name, details: joinDetails(remark(get('Catatan'))), refNo,
      });
    }

    // QRIS: "Nama Merchant" and "Lokasi Merchant"
    const merchant = get('Nama Merchant') || get('Tujuan');
    return ok({
      type: 'payment', direction: 'out', ...when, amount, fee, account,
      counterparty: { name: merchant }, description: merchant, details: joinDetails('QRIS', get('Lokasi Merchant')), refNo,
    });
  },
};

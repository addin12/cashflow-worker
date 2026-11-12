// Livin' by Mandiri (Indonesian, label/value table; payee in a heading under "Penerima"). A transfer's amount is "Jumlah Transfer", "Nominal Transfer", or just "Nominal".
import { parseDateTime, parseTime } from '../money.js';
import { valueAfter, firstValue, findToken } from '../text.js';
import { ok, skip, amountOf, feeOf, remark, joinDetails, institutionOf, splitPayee } from './common.js';

const LABELS = [
  'Penerima', 'Penyedia Jasa', 'Tanggal', 'Jam', 'Nominal Transaksi', 'Biaya Transaksi', 'Total Transaksi',
  'No. Referensi', 'Nomor Referensi', 'No. Ref. QRIS', 'Merchant PAN', 'Customer PAN', 'Pengakuisisi',
  'Terminal ID', 'Sumber Dana', 'Rekening Sumber', 'Jumlah Transfer', 'Nominal Transfer', 'Biaya Transfer',
  'Tujuan Transaksi', 'No. Referensi BI Fast', 'Keterangan', 'Nominal Top-up', 'Nominal', 'Jumlah',
];

/** Account hint: the "****1234" shown under Sumber Dana / Rekening Sumber. */
function sourceHint(text) {
  const m = text.match(/(?:Sumber Dana|Rekening Sumber)[\s\S]{0,80}?\*{3,}\s*(\d{3,})/i);
  return m ? m[1] : '';
}

/** The tokens after a heading label like "Penerima" (the HTML puts name and bank in 2 elements). */
function blockAfter(tokens, label) {
  const i = findToken(tokens, new RegExp(`^${label}\\b`, 'i'));
  if (i < 0) return ['', ''];
  const own = tokens[i].replace(new RegExp(`^${label}\\s*`, 'i'), '').trim();
  if (own) return [own, LABELS.includes(tokens[i + 1]) ? '' : (tokens[i + 1] || '')];
  const a = tokens[i + 1] || '';
  const b = tokens[i + 2] || '';
  return [a, LABELS.includes(b) ? '' : b];
}

export const livin = {
  id: 'livin',
  matches: (m) => /livin@bankmandiri\.co\.id$/i.test(m.from),
  parse(m) {
    const t = m.tokens;
    const get = (l) => valueAfter(t, l, LABELS, true); // HTML mail has the label and value apart, plain-text mail on one line
    if (/tidak berhasil|gagal/i.test(m.subject)) return skip('failed transaction');
    if (!/berhasil/i.test(m.subject)) return skip('not a transaction email');
    const day = parseDateTime(get('Tanggal'));
    if (!day) throw new Error('no transaction date');
    const when = { date: day.date, time: parseTime(get('Jam')) };
    const account = { institution: 'Mandiri', hint: sourceHint(m.text) };
    const refNo = firstValue(t, ['No. Referensi', 'Nomor Referensi', 'No. Referensi BI Fast'], LABELS, true);

    if (/top-?up/i.test(m.subject)) {
      const [provider] = blockAfter(t, 'Penyedia Jasa');
      const name = provider.replace(/\*+\s*\d+\s*$/, '').trim();
      const acct = (provider.match(/\*+\s*(\d+)\s*$/) || [])[1] || (t[findToken(t, /^\*{3,}\s*\d+$/)] || '').replace(/\D/g, '');
      return ok({
        type: 'topup', direction: 'out', ...when, amount: amountOf(get('Nominal Top-up')), fee: feeOf(get('Biaya Transaksi')),
        account, counterparty: { name, institution: institutionOf(name), account: acct },
        description: `Top-up ${name}`, details: '', refNo,
      });
    }

    if (/transfer/i.test(m.subject)) {
      const payee = splitPayee(...blockAfter(t, 'Penerima'));
      return ok({
        type: 'transfer', direction: 'out', ...when,
        amount: amountOf(firstValue(t, ['Jumlah Transfer', 'Nominal Transfer', 'Nominal', 'Jumlah'], LABELS, true)), fee: feeOf(get('Biaya Transfer')),
        account, counterparty: payee, description: payee.name,
        details: joinDetails(remark(get('Keterangan')), /bi ?fast/i.test(m.subject) ? 'BI-FAST' : ''), refNo,
      });
    }

    if (/pembayaran/i.test(m.subject)) {
      const [payee, place] = blockAfter(t, 'Penerima');
      // "CIRCLEKA … - ID" (location suffix) and "Tokopedia 8870800322021031" (virtual account) are trimmed.
      const merchant = payee.replace(/\s*-\s*ID$/, '').replace(/\s+\d{8,}$/, '').trim();
      const qr = /dengan QR/i.test(m.text);
      return ok({
        type: 'payment', direction: 'out', ...when, amount: amountOf(get('Nominal Transaksi')), fee: feeOf(get('Biaya Transaksi')),
        account, counterparty: { name: merchant }, description: merchant,
        details: joinDetails(qr ? 'QRIS' : '', /\s-\s*ID$/.test(place) ? place.replace(/\s*-\s*ID$/, '') : ''), refNo,
      });
    }
    return skip(`unknown Livin' email "${m.subject}"`);
  },
};

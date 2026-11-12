// blu by BCA Digital. Vertical layout: a label token, then its value token. The two parties are
// shown side by side; the owner's side ends with "bluAccount".
import { parseAmount, parseDateTime } from '../money.js';
import { valueAfter, firstValue, findToken } from '../text.js';
import { ok, skip, amountOf, joinDetails, splitNameBank } from './common.js';

const LABELS = [
  'Total Bayar', 'Total', 'Nominal', 'Nominal Tagihan', 'Nominal Transfer', 'Biaya Admin', 'bluRewards',
  'Tgl & Jam Transaksi', 'Tipe Transaksi', 'Tipe Otentikasi', 'Lokasi', 'No. Ref blu', 'Nama Acquirer',
  'Merchant ID', 'Terminal ID (TID)', 'Customer PAN (CPAN)', 'Reff ID (RRN)', 'Source of Fund',
];

const digits = (s) => String(s || '').replace(/\D/g, '');
const lastFour = (s) => digits(s).slice(-4);

/** "UMAR ZULKIFLI BCA 5295 1390 96" -> name / bank / account. */
function payeeWithAccount(raw) {
  const m = raw.match(/^(.*?)\s+(\d[\d ]{5,})$/);
  if (!m) return null;
  return { ...splitNameBank(m[1]), account: digits(m[2]) };
}

export const blu = {
  id: 'blu',
  matches: (m) => /@blubybcadigital\.id$/i.test(m.from),
  parse(m) {
    const t = m.tokens;
    const get = (l) => valueAfter(t, l, LABELS);
    const when = parseDateTime(get('Tgl & Jam Transaksi'));
    const refNo = digits(get('No. Ref blu'));
    // The owner's side ends with "bluAccount" (+ account number); the greeting also mentions it.
    // The HTML may split each side over several elements ("Name" / "bluAccount" / "0012 …"),
    // so the sides are collected as runs of tokens.
    const meAt = findToken(t, /bluAccount[\d\s]*$/i);
    const isLabel = (x) => LABELS.some((l) => l.toLowerCase() === String(x).trim().toLowerCase());
    // Amounts are styled in pieces ("Rp" "1.500.000" ",00") and become "Rp 1.500.000 ,00".
    const isAmount = (x) => /^-?Rp[\d.,]+$/i.test(String(x).replace(/\s/g, ''));
    const isNote = (x) => /^[“"].*[”"]$/.test(String(x).trim());
    const meStart = meAt > 0 && /^bluAccount/i.test(t[meAt]) ? meAt - 1 : meAt;
    const meEnd = meAt >= 0 && /^\d[\d\s]{3,}$/.test(t[meAt + 1] || '') ? meAt + 1 : meAt;
    const me = meAt >= 0 ? t.slice(meAt, meEnd + 1).join(' ') : '';

    if (/masuk/i.test(m.subject)) {
      if (!when) throw new Error('no transaction date');
      const label = t.findIndex((x) => /^nominal transfer$/i.test(x.trim()));
      const sender = meStart > 0 ? t.slice(label >= 0 ? label + 1 : 0, meStart)
        .filter((x) => !isLabel(x) && !isAmount(x) && !isNote(x) && !/bluAccount/i.test(x)).join(' ') : '';
      // "M SOMEONE BCA": the last word is the sending bank when it is a known institution.
      const { name, institution: bank } = splitNameBank(sender);
      const note = (t.find((x) => /^[“"].*[”"]$/.test(x)) || '').replace(/^[“"]|[”"]$/g, '');
      return ok({
        type: 'income', direction: 'in', ...when, amount: amountOf(get('Nominal Transfer')), fee: 0,
        account: { institution: 'blu', hint: lastFour(me) },
        counterparty: { name, institution: bank },
        description: name, details: joinDetails(note, get('Tipe Transaksi')), refNo,
      });
    }

    if (!/berhasil/i.test(m.subject)) return skip('not a transaction email');
    if (!when) throw new Error('no transaction date');
    let stop = meEnd + 1;
    while (stop < t.length && !isLabel(t[stop])) stop += 1;
    const other = meAt >= 0 ? t.slice(meEnd + 1, stop).join(' ') : '';
    // "MERCHANT bluDebit Card •••• 1111" (+ "Nominal dalam USD USD 23,97" for foreign currency)
    const card = other.match(/^(.*?)\s*bluDebit Card[\s•*]*(\d{4})\b\s*(.*)$/i);
    const principalRaw = firstValue(t, ['Nominal', 'Nominal Tagihan', 'Total Bayar', 'Total'], LABELS);
    const totalRaw = firstValue(t, ['Total Bayar', 'Total'], LABELS) || principalRaw;
    const amount = amountOf(principalRaw);
    const fee = Math.max(0, Math.round((parseAmount(totalRaw) - amount) * 100) / 100) || 0;
    const type = get('Tipe Transaksi');
    const sourceHint = lastFour(get('Source of Fund'));

    if (card) {
      return ok({
        type: 'payment', direction: 'out', ...when, amount, fee,
        account: { institution: 'blu', hint: card[2] }, counterparty: { name: card[1].trim() },
        description: card[1].trim(), details: joinDetails('Kartu debit', type, card[3].replace(/^Nominal dalam\s*[A-Z]{3}\s*/i, '')), refNo,
      });
    }
    const payee = /bi-?fast|transfer|antar|online|skn|rtgs/i.test(type) ? payeeWithAccount(other) : null;
    if (payee) {
      return ok({
        type: 'transfer', direction: 'out', ...when, amount, fee,
        account: { institution: 'blu', hint: sourceHint }, counterparty: payee,
        description: payee.name, details: joinDetails(type), refNo,
      });
    }
    const merchant = other.replace(/\s+(Jakarta|Kota|Kab\.?|Bekasi|Bogor|Depok|Tangerang)\b.*$/i, '').trim() || other;
    const place = other.slice(merchant.length).trim();
    return ok({
      type: 'payment', direction: 'out', ...when, amount, fee,
      account: { institution: 'blu', hint: sourceHint }, counterparty: { name: merchant },
      description: merchant, details: joinDetails(/qris/i.test(type) ? 'QRIS' : type, place), refNo,
    });
  },
};

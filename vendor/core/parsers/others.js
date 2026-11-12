// Jago, Mandiri Sekuritas (dividends) and GoPay (monthly summary).
import { parseDateTime, parseAmount, monthNumber, wibFromEpoch } from '../money.js';
import { valueAfter } from '../text.js';
import { ok, skip, amountOf, splitNameBank } from './common.js';

const JAGO_LABELS = ['Ringkasan transaksi', 'Dari', 'Ke', 'Jumlah', 'Tanggal transaksi'];

/** "M SOMEONE Mandiri • 60010002468" / "MA • 109876543210" -> { name, institution, account } */
function jagoParty(raw) {
  const [left, acct = ''] = String(raw).split('•').map((s) => s.trim());
  const { name, institution } = splitNameBank(left);
  return { name, institution: institution || 'Jago', account: acct.replace(/\D/g, '') };
}

export const jago = {
  id: 'jago',
  matches: (m) => /@jago\.com$/i.test(m.from) && /^noreply@/i.test(m.from),
  parse(m) {
    const t = m.tokens;
    if (/melakukan transfer/i.test(m.subject)) {
      // The HTML puts the name and "Bank • number" in two paragraphs of one cell: join them.
      const get = (l) => {
        const v = valueAfter(t, l, JAGO_LABELS);
        const i = t.indexOf(v, t.findIndex((x) => x.trim().toLowerCase() === l.toLowerCase()));
        const next = i >= 0 ? t[i + 1] || '' : '';
        return v && !v.includes('•') && next.includes('•') && !JAGO_LABELS.includes(next) ? `${v} ${next}` : v;
      };
      const when = parseDateTime(get('Tanggal transaksi'));
      if (!when) throw new Error('no transaction date');
      const from = jagoParty(get('Dari'));
      const to = jagoParty(get('Ke'));
      return ok({
        type: 'transfer', direction: 'out', ...when, amount: amountOf(get('Jumlah')), fee: 0,
        account: { institution: 'Jago', hint: from.account.slice(-4) },
        counterparty: to, description: to.name, details: '', refNo: '',
      });
    }
    if (/kantong/i.test(m.subject)) {
      // "Kamu baru saja melakukan penarikan sebesar Rp5.000.000 dari Kantong Dana Darurat."
      const s = m.text.replace(/\s+/g, ' ');
      const x = s.match(/(penarikan|penambahan|pemindahan|memindahkan|menabung)[^.]*?Rp\s?([\d.,]+)\s+(dari|ke)\s+Kantong\s+([^.]+?)\s*\./i);
      if (!x) return skip('Kantong email without an amount');
      const pocket = x[4].trim();
      const fromPocket = x[3].toLowerCase() === 'dari';
      // No timestamp in the body: use the email's own time (WIB).
      const when = wibFromEpoch(m.epochMs);
      return ok({
        type: 'transfer', direction: 'out', ...when, amount: amountOf(x[2]), fee: 0,
        account: fromPocket ? { institution: 'Jago', pocket } : { institution: 'Jago' },
        counterparty: fromPocket ? { name: 'Jago', institution: 'Jago' } : { name: `Kantong ${pocket}`, institution: 'Jago', pocket },
        description: fromPocket ? `Dari Kantong ${pocket}` : `Ke Kantong ${pocket}`, details: 'Kantong', refNo: '',
      });
    }
    return skip('not a transaction email');
  },
};

export const sekuritas = {
  id: 'sekuritas',
  matches: (m) => /@mandirisekuritas\.co\.id$/i.test(m.from),
  parse(m) {
    if (!/pembayaran dividen/i.test(m.subject)) return skip('not a dividend payment');
    const s = m.text.replace(/\s+/g, ' ');
    const net = s.match(/Dividen Bersih \(Rp\)\s*([\d.,]+)/i) || s.match(/Net Dividend \(Rp\)\s*([\d.,]+)/i);
    if (!net) throw new Error('no net dividend amount');
    const paid = s.match(/dibayarkan ke RDN\s*\/?\s*MTBI pada tanggal\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i);
    const when = (paid && parseDateTime(paid[1])) || { date: wibFromEpoch(m.epochMs).date, time: '' };
    const ticker = (m.subject.match(/\(([A-Z]{4})\)/) || [])[1] || '';
    return ok({
      type: 'dividend', direction: 'in', date: when.date, time: '', amount: amountOf(net[1]), fee: 0,
      account: { institution: 'Mandiri Sekuritas' }, counterparty: { name: ticker ? `Dividen ${ticker}` : 'Dividen' },
      description: ticker ? `Dividen ${ticker}` : 'Dividen tunai', details: 'RDN', refNo: '',
    });
  },
};

export const gopay = {
  id: 'gopay',
  matches: (m) => /@customers\.go-pay\.co\.id$/i.test(m.from),
  parse(m) {
    const which = m.subject.match(/pengeluaranmu di ([A-Za-z]+)/i);
    if (!which) return skip('not a monthly summary');
    const month = monthNumber(which[1]);
    if (!month) throw new Error(`unknown month "${which[1]}"`);
    const sent = wibFromEpoch(m.epochMs);
    const sentYear = Number(sent.date.slice(0, 4));
    const year = month > Number(sent.date.slice(5, 7)) ? sentYear - 1 : sentYear;
    const s = m.text.replace(/\s+/g, ' ');
    const out = s.match(/Pengeluaran\s*-\s*Rp\s?([\d.,]+)/i);
    const inn = s.match(/Pemasukan\s*\+\s*Rp\s?([\d.,]+)/i);
    if (!out && !inn) throw new Error('no totals in the summary');
    return ok({
      type: 'summary', direction: 'out', date: `${year}-${String(month).padStart(2, '0')}-01`, time: '',
      amount: out ? parseAmount(out[1]) : 0, income: inn ? parseAmount(inn[1]) : 0, fee: 0,
      account: { institution: 'GoPay' }, counterparty: { name: 'GoPay' },
      description: `Ringkasan GoPay ${which[1]} ${year}`, details: '', refNo: '',
    });
  },
};

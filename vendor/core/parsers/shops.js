// Shop receipts: what a bank charge was for. None of them adds a row; each names the bank's row
// for the same payment (see "receipt" in plan.js). Formats seen in the owner's inbox, Sep 2026.
//
//   Tokopedia      "Pesanan Selesai: …" (order completed: shop, items, "Total belanja"; comes days
//                  after paying) · "Menunggu Pembayaran Untuk <product>" (virtual-account payment)
//   Shopee         order emails with "RINCIAN PESANAN": order no., order date, seller, items, total
//   Xendit         "Order confirmation from <merchant>" (the bank only shows "Xendit 12345")
//   shops abroad   "<Shop> order #… Confirmed!" (foreign currency; blu notes the foreign amount)
//   MyMiniFactory  "Payment confirmation" (USD; blu notes the USD amount)
//   Optik Melawai  "Invoice" e-receipt: items and total (the bank row already names the store)
import { parseAmount, parseDateTime, wibFromEpoch } from '../money.js';
import { ok, skip } from './common.js';

/** Text on one line, without markdown links / bare URLs (some mail tools add them). */
const flat = (m) => m.text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<?https?:\/\/\S+>?/g, ' ').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
const sentOn = (m) => wibFromEpoch(m.epochMs).date;
const amountOrThrow = (raw, what) => {
  const v = parseAmount(raw || '');
  if (!(v > 0)) throw new Error(`no ${what}`);
  return v;
};
/** Up to 3 items, each short, "+N lainnya" for the rest. */
function summary(items) {
  const cut = (s) => (s.length > 70 ? `${s.slice(0, 67).trim()}…` : s);
  const shown = items.slice(0, 3).map((i) => cut(i.qty > 1 ? `${i.qty}× ${i.name}` : i.name));
  return [...shown, ...(items.length > 3 ? [`+${items.length - 3} lainnya`] : [])].join('; ');
}
const receipt = (fields) => ok({
  type: 'receipt', direction: 'out', time: '', fee: 0, account: { institution: fields.source }, counterparty: { name: fields.name || fields.source },
  description: fields.name || fields.source, details: '', ...fields,
});

export const tokopedia = {
  id: 'tokopedia',
  matches: (m) => /^noreply@tokopedia\.com$/i.test(m.from),
  parse(m) {
    const s = flat(m);
    if (/^Pesanan Selesai/i.test(m.subject)) {
      const t = m.tokens;
      const at = t.findIndex((x) => /^Toko\s*:/i.test(x));
      const inline = at >= 0 ? t[at].replace(/^Toko\s*:\s*/i, '') : '';
      const shop = inline || (at >= 0 ? t[at + 1] : '') || '';
      const items = [];
      for (let i = at + 1; at >= 0 && i < t.length && !/^Subtotal/i.test(t[i]); i += 1) {
        const q = String(t[i + 1] || '').match(/^(\d+)\s*x\b/i);
        if (q && t[i] !== shop) items.push({ name: t[i], qty: Number(q[1]) });
      }
      if (!items.length) {
        const first = (m.subject.match(/[“"](.+?)[”"]/) || [])[1];
        if (first) items.push({ name: first.replace(/\.{3}$/, '…'), qty: 1 });
      }
      const total = amountOrThrow((s.match(/Total belanja\s*(Rp\s?[\d.]+)/i) || [])[1], 'Total belanja');
      const invoice = (s.match(/No\.?\s?Invoice\s?:?\s?(\d{8,})/i) || [])[1] || '';
      return receipt({
        source: 'Tokopedia', date: sentOn(m), amount: total, refNo: invoice, name: shop || 'Tokopedia', what: summary(items),
        // The order-completed email comes after the payment (days, sometimes weeks).
        match: { pattern: 'TOKOPEDIA', from: -30, to: 0, waitDays: 1 },
      });
    }
    const waiting = m.subject.match(/^Menunggu Pembayaran Untuk (.+)$/i);
    if (waiting) {
      const total = amountOrThrow((s.match(/Total Pembayaran\s*(Rp\s?[\d.]+)/i) || [])[1], 'Total Pembayaran');
      return receipt({
        source: 'Tokopedia', date: sentOn(m), amount: total, name: waiting[1].trim(), what: 'Tokopedia',
        match: { pattern: 'TOKOPEDIA', from: 0, to: 2, waitDays: 3 },
      });
    }
    return skip('not an order receipt');
  },
};

export const shopee = {
  id: 'shopee',
  matches: (m) => /@mail\.shopee\.co\.id$/i.test(m.from),
  parse(m) {
    const s = flat(m);
    if (!/RINCIAN PESANAN/i.test(s) || !/Total Pembayaran/i.test(s)) return skip('not an order with details');
    const order = (s.match(/No\.? Pesanan\s?:?\s?#?([A-Z0-9]{8,})/i) || [])[1] || '';
    const d = s.match(/Tanggal Pemesanan\s?:?\s?(\d{2})\/(\d{2})\/(\d{4})/i);
    const seller = (s.match(/Penjual\s?:?\s?(\S+)/i) || [])[1] || '';
    // "1. Name Variasi: X Jumlah: 1": a 1-2 digit number after a space (not the "2026." of a date), a name without ":".
    const items = [...s.matchAll(/(?:^|\s)\d{1,2}\.\s([^:]+?)\s(?:Variasi\s?:\s?(.+?)\s)?Jumlah\s?:\s?(\d+)/gi)]
      .map((x) => ({ name: x[2] ? `${x[1]} (${x[2]})` : x[1], qty: Number(x[3]) }));
    const total = amountOrThrow((s.match(/Total Pembayaran\s?:?\s?(Rp\s?[\d.,]+)/i) || [])[1], 'Total Pembayaran');
    return receipt({
      source: 'Shopee', date: d ? `${d[3]}-${d[2]}-${d[1]}` : sentOn(m), amount: total, refNo: order, name: seller || 'Shopee', what: summary(items),
      match: { pattern: 'SHOPEE', from: 0, to: 2, waitDays: 4 },
    });
  },
};

export const xendit = {
  id: 'xendit',
  matches: (m) => /^notifications@xendit\.co$/i.test(m.from),
  parse(m) {
    const merchant = m.subject.match(/^Order confirmation from (.+)$/i);
    if (!merchant) return skip('not a payment confirmation');
    const s = flat(m);
    const total = amountOrThrow((s.match(/Total Amount Paid\s*(?:IDR|Rp)\s?([\d.,]+)/i) || [])[1], 'Total Amount Paid');
    const ref = (s.match(/Reference ID\s*(\S+)/i) || [])[1] || '';
    const orderNo = (s.match(/order number\s*#?(\w+)/i) || [])[1];
    return receipt({
      source: 'Xendit', date: sentOn(m), amount: total, refNo: ref, name: merchant[1].trim(), what: orderNo ? `order #${orderNo}` : '',
      match: { pattern: 'XENDIT', from: -1, to: 1, waitDays: 3 },
    });
  },
};

/**
 * Online shops abroad on the common "<Shop> order #123 Confirmed!" template ("Placed On:", then
 * "Qty: 1 Total: $179.95 AUD" per item). The shop's name and currency come from the email, so no
 * shop is named here; the bank row is the card charge whose description holds the shop's name.
 */
const shopOrder = {
  id: 'shop-order',
  matches: (m) => /^.+? order #\d+ Confirmed/i.test(m.subject),
  parse(m) {
    const [, shop, number] = m.subject.match(/^(.+?) order #(\d+) Confirmed/i);
    const s = flat(m);
    const at = s.search(/Placed On/i);
    const list = s.slice(at >= 0 ? at : 0).replace(/^Placed On:?\s?\S+\s?/i, '').split(/SHIPPING ADDRESS/i)[0];
    const items = [...list.matchAll(/(.+?)\s+Qty:\s?(\d+)\s+Total:\s?\$\s?[\d.,]+\s?[A-Z]{3}\s*/g)].map((x) => ({ name: x[1].trim(), qty: Number(x[2]) }));
    const total = s.match(/Shipping:[\s\S]*?Total:\s?\$\s?([\d.,]+)\s?([A-Z]{3})/i);
    if (!total) throw new Error('no order total');
    const name = shop.trim();
    return receipt({
      source: name, date: sentOn(m), amount: amountOrThrow(total[1], 'order total'), currency: total[2].toUpperCase(), refNo: `#${number}`, name, what: summary(items),
      match: { pattern: name.replace(/[^A-Za-z0-9]/g, '').toUpperCase(), from: -1, to: 1, waitDays: 3 }, recheck: false,
    });
  },
};

export const myminifactory = {
  id: 'myminifactory',
  matches: (m) => /@myminifactory\.com$/i.test(m.from),
  parse(m) {
    if (!/payment confirmation/i.test(m.subject)) return skip('not a payment confirmation');
    const s = flat(m).replace(/\s*\|\s*/g, ' · ');
    const ref = (s.match(/reference\s([A-Z0-9]{6,})/i) || [])[1] || '';
    const list = (s.split(/Sale Tax\)/i)[1] || '').split(/Subtotal/i)[0];
    const items = [...list.matchAll(/(\d+)\s(.+?)\s(\d+\.\d{2})\s(\d+\.\d{2})/g)].map((x) => ({ name: x[2].trim(), qty: Number(x[1]) }));
    const totals = [...s.matchAll(/\bTotal\s([\d.]+)/g)];
    const total = amountOrThrow(totals.length ? totals[totals.length - 1][1] : '', 'order total');
    return receipt({
      source: 'MyMiniFactory', date: sentOn(m), amount: total, currency: 'USD', refNo: ref, name: 'MyMiniFactory', what: summary(items),
      match: { pattern: 'MINI ?FACTORY', from: -1, to: 1, waitDays: 3 }, recheck: false,
    });
  },
};

const optikMelawai = {
  id: 'optik-melawai',
  matches: (m) => /@optikmelawai\.id$/i.test(m.from),
  parse(m) {
    if (!/invoice/i.test(m.subject)) return skip('not an invoice');
    const s = flat(m).replace(/\s*\|\s*/g, ' ').replace(/-{3,}/g, ' ').replace(/\s+/g, ' ');
    const invoice = (s.match(/No Invoice\s?:\s?(\S+)/i) || [])[1] || '';
    const when = parseDateTime((s.match(/Tanggal Pesanan\s?:?\s?(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i) || [])[1]);
    const list = (s.split(/Netto/i)[1] || '').split(/Sub Total/i)[0];
    const items = [...list.matchAll(/([A-Z][A-Z0-9 .&/-]*?)\s([\d,.]+)\s(\d+)\s([\d,.]+)\s([\d,.]+)(?=\s|$)/g)]
      .filter((x) => parseAmount(x[5]) > 0).map((x) => ({ name: x[1].trim(), qty: Number(x[3]) }));
    const total = amountOrThrow((s.match(/Total Belanja\s?:?\s?([\d.,]+)/i) || [])[1], 'Total Belanja');
    return receipt({
      source: 'Optik Melawai', date: when ? when.date : sentOn(m), amount: total, refNo: invoice, name: '', what: summary(items),
      match: { pattern: 'OPTIK ?MELAWAI', from: 0, to: 1, waitDays: 3 }, recheck: false,
    });
  },
};

export const SHOP_PARSERS = [tokopedia, shopee, xendit, shopOrder, myminifactory, optikMelawai];
/** Gmail searches for the receipts only (these shops also send promotions and login alerts). */
export const SHOP_QUERIES = [
  'from:noreply@tokopedia.com subject:("Pesanan Selesai" OR "Menunggu Pembayaran")',
  'from:info@mail.shopee.co.id subject:Pesanan',
  'from:notifications@xendit.co subject:"Order confirmation"',
  'subject:(order Confirmed) "Placed On"',
  'from:no-reply@myminifactory.com subject:"Payment confirmation"',
  'from:e-receipt@optikmelawai.id',
];

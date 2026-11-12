// Apple receipts ("Your receipt from Apple."). Not a money movement: the bank already recorded
// the charge as "APPLE.COM/BILL". The receipt says what it was (app, item, subscription), and
// the planner writes that onto the matching bank row so each Apple charge can be told apart.
//
// Two layouts seen (2026):
//   older:  <span class="title">App</span> <span class="artist">Item</span> <span class="type">In-App Purchase</span>,
//           price in a "price-cell", the whole receipt twice (desktop + mobile copy)
//   newer:  <tr class="subscription-lockup"> with <p>App</p><p>Item</p><p>Renews 5 November 2026</p> … <p>Rp 19.000</p>
import { parseDateTime, parseAmount } from '../money.js';
import { decodeEntities } from '../text.js';
import { ok, skip } from './common.js';

const strip = (html) => decodeEntities(String(html).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const texts = (html, tag) => [...String(html).matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'))].map((m) => strip(m[1])).filter(Boolean);
const PRICE = /^Rp\s?[\d.,]+$/i;
const RENEWS = /^(Renews|Diperpanjang|Berlaku hingga|Expires)\b/i;

function olderItems(html) {
  // Cut at the mobile copy's element (its class also appears earlier, in the <style> block).
  const desktop = html.split(/class="aapl-mobile-div"/i)[0];
  const field = (cls) => [...desktop.matchAll(new RegExp(`class="${cls}"[^>]*>([\\s\\S]*?)</span>`, 'gi'))].map((m) => strip(m[1]));
  const titles = field('title');
  const items = field('artist');
  const types = field('type');
  const prices = [...desktop.matchAll(/class="price-cell"[\s\S]*?(Rp\s?[\d.,]+)/gi)].map((m) => m[1]);
  return titles.map((app, i) => ({ app, item: items[i] || '', kind: types[i] || '', renews: '', price: parseAmount(prices[i] || '') || 0 }));
}

function newerItems(html) {
  return [...html.matchAll(/<tr[^>]*class="[^"]*lockup[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => {
    const ps = texts(m[1], 'p');
    const price = ps.find((p) => PRICE.test(p)) || '';
    const words = ps.filter((p) => !PRICE.test(p));
    const renews = words.find((p) => RENEWS.test(p)) || '';
    const [app = '', item = ''] = words.filter((p) => p !== renews);
    return { app, item, kind: renews ? 'Subscription' : '', renews, price: parseAmount(price) || 0 };
  });
}

export const apple = {
  id: 'apple',
  matches: (m) => /^no_reply@email\.apple\.com$/i.test(m.from),
  parse(m) {
    if (!/receipt|tanda terima|kuitansi/i.test(m.subject)) return skip('not a receipt');
    const html = String(m.body || '');
    const items = (/class="title"/i.test(html) ? olderItems(html) : newerItems(html)).filter((i) => i.app);
    if (!items.length) throw new Error('no items in the Apple receipt');
    const text = m.text.replace(/\s+/g, ' ');
    const order = (text.match(/Order ID:?\s*([A-Z0-9]{8,})/i) || [])[1] || '';
    const dateRaw = (text.match(/INVOICE DATE\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i) || text.match(/Receipt\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i) || [])[1];
    const when = parseDateTime(dateRaw);
    if (!when) throw new Error('no receipt date');
    const totalRaw = (text.match(/TOTAL\s+(Rp\s?[\d.,]+)/i) || [])[1];
    const total = parseAmount(totalRaw || '') || items.reduce((s, i) => s + i.price, 0);
    if (!(total > 0)) throw new Error('no total in the Apple receipt');
    const name = [...new Set(items.map((i) => i.app))].join(', ');
    return ok({
      type: 'receipt', source: 'Apple', direction: 'out', date: when.date, time: '', amount: total, fee: 0,
      account: { institution: 'Apple' }, counterparty: { name: 'Apple' },
      // The card charge (APPLE.COM/BILL) lands from a day before to 3 days after the receipt date.
      match: { pattern: 'APPLE\\.COM', from: -1, to: 3, waitDays: 4 },
      name, description: name, details: '', refNo: order, items,
      what: items.map((it) => [it.item, it.renews ? it.renews.replace(/^Renews/, 'renews') : it.kind].filter(Boolean).join(', ')).join('; '),
      subscription: items.some((it) => it.renews || /subscription|langganan/i.test(it.kind)),
    });
  },
};

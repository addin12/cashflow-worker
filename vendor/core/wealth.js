// What you own and owe beyond bank accounts (property, vehicle, gold, stocks, crypto, collectibles,
// debts), planned recurring transactions, and money friends owe you ("Tagih"). Pure functions.

export const ASSET_KINDS = ['property', 'vehicle', 'gold', 'stock', 'fund', 'bond', 'deposit', 'pension', 'crypto', 'goods', 'collectible', 'receivable', 'other', 'debt', 'paylater'];
const DEBT_KINDS = new Set(['debt', 'paylater']);
// Stock codes: IDX:BBCA, or just BBCA (an IDX stock), or EXCHANGE:CODE elsewhere (NASDAQ:AAPL).
export const TICKER = /^(?:[A-Z]{2,10}:)?[A-Z0-9.-]{1,15}$/;

/**
 * Where to look a ticker up. Google Sheets' GOOGLEFINANCE() doesn't know IDX stocks, so the script
 * asks Yahoo Finance (BBCA.JK) and, failing that, reads Google Finance's quote page (BBCA:IDX).
 */
export function priceSymbols(ticker) {
  const t = String(ticker || '').trim().toUpperCase();
  if (!TICKER.test(t)) return null;
  const [ex, sym] = t.includes(':') ? t.split(':') : ['IDX', t];
  return ex === 'IDX' ? { yahoo: `${sym}.JK`, google: `${sym}:IDX` } : { yahoo: sym, google: `${sym}:${ex}` };
}

/**
 * harga-emas.org's page -> Antam's buyback price per gram ("Harga pembelian kembali: Rp2.443.500/grm"),
 * what gold is worth if you sell it. NaN when the page doesn't have it.
 */
export function goldFromHargaEmas(html) {
  const text = String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const m = text.match(/pembelian kembali:?\s*Rp\s?([\d.]+)/i);
  const v = m ? Number(m[1].replace(/\./g, '')) : NaN;
  return v > 0 ? v : NaN;
}

/**
 * The text of Config price_status ("2026-10-19 09:59 UTC: 0 of 1 priced; harga-emas.org HTTP 403") as numbers.
 * failed: how many prices were asked for and not found.
 */
export function parsePriceStatus(text) {
  const m = String(text || '').match(/^(\S+ \S+) UTC: (\d+) of (\d+) priced(?:; (.*))?$/);
  if (!m) return null;
  const [n, tried] = [Number(m[2]), Number(m[3])];
  return { at: m[1], n, tried, failed: Math.max(0, tried - n), reasons: m[4] ? m[4].split('; ') : [] };
}

/** Yahoo Finance chart JSON -> the latest price (NaN when missing). */
export function priceFromYahoo(json) {
  const v = Number(json && json.chart && json.chart.result && json.chart.result[0] && json.chart.result[0].meta && json.chart.result[0].meta.regularMarketPrice);
  return v > 0 ? v : NaN;
}

/** Google Finance quote page -> its price ("Rp5,275" or "$227.50"; the first one on the page). NaN when none. */
export function priceFromGooglePage(html) {
  const m = String(html || '').match(/(?:Rp|\$)\s?(\d{1,3}(?:,\d{3})*(?:\.\d+)?)/);
  const v = m ? Number(m[1].replace(/,/g, '')) : NaN;
  return v > 0 ? v : NaN;
}

const num = (v) => Number(v) || 0;
const round2 = (v) => Math.round(v * 100) / 100;

/** Value of one item: quantity × market price (when the sheet has one) or the value you entered. */
export function assetValue(a) {
  const price = Number(a.price);
  const each = Number.isFinite(price) && price > 0 ? price : num(a.unit_value);
  return round2((num(a.qty) || 1) * each);
}

/** Net worth: accounts + assets + collectibles − debts, with each part and each item's value. */
export function netWorth(balances, assets) {
  const accounts = round2(balances.reduce((t, b) => t + num(b.balance), 0));
  const items = assets.map((a) => ({ ...a, value: assetValue(a), gain: a.kind === 'collectible' && num(a.paid) ? round2(assetValue(a) - num(a.paid)) : null }));
  const sum = (f) => round2(items.filter(f).reduce((t, a) => t + a.value, 0));
  const owned = sum((a) => !DEBT_KINDS.has(a.kind) && a.kind !== 'collectible');
  const collectibles = sum((a) => a.kind === 'collectible');
  const debts = sum((a) => DEBT_KINDS.has(a.kind));
  // Each kind's total, for the breakdown on the Summary.
  const byKind = {};
  for (const a of items) byKind[a.kind] = Math.round(((byKind[a.kind] || 0) + a.value) * 100) / 100;
  return { accounts, owned, collectibles, debts, total: round2(accounts + owned + collectibles - debts), items, byKind };
}

/** Problems with the assets list (empty = fine). */
export function assetProblems(list) {
  const out = [];
  list.forEach((a, i) => {
    const n = `item ${i + 1}`;
    if (!String(a.name || '').trim()) out.push(`${n}: name is required`);
    if (!ASSET_KINDS.includes(a.kind)) out.push(`${n}: unknown kind ${a.kind}`);
    if (a.ticker && !TICKER.test(a.ticker)) out.push(`${n}: ticker must look like BBCA or IDX:BBCA`);
    if (!(num(a.unit_value) > 0) && !(a.ticker && TICKER.test(a.ticker)) && a.kind !== 'gold') out.push(`${n}: enter a value`);
    if (a.qty !== '' && a.qty != null && !(Number(a.qty) > 0)) out.push(`${n}: quantity must be above 0`);
    if (a.warranty && !/^\d{4}-\d{2}-\d{2}$/.test(String(a.warranty))) out.push(`${n}: warranty must be a date`);
  });
  return out;
}

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** The day of a plan in month 'YYYY-MM' (a day the month lacks becomes its last day). */
export const planDate = (month, day) => {
  const [y, m] = month.split('-').map(Number);
  return isoOf(new Date(y, m - 1, Math.min(Number(day) || 1, new Date(y, m, 0).getDate())));
};

/**
 * Planned transactions due by `today` and not made yet for their month (checked by ref_no
 * "plan:<id>:<YYYY-MM>", so running twice adds nothing). A plan starts the month after `last`.
 * @returns {{plan, month, date}[]}
 */
export function duePlans(plans, rows, today) {
  const t = isoOf(today);
  const month = t.slice(0, 7);
  const made = new Set(rows.map((r) => String(r.ref_no || '')).filter((r) => r.startsWith('plan:')));
  return plans.filter((p) => String(p.active) !== 'false' && p.active !== false)
    .filter((p) => !p.last || String(p.last) < month)
    .map((p) => ({ plan: p, month, date: planDate(month, p.day) }))
    .filter((x) => x.date <= t && !made.has(`plan:${x.plan.id}:${x.month}`));
}

/**
 * Bills in the next `days` days: planned transactions (money out), expected subscriptions and card
 * bills still to pay (`cards`, from cards.js), soonest first, one per name.
 */
export function upcomingBills(plans, recurringItems, today, days = 7, cards = []) {
  const t = isoOf(today);
  const dayNo = (iso) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
  const month = t.slice(0, 7);
  const next = isoOf(new Date(today.getFullYear(), today.getMonth() + 1, 1)).slice(0, 7);
  const out = [];
  for (const p of plans) {
    if (String(p.active) === 'false' || p.active === false || p.direction === 'in') continue;
    const date = [planDate(month, p.day), planDate(next, p.day)].find((d) => d >= t && String(p.last || '') < d.slice(0, 7));
    if (date && dayNo(date) <= days) out.push({ name: p.name, amount: num(p.amount), date, daysLeft: dayNo(date), kind: 'plan' });
  }
  for (const i of recurringItems) {
    if (i.daysLeft >= 0 && i.daysLeft <= days) out.push({ name: i.name, amount: num(i.amount), date: i.nextDate, daysLeft: i.daysLeft, kind: 'sub' });
  }
  for (const c of cards) {
    if (c.left > 0 && c.daysLeft >= 0 && c.daysLeft <= days) out.push({ name: c.stream, amount: num(c.left), date: c.dueDate, daysLeft: c.daysLeft, kind: 'card' });
  }
  const seen = new Set();
  return out.sort((a, b) => a.daysLeft - b.daysLeft || b.amount - a.amount).filter((b) => { const k = b.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

const EMERGENCY = /darurat|emergency/i;
/**
 * Three plain checks, each 'good' | 'ok' | 'low' (null when there's not enough to say):
 *   months   how long the emergency fund (an account or savings goal named "Dana Darurat") lasts
 *            at the average spending of the last three months
 *   saving   the share of this month's income not spent
 *   debt     debts (and accounts below zero, e.g. a credit card) against everything owned
 * @param {{balances: {stream, balance}[], goals?: {name, saved}[], trend: {month, expense}[], month: string,
 *   summary: {income, expense}, wealth?: {owned, collectibles, debts} | null}} input
 */
export function financialHealth({ balances, goals = [], trend, month, summary, wealth = null }) {
  const level = (v, good, ok) => (v == null ? null : v >= good ? 'good' : v >= ok ? 'ok' : 'low');
  const fundAccounts = balances.filter((b) => EMERGENCY.test(b.stream));
  const fundGoal = goals.find((g) => EMERGENCY.test(g.name));
  const fund = fundAccounts.length ? fundAccounts.reduce((t, b) => t + num(b.balance), 0) : fundGoal ? num(fundGoal.saved) : null;
  const past = trend.filter((t) => t.month < month && num(t.expense) > 0).slice(-3);
  const monthly = past.length ? past.reduce((t, x) => t + num(x.expense), 0) / past.length : 0;
  const months = fund != null && monthly > 0 ? Math.round((fund / monthly) * 10) / 10 : null;
  const saving = num(summary.income) > 0 ? Math.round(((num(summary.income) - num(summary.expense)) / num(summary.income)) * 100) / 100 : null;
  const negative = balances.reduce((t, b) => t + Math.max(0, -num(b.balance)), 0);
  const debts = (wealth ? num(wealth.debts) : 0) + negative;
  const owned = balances.reduce((t, b) => t + Math.max(0, num(b.balance)), 0) + (wealth ? num(wealth.owned) + num(wealth.collectibles) : 0);
  const debt = owned > 0 ? Math.round((debts / owned) * 100) / 100 : debts > 0 ? 1 : 0;
  return {
    fund, monthly: round2(monthly), months, monthsLevel: level(months, 6, 3),
    saving, savingLevel: level(saving, 0.2, 0), debts: round2(debts), debt, debtLevel: debt <= 0.3 ? 'good' : debt <= 0.5 ? 'ok' : 'low',
  };
}

/**
 * What an amount earns over `months`: a time deposit (interest taxed 20%, none when the deposit is
 * Rp7,5 jt or less: PMK 212/PMK.03/2018) against government bonds, SBN (coupon taxed 10%: PP 91/2021).
 * Checked against press and tax-site summaries on 2026-11-02, not the regulation text; the UI tells people to
 * check current rules. Rates are yearly percentages; a missing rate gives null for that side.
 */
export function interestCompare({ amount, months = 1, depositRate, sbnRate }) {
  const a = num(amount);
  const one = (rate, tax) => {
    if (!(num(rate) > 0) || !(a > 0)) return null;
    const gross = a * (num(rate) / 100) * (num(months) / 12);
    return { gross: round2(gross), tax: round2(gross * tax), net: round2(gross * (1 - tax)), perMonth: round2((gross * (1 - tax)) / Math.max(1, num(months))) };
  };
  return { deposit: one(depositRate, a > 7500000 ? 0.2 : 0), sbn: one(sbnRate, 0.1) };
}

/** Warranties ending within `days` days (not already over), the nearest first. */
export function warrantyEnds(assets, today, days = 60) {
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return assets.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(String(a.warranty || '')) && !DEBT_KINDS.has(a.kind))
    .map((a) => ({ name: a.name, date: String(a.warranty), daysLeft: Math.round((Date.UTC(+a.warranty.slice(0, 4), +a.warranty.slice(5, 7) - 1, +a.warranty.slice(8, 10)) - t) / 86400000) }))
    .filter((w) => w.daysLeft >= 0 && w.daysLeft <= days)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

/** Money owed to you, open ones first, with the total still open. */
export function owedSummary(owed) {
  const open = owed.filter((o) => o.status !== 'paid');
  return { open, total: round2(open.reduce((t, o) => t + num(o.amount), 0)), paid: owed.filter((o) => o.status === 'paid') };
}

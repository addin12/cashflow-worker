// Yearly subscriptions, found by reading receipts further back in Gmail than the start date
// (gas/yearly.js reads them; nothing is added as a transaction). A yearly plan is only charged
// once a year, so the app's own months of data can't show it.

import { cmp } from './order.js';
import { payee, renewsOn } from './recurring.js';

const DAY = 86400000;
const toDay = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d); };
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const addYear = (isoDate) => { const [y, m, d] = isoDate.split('-').map(Number); return iso(Date.UTC(y + 1, m - 1, Math.min(d, new Date(Date.UTC(y + 1, m, 0)).getUTCDate()))); };

/** Names of things usually paid for by the year: apps, cloud storage, domains, memberships, insurance. */
export const YEARLY_WORDS = /apple|icloud|google|youtube|spotify|netflix|disney|vidio|prime|canva|adobe|microsoft|office|dropbox|notion|chatgpt|openai|claude|anthropic|domain|hosting|niagahoster|cloudflare|github|duolingo|asuransi|insurance|membership|premium|pro plan|tahunan|annual|yearly/i;

/**
 * The Gmail search for payments that may be yearly plans (a year and a bit back): bank emails
 * naming a usual subscription, and app-store receipts.
 */
export function yearlyQuery(senders, afterSec) {
  const words = 'apple OR icloud OR google OR youtube OR spotify OR netflix OR disney OR vidio OR canva OR adobe OR microsoft OR dropbox OR notion OR openai OR chatgpt OR claude OR domain OR hosting OR niagahoster OR asuransi';
  return `((from:(${senders.join(' OR ')}) (${words})) OR (from:no_reply@email.apple.com subject:receipt)) after:${afterSec}`;
}

/**
 * @param {{date, amount, description, details}[]} charges  money-out events read from old receipts
 * @param {{today: Date}} opts
 * @returns {{key, name, amount, lastDate, nextDate, guess}[]}  plans renewing in the coming year; guess: no receipt said when
 */
export function findYearly(charges, { today }) {
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const groups = new Map();
  for (const c of charges) {
    const k = payee(c.description);
    if (!k || !(Number(c.amount) > 0)) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ ...c, date: String(c.date).slice(0, 10), amount: Number(c.amount) });
  }
  const out = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => cmp(a.date, b.date));
    const last = list[list.length - 1];
    const gaps = list.slice(1).map((r, i) => (toDay(r.date) - toDay(list[i].date)) / DAY);
    if (gaps.some((g) => g < 300)) continue; // charged more often than yearly
    const renews = renewsOn(last.details);
    let next = '';
    if (renews && toDay(renews) - toDay(last.date) >= 300 * DAY) next = renews;
    else if (!renews && YEARLY_WORDS.test(last.description) && now - toDay(last.date) >= 45 * DAY) next = addYear(last.date);
    if (!next || toDay(next) < now - 30 * DAY || toDay(next) > now + 400 * DAY) continue;
    out.push({ key, name: last.description, amount: last.amount, lastDate: last.date, nextDate: next, guess: !renews });
  }
  return out.sort((a, b) => cmp(a.nextDate, b.nextDate));
}

/**
 * The stored plans after `by` scanned: theirs are replaced by `found`, the other person's stay. Plans stored
 * before there were two people have no `by` and belong to `firstPerson`.
 */
export function mergeYearly(stored, found, { by, firstPerson }) {
  const keep = stored.filter((p) => (p.by || firstPerson) !== by);
  const have = new Set(keep.map((p) => p.key));
  return [...keep, ...found.filter((f) => !have.has(f.key)).map((f) => ({ ...f, by }))];
}

/**
 * Yearly plans as subscription items: a charge seen since (from 30 days before the renewal date)
 * means it renewed, and the next renewal is a year later.
 */
export function yearlyItems(found, rows, { today, hidden = [] }) {
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const hide = new Set(hidden.map(payee));
  return found.filter((f) => !hide.has(f.key)).map((f) => {
    let { lastDate, nextDate, amount } = f;
    const seen = rows.filter((r) => r.direction === 'out' && r.status !== 'ignored' && payee(r.description) === f.key)
      .map((r) => ({ date: String(r.date).slice(0, 10), amount: Number(r.amount) || 0 })).sort((a, b) => cmp(a.date, b.date));
    for (const r of seen) {
      if (toDay(r.date) >= toDay(nextDate) - 30 * DAY) { lastDate = r.date; amount = r.amount; nextDate = addYear(r.date); }
    }
    return { key: f.key, name: f.name, amount, category: '', stream: '', lastDate, nextDate, basis: f.guess ? 'yearly-guess' : 'yearly', cycle: 'year', daysLeft: Math.round((toDay(nextDate) - now) / DAY), change: '' };
  }).filter((i) => i.daysLeft >= -45);
}

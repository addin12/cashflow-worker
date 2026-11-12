// The calendar feed: each person's bills, subscriptions, card due dates, claims, warranties and payday for the next 45 days as an .ics file that
// Google Calendar (or any calendar app) subscribes to by a secret address. No Google permission is involved: the file is built here from the
// app's own data (the same events as the Apps Script sync, see vendor/core/calevents.js) and stored; the small `cashflow-feed` Worker serves it.
import { calendarEvents } from '../vendor/core/calevents.js';
import { TABS } from '../vendor/core/schema.js';
import { cuts } from './app.js';
import { personOf } from './identity.js';
import { openUnit } from './unit.js';

export const FEED_TAB = 'feed';
const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|[\r\n\v\u0085\u2028\u2029]/g, '\\n');
const compact = (iso) => iso.replace(/-/g, '');

/** A line folded to 75 octets as RFC 5545 asks (by whole characters: an emoji is never cut in half). */
export function fold(line) {
  const enc = new TextEncoder();
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

// A short stable hash, so an event keeps its UID from one rebuild to the next.
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

/** @param {string[]} keys  "YYYY-MM-DD|title" as calendarEvents gives them */
export function toIcs(keys, { name = 'Cashflow', stamp = new Date(), lang = 'id' } = {}) {
  const dtstamp = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cashflow//Feed//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(name)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H'];
  for (const k of keys) {
    const date = k.slice(0, 10);
    const title = k.slice(11);
    const next = new Date(Date.parse(`${date}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
    lines.push('BEGIN:VEVENT', `UID:${date}-${hash(title)}@cashflow`, `DTSTAMP:${dtstamp}`, `DTSTART;VALUE=DATE:${compact(date)}`, `DTEND;VALUE=DATE:${compact(next)}`,
      `SUMMARY:${esc(title)}`, 'TRANSP:TRANSPARENT', 'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(title)}`, 'TRIGGER:-PT15H', 'END:VALARM', 'END:VEVENT'); // 09:00 the day before
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/** The household's two people: { owner, partner } with their name and the email the app knows them by (the partner only when there is one). */
export function householdPeople(cfg) {
  const first = (v) => String(v || '').split(',')[0].trim().toLowerCase();
  const people = {};
  const o = personOf(cfg, first(cfg.owner_email));
  if (o) people.owner = o;
  const p = cfg.partner_name ? personOf(cfg, first(cfg.partner_email)) : null;
  if (p) people.partner = p;
  return people;
}

/** Builds one person's feed and stores it. `who` is 'owner' or 'partner'. Returns the number of events (0 when that person does not exist). */
export async function buildFeed(db, who, { now = () => new Date() } = {}) {
  const c = cuts(now());
  const cfgRows = (await db.prepare("SELECT key, value FROM config WHERE key IN ('owner_name','owner_email','partner_name','partner_email')").all()).results;
  const people = householdPeople(Object.fromEntries(cfgRows.map((r) => [r.key, r.value])));
  const person = people[who];
  if (!person) return 0;
  const unit = await openUnit(db, c.bills, { rules: false, now, who: () => person });
  const { store } = unit;
  const d = unit.api.dashboard({ part: 'bills' });
  const wib = new Date(now().getTime() + 7 * 3600000); // the date in Jakarta
  const today = new Date(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate());
  const key = (base) => (who === 'owner' ? base : `partner_${base}`);
  const keys = calendarEvents({
    plans: store.read(TABS.plans), recurringItems: d.recurring.items, cards: d.cards || [], today, lang: String(store.config('language') || 'id'),
    payday: Number(store.config(key('payday_day'))) || Number(store.config('payday_day')) || 28, claims: d.claims || [], warranties: d.warranties || [],
  }).sort();
  const ics = toIcs(keys, { name: `Cashflow · ${person.name}`, stamp: now() });
  await db.batch([
    db.prepare('DELETE FROM tabs WHERE tab = ?1 AND id = ?2').bind(FEED_TAB, who),
    db.prepare('INSERT INTO tabs (tab, id, json) VALUES (?1, ?2, ?3)').bind(FEED_TAB, who, JSON.stringify({ ics, events: keys.length, at: now().getTime() })),
  ]);
  return keys.length;
}

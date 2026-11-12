// The events a person's calendar should hold (bills, subscriptions, card due dates, yearly renewals, claims, warranties, payday for the next 45 days).
// Pure: the Google Calendar sync (gas/calendar.js) and the Cloudflare app's calendar feed both build their events here.

import { upcomingBills } from './wealth.js';
import { nextPayday } from './payday.js';

export const CAL_DAYS = 45;
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const rp = (n) => `Rp${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0))}`;

/** The events the calendar should hold: key "YYYY-MM-DD|title". */
export function calendarEvents({ plans, recurringItems, cards, payday, today, lang = 'id', claims = [], warranties = [] }) {
  const out = new Map();
  for (const b of upcomingBills(plans, recurringItems, today, CAL_DAYS, cards)) out.set(`${b.date}|${b.name} · ${rp(b.amount)}`, true);
  for (const c of claims) if (c.daysLeft >= 0 && c.daysLeft <= CAL_DAYS) out.set(`${c.due}|${lang === 'en' ? 'Claim deadline' : 'Batas klaim'} · ${c.description} ${rp(c.amount)}`, true);
  for (const w of warranties) if (w.daysLeft <= CAL_DAYS) out.set(`${w.date}|${lang === 'en' ? 'Warranty ends' : 'Garansi habis'} · ${w.name}`, true);
  let p = nextPayday(today, payday);
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + CAL_DAYS);
  for (let i = 0; i < 2 && p <= end; i += 1) {
    out.set(`${iso(p)}|💼 ${lang === 'en' ? 'Payday' : 'Gajian'}`, true);
    p = nextPayday(p, payday);
  }
  return [...out.keys()];
}

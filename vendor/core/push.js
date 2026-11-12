// Phone notifications (web push). The app's own site (private/push.json → site) holds the service
// worker and a small function that encrypts and sends; this script decides what to say and when.
// A phone joins through the site's /notifikasi page, which hands its subscription back to the web
// app with a one-time code (Config push_nonce), so a link from someone else can't add a device.

const num = (v) => Number(v) || 0;
const rp = (n) => `Rp${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.round(num(n)))}`;

// Only the browsers' own push services are accepted as endpoints.
const PUSH_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(fcm\.googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com)\//i;

/** A subscription as the site sent it (JSON text), checked; null when it isn't a valid one. */
export function parseSubscription(text) {
  let s;
  try { s = JSON.parse(String(text || '')); } catch (e) { return null; }
  if (!s || typeof s.endpoint !== 'string' || s.endpoint.length > 1000 || !PUSH_HOSTS.test(s.endpoint)) return null;
  const k = s.keys || {};
  if (!/^[A-Za-z0-9_-]{40,200}={0,2}$/.test(String(k.p256dh || '')) || !/^[A-Za-z0-9_-]{8,100}={0,2}$/.test(String(k.auth || ''))) return null;
  return { endpoint: s.endpoint, keys: { p256dh: k.p256dh, auth: k.auth } };
}

/** Same length and same characters, in time that doesn't depend on where they differ. */
export function safeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

/** The device list with this one first (one entry per endpoint, at most 5 devices a person). */
export function addDevice(list, sub, label, at, owner = '') {
  const mine = (d) => (d.owner || '') === owner;
  const next = [{ ...sub, label: String(label || '').slice(0, 40), at, owner }, ...list.filter((d) => d.endpoint !== sub.endpoint)];
  const seen = new Map();
  return next.filter((d) => { const n = seen.get(d.owner || '') || 0; seen.set(d.owner || '', n + 1); return n < 5 || !mine(d); });
}

/**
 * The devices that should get a notification.
 * @param {{endpoint, keys, owner?: string}[]} devices  owner: who joined it ('' = the first person, before there were two)
 * @param {{defaultOwner: string, only?: string, event?: string, eventsOf: (name: string) => string[]}} opts
 *   only: just that person's devices; event: skip people who have that event switched off
 */
export function pushTargets(devices, { defaultOwner, only = '', event = '', eventsOf }) {
  return devices.filter((d) => {
    const who = d.owner || defaultOwner;
    return (!only || who === only) && (!event || eventsOf(who).includes(event));
  });
}

/** What can send a notification; all but the 21:00 reminder are on by default. */
export const PUSH_EVENTS = ['new', 'big', 'bills', 'payday', 'close'];
const DEFAULT_EVENTS = ['new', 'big', 'bills', 'payday'];
export function pushEventsOf(value) {
  const v = String(value ?? '').trim();
  if (!v) return DEFAULT_EVENTS;
  return v === 'none' ? [] : v.split(',').map((s) => s.trim()).filter((s) => PUSH_EVENTS.includes(s));
}

const T = {
  id: {
    big: 'Pengeluaran besar', one: 'Transaksi baru', many: (n) => `${n} transaksi baru`, more: (n) => `+${n} lagi`,
    bills: 'Tagihan besok', payday: 'Hari gajian', paydayBody: 'Catat gajimu dan cek saldo rekening.',
    close: 'Tutup hari', closeBody: 'Ada pengeluaran tunai hari ini? Catat, lalu tutup harinya.', test: 'Notifikasi Cashflow aktif', testBody: 'Begini tampilan pemberitahuan dari aplikasi.',
  },
  en: {
    big: 'Big spending', one: 'New transaction', many: (n) => `${n} new transactions`, more: (n) => `+${n} more`,
    bills: 'Bills due tomorrow', payday: 'Payday', paydayBody: 'Record your salary and check your balances.',
    close: 'Close the day', closeBody: 'Any cash spending today? Log it, then close the day.', test: 'Cashflow notifications are on', testBody: 'This is how the app tells you things.',
  },
};
const t = (lang) => T[lang] || T.id;
const lines = (list, fmt, lang) => [...list.slice(0, 3).map(fmt), ...(list.length > 3 ? [t(lang).more(list.length - 3)] : [])].join('\n');
const rowLine = (r) => `${r.description || r.details || '?'} ${r.direction === 'in' ? '+' : '−'}${rp(r.amount)}${r.stream ? ` · ${r.stream}` : ''}`;

/**
 * New rows from a sync: big spending first (when that event is on), else every new row (when "new" is on).
 * @returns {{title, body, url, tag} | null}
 */
export function newRowsNotice(rows, { bigAmount = 0, events = DEFAULT_EVENTS, lang = 'id' } = {}) {
  const list = rows.filter((r) => r && r.status !== 'ignored' && num(r.amount) > 0);
  const big = events.includes('big') && bigAmount > 0 ? list.filter((r) => r.direction === 'out' && num(r.amount) >= bigAmount) : [];
  const shown = big.length ? big : events.includes('new') ? list : [];
  if (!shown.length) return null;
  return {
    title: big.length ? t(lang).big : shown.length === 1 ? t(lang).one : t(lang).many(shown.length),
    body: lines(shown, rowLine, lang), url: shown.some((r) => r.status === 'pending') ? '/cek' : '/transaksi', tag: big.length ? 'big' : 'new',
  };
}
/** Insurance claims whose deadline is near (the list is already limited to those). */
export const claimsNotice = (claims, lang = 'id') => (claims.length ? {
  title: lang === 'en' ? 'Insurance claim deadline' : 'Batas klaim asuransi',
  body: lines(claims, (c) => `${c.description} ${rp(c.amount)} · ${lang === 'en' ? (c.daysLeft === 0 ? 'today' : `in ${c.daysLeft} days`) : (c.daysLeft === 0 ? 'hari ini' : `${c.daysLeft} hari lagi`)}`, lang),
  url: '/ringkasan', tag: 'claims',
} : null);
export const warrantyNotice = (list, lang = 'id') => (list.length ? {
  title: lang === 'en' ? 'Warranty ending' : 'Garansi segera habis',
  body: lines(list, (w) => `${w.name} · ${lang === 'en' ? (w.daysLeft === 0 ? 'today' : `in ${w.daysLeft} days`) : (w.daysLeft === 0 ? 'hari ini' : `${w.daysLeft} hari lagi`)}`, lang),
  url: '/ringkasan', tag: 'warranty',
} : null);
export const billsNotice = (bills, lang = 'id') => (bills.length ? { title: t(lang).bills, body: lines(bills, (b) => `${b.name} ${rp(b.amount)}`, lang), url: '/ringkasan', tag: 'bills' } : null);
export const paydayNotice = (lang = 'id') => ({ title: t(lang).payday, body: t(lang).paydayBody, url: '/cek', tag: 'payday' });
export const closeNotice = (lang = 'id') => ({ title: t(lang).close, body: t(lang).closeBody, url: '/cek', tag: 'close' });
export const testNotice = (lang = 'id') => ({ title: t(lang).test, body: t(lang).testBody, url: '/ringkasan', tag: 'test' });

// Phone notifications: the Worker decides what to say and to whom and sends it straight to the phones' push services (src/webpush.js, signed with the app's
// VAPID key). The phones are the list in Config push_devices; a phone joins through the site's /notifikasi page (PUSH_SITE, a plain static site), which
// hands its subscription back here with a one-time code (Config push_nonce).
import { sendOne } from './webpush.js';
import { addDevice, newRowsNotice, parseSubscription, pushEventsOf, pushTargets, safeEqual } from '../vendor/core/push.js';

/** While the Google app is still the live one, the Worker keeps quiet (no double notifications): Config worker_push = on switches its automatic ones on at cutover. */
export const live = (cfg) => String(cfg.worker_push || '').toLowerCase() === 'on';
const list = (cfg, key) => { try { const v = JSON.parse(cfg[key] || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
const put = (db, key, value) => db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?1, ?2)').bind(key, value);

/**
 * What the site and the key are, from the Worker's settings (PUSH_SITE, VAPID_PUBLIC_KEY, and the secret VAPID_PRIVATE_KEY); null when notifications are not set up.
 * `send(subscriptions, notice)` answers one { endpoint, status } per phone.
 */
export const pushOf = (env, fetchImpl) => {
  if (!env.PUSH_SITE || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  const site = env.PUSH_SITE.replace(/\/$/, '');
  const vapid = { subject: site, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  return { site, send: (subs, notice) => Promise.all(subs.map(async (d) => ({ endpoint: d.endpoint, status: await sendOne(d, notice, vapid, { fetchImpl }) }))) };
};

/** The notifications a person has switched on (the partner's are their own setting). */
export function eventsOfPerson(cfg, name) {
  const partner = Boolean(cfg.partner_email) && name === cfg.partner_name;
  return pushEventsOf(cfg[partner ? 'partner_push_events' : 'push_events']);
}
/** The devices that should get `event`; `only`: just that person's. */
export const targets = (cfg, { event = '', only = '' } = {}) => pushTargets(list(cfg, 'push_devices'), { defaultOwner: cfg.owner_name || '', only, event, eventsOf: (n) => eventsOfPerson(cfg, n) });
export const pushOn = (cfg, event, only = '') => targets(cfg, { event, only }).length > 0;

/** Sends one notice to the devices it is for; devices the push service says are gone are dropped. */
export async function deliver(db, cfg, push, notice, { event = '', only = '' } = {}) {
  if (!push || !notice) return { sent: 0, skipped: true };
  const to = targets(cfg, { event, only });
  if (!to.length) return { sent: 0, skipped: true };
  const results = await push.send(to.slice(0, 10).map((d) => ({ endpoint: d.endpoint, keys: d.keys })), notice);
  const gone = new Set(results.filter((r) => r.status === 404 || r.status === 410).map((r) => r.endpoint));
  if (gone.size) { // read the list again: a phone may have joined meanwhile
    const now = (await db.prepare("SELECT value FROM config WHERE key = 'push_devices'").first()) || { value: '[]' };
    await db.batch([put(db, 'push_devices', JSON.stringify(list({ push_devices: now.value }, 'push_devices').filter((d) => !gone.has(d.endpoint)))), put(db, 'data_stamp', String(Date.now()))]);
  }
  return { sent: results.filter((r) => r.status >= 200 && r.status < 300).length, gone: gone.size };
}

/** A phone coming back from the site's /notifikasi page: kept only with the current one-time code. Returns true when it was added. */
export async function acceptDevice(db, raw, code, label, owner, { now = Date.now } = {}) {
  const rows = (await db.prepare("SELECT key, value FROM config WHERE key IN ('push_nonce', 'push_devices')").all()).results;
  const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const [want, at] = String(cfg.push_nonce || '').split(' ');
  if (!want || !code || !safeEqual(code, want) || now() - Number(at) > 30 * 60000) return false;
  const sub = parseSubscription(raw);
  if (!sub) return false;
  await db.batch([put(db, 'push_devices', JSON.stringify(addDevice(list(cfg, 'push_devices'), sub, label, new Date(now()).toISOString(), owner))), put(db, 'push_nonce', ''), put(db, 'data_stamp', String(now()))]);
  return true;
}

/** New rows from a sync: each person hears about the rows of their own accounts (what they have switched on). Never throws: the rows are saved. */
export async function notifyNewRows(db, cfg, push, rows) {
  if (!push || !live(cfg) || !rows.length || !list(cfg, 'push_devices').length) return;
  try {
    const big = String(cfg.big_amount ?? '').trim();
    const lang = String(cfg.language || 'id') === 'en' ? 'en' : 'id';
    const byPerson = new Map();
    rows.forEach((r) => { const who = r.owner || cfg.owner_name; byPerson.set(who, [...(byPerson.get(who) || []), r]); });
    for (const [who, mine] of byPerson) {
      const notice = newRowsNotice(mine, { bigAmount: big === '' ? 1000000 : Number(big) || 0, events: eventsOfPerson(cfg, who), lang });
      if (notice) await deliver(db, cfg, push, notice, { only: who });
    }
  } catch (e) { /* only the notification is lost */ }
}

/** Tells the owner something about the sync itself (a phone notification: the app's sync alerts used to be e-mails). Never throws. */
export async function alertOwner(db, push, notice) {
  if (!push) return;
  try {
    const cfg = Object.fromEntries((await db.prepare("SELECT key, value FROM config WHERE key IN ('owner_name', 'push_devices', 'push_events', 'language')").all()).results.map((r) => [r.key, r.value]));
    await deliver(db, cfg, push, notice, { only: cfg.owner_name });
  } catch (e) { /* the app shows the problem on the Cek screen too */ }
}

/** The mail reader has been silent for hours. */
export const staleNotice = (hours, lang = 'id') => ({
  title: lang === 'en' ? 'Gmail is not being read' : 'Gmail tidak terbaca',
  body: lang === 'en' ? `No bank e-mail has been read for ${hours} hours. Check the Gmail connection.` : `Email bank belum terbaca selama ${hours} jam. Cek koneksi Gmail.`,
  url: '/cek', tag: 'sync-stale',
});

/** Bank e-mails that could not be read (log lines with status error): to the owner. */
export async function alertUnread(db, cfg, push, lines) {
  if (!push || !lines.length) return;
  const lang = String(cfg.language || 'id') === 'en' ? 'en' : 'id';
  const emailsOf = (v) => String(v || '').split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const title = lang === 'en' ? 'Bank e-mail not understood' : 'Email bank tidak terbaca';
  const detail = (list) => list.slice(0, 3).map((l) => `${l.subject || '?'}${l.reason ? ` · ${l.reason}` : ''}`).join('\n');
  if (!cfg.partner_email) { await alertOwner(db, push, { title, body: detail(lines), url: '/cek', tag: 'sync-unread' }); return; } // alone: everything
  // Two people: each hears the details of their own mailbox only. The owner, who looks after the app, hears that the other mailbox has some, without the subjects.
  const own = new Set(emailsOf(cfg.owner_email));
  const ofOwner = lines.filter((l) => own.has(String(l.gmail || '').toLowerCase()));
  const ofPartner = lines.filter((l) => !own.has(String(l.gmail || '').toLowerCase()));
  const others = ofPartner.length ? (lang === 'en' ? `${ofPartner.length} e-mail(s) in the other Gmail could not be read` : `${ofPartner.length} email di Gmail lainnya belum terbaca`) : '';
  if (ofOwner.length || others) await alertOwner(db, push, { title, body: [ofOwner.length ? detail(ofOwner) : '', others].filter(Boolean).join('\n'), url: '/cek', tag: 'sync-unread' });
  if (ofPartner.length && cfg.partner_name) {
    try { await deliver(db, cfg, push, { title, body: detail(ofPartner), url: '/cek', tag: 'sync-unread' }, { only: cfg.partner_name }); } catch (e) { /* the app shows the problem on the Cek screen too */ }
  }
}

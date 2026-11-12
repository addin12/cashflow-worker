// Cashflow on Cloudflare. fetch: the page and the app's API; scheduled: look for new mail every minute; queue: read one email at a time.
// Who may come in: with Cloudflare Access set up (ACCESS_TEAM, ACCESS_AUD) only a valid Access token, and then only the two people of the household;
// before that, whoever has APP_TOKEN (as a bearer header or the cookie /login sets). The Gmail sign-ins are not here: mail comes from the
// household-mail Worker through a service binding.
import { verifyAccess } from './access.js';
import { handle } from './app.js';
import { backupCsv } from '../vendor/core/csv.js';
import { dueJobs, runJob } from './daily.js';
import { personFor } from './identity.js';
import { mailClient } from './mail.js';
import { refreshPrices } from './prices.js';
import { heartbeat } from './heartbeat.js';
import { acceptDevice, alertOwner, pushOf, staleNotice } from './push.js';
import { sameSecret } from './secret.js';
import { processEmail, scan } from './sync.js';

export { sameSecret };
// The schedules (must match wrangler.toml): the minute scan is the default (it also starts the daily jobs); prices every 30 minutes.
const PRICE_CRON = '*/30 * * * *';

/** A phone coming back from the site's notifications page: added to the list of the person signed in, with the one-time code. */
async function joinDevice(env, who, p) {
  const rows = (await env.DB.prepare("SELECT key, value FROM config WHERE key IN ('owner_name', 'owner_email', 'partner_name', 'partner_email')").all()).results;
  const person = personFor(Object.fromEntries(rows.map((r) => [r.key, r.value])), who.email);
  return acceptDevice(env.DB, p.get('push'), p.get('n'), p.get('label'), person.name);
}

/**
 * True when a browser says the request was started by another site (a page that is not this app). The app's own pages send Sec-Fetch-Site: same-origin and
 * Origin of this host; a page of someone else open in the same browser must not be able to make the signed-in person's browser change their data.
 * Requests that carry neither header (scripts, tests) are not browsers acting for a signed-in cookie and pass.
 */
export function crossSite(request) {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return true;
  const origin = request.headers.get('origin');
  return Boolean(origin) && origin !== new URL(request.url).origin;
}

/** Headers every answer carries: nobody may put the app in a frame, no guessing of file types, no referrer, no camera or microphone. */
export function hardened(res) {
  const h = new Headers(res.headers);
  h.set('x-content-type-options', 'nosniff');
  h.set('referrer-policy', 'no-referrer');
  h.set('content-security-policy', "frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  h.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

export async function authorized(header, secret) {
  const m = /^Bearer (.+)$/.exec(String(header || ''));
  return sameSecret(m ? m[1] : '', secret);
}

const cookieOf = (request, name) => (request.headers.get('cookie') || '').split(';').map((c) => c.trim()).filter((c) => c.startsWith(`${name}=`)).map((c) => c.slice(name.length + 1))[0] || '';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** @returns {Promise<{email: string}|null>} the caller, or null when they may not come in at all */
export async function caller(request, env) {
  if (env.ACCESS_TEAM) {
    const email = await verifyAccess(request.headers.get('cf-access-jwt-assertion'), { team: env.ACCESS_TEAM, aud: env.ACCESS_AUD });
    return email ? { email } : null;
  }
  if (await authorized(request.headers.get('authorization'), env.APP_TOKEN)) return { email: '' };
  if (await sameSecret(cookieOf(request, 'app_token'), env.APP_TOKEN)) return { email: '' };
  return null;
}

export async function route(request, env) {
  const url = new URL(request.url);
  // Token mode only: /login?token=... keeps the token in a cookie, so the page can be opened like any page.
  if (url.pathname === '/login' && !env.ACCESS_TEAM) {
    if (!(await sameSecret(url.searchParams.get('token'), env.APP_TOKEN))) return new Response('unauthorized', { status: 401 });
    return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': `app_token=${env.APP_TOKEN}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000` } });
  }
  const who = await caller(request, env);
  if (!who) return new Response('unauthorized', { status: 401, headers: { 'www-authenticate': 'Bearer' } });
  // The backup: every transaction as a CSV file (the monthly e-mail used to carry it). Open /backup.csv signed in.
  if (request.method === 'GET' && url.pathname === '/backup.csv') {
    const cfg = (await env.DB.prepare("SELECT key, value FROM config WHERE key IN ('owner_email', 'partner_email', 'partner_name', 'owner_name')").all()).results;
    try { personFor(Object.fromEntries(cfg.map((r) => [r.key, r.value])), who.email); } catch (e) { return json({ error: e.message }, e.status || 403); } // only the household
    const rows = (await env.DB.prepare('SELECT * FROM transactions ORDER BY rowid').all()).results;
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(backupCsv(rows), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="cashflow-backup-${stamp}.csv"`, 'cache-control': 'no-store' } });
  }
  // The install files (manifest and icons): the same sign-in applies, the browser sends its cookie with the manifest request.
  if (request.method === 'GET' && /^\/(manifest\.webmanifest|icon-192\.png|icon-512\.png|maskable-512\.png|apple-touch-icon\.png)$/.test(url.pathname) && env.ASSETS) return env.ASSETS.fetch(request);
  // The page itself (built from the app's own screens by scripts/build-ui.mjs, served as a static asset)
  if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html') && env.ASSETS) {
    const page = await env.ASSETS.fetch(new Request(new URL('/index.html', request.url)));
    const tab = /^[a-z]{1,20}$/.test(url.searchParams.get('tab') || '') ? url.searchParams.get('tab') : '';
    if (!url.searchParams.has('push') && !tab) return page;
    // ?push= is a phone joining notifications (it comes back from the site's /notifikasi page); ?tab= opens a screen (the site's short links)
    let joined = '';
    if (url.searchParams.has('push')) {
      try { joined = (await joinDevice(env, who, url.searchParams)) ? 'ok' : 'bad'; } catch (e) { joined = 'bad'; }
    }
    const start = `window.__TAB__=${JSON.stringify(tab)};window.__PUSH__=${JSON.stringify(joined)};window.__INIT__=null;`;
    return new Response((await page.text()).replace('window.__INIT__=null;', () => start), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  }
  if (request.method !== 'GET' && crossSite(request)) return json({ error: 'cross-site request refused' }, 403);
  try {
    const out = await handle(env, request, who);
    return out ? json(out) : json({ error: 'not found' }, 404);
  } catch (e) {
    return json({ error: String((e && e.message) || e).slice(0, 300) }, (e && e.status) || 500); // a short reason, never a stack
  }
}

export default {
  fetch: async (request, env) => hardened(await route(request, env)),
  /** Every minute: which mail is new? One queue message each. */
  async scheduled(event, env) {
    if (event.cron === PRICE_CRON) { await refreshPrices(env.DB); return; } // its own run, so the fetching never adds to the mail scan's CPU
    const { messages, stale } = await scan(env.DB, mailClient(env.MAIL, env.MAIL_TOKEN));
    if (stale) await alertOwner(env.DB, pushOf(env), staleNotice(stale.hours)); // the mail reader has been silent for hours
    messages.push(...(await dueJobs(env.DB, Date.now()))); // the daily jobs, started once a day in their hour (src/daily.js)
    for (let i = 0; i < messages.length; i += 50) await env.SYNC_QUEUE.sendBatch(messages.slice(i, i + 50).map((body) => ({ body })));
    await heartbeat(env, { ok: !stale }); // the outside watchman (src/heartbeat.js): silence there means this job is not finishing
  },
  /** One email per invocation (max_batch_size 1, max_concurrency 1 in the config: two emails of one transfer never race). */
  async queue(batch, env) {
    const mail = mailClient(env.MAIL, env.MAIL_TOKEN);
    for (const msg of batch.messages) {
      try {
        if (msg.body.feed || msg.body.job) await runJob(env.DB, msg.body, { push: pushOf(env), bucket: env.BACKUP });
        else await processEmail(env.DB, mail, msg.body, { push: pushOf(env) });
        msg.ack();
      } catch (e) { msg.retry({ delaySeconds: 60 }); }
    }
  },
};

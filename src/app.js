// The app's API on Cloudflare: GET for the screens, POST /api/<method> for everything the app's core can do.
// Each request opens a unit of work (src/unit.js) over D1 with the window of rows its screen needs, runs the app's own method, writes what changed.
import { jakarta } from './clock.js';
import { API_METHODS } from '../vendor/core/api.js';
import { HttpError, personFor } from './identity.js';
import { pushOf } from './push.js';
import { openUnit } from './unit.js';

const iso = (d) => d.toISOString().slice(0, 10);

/** The first day of the window for the main screens (the previous pay period starts it) and for the bills screen (about 130 days). */
export function cuts(at = new Date(), payday = 28) {
  const now = new Date(at.getTime() + 7 * 3600000); // Jakarta's wall clock, read with the UTC getters
  const label = now.getUTCDate() >= payday ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { main: iso(new Date(Date.UTC(label.getUTCFullYear(), label.getUTCMonth() - 2, payday))), bills: iso(new Date(now.getTime() - 130 * 86400000)) };
}

// Methods that look further back than the main window (budget suggestions, recurring bills, the settings screen).
const WIDE = new Set(['settings', 'saveBudgets', 'saveConfig']);
// Methods that read the e-mail log (new accounts the mail mentions, unreadable mail).
const NEEDS_LOG = new Set(['review', 'bootstrap', 'init']);

/** Runs one app method for one request. `args` as the screen sends them; `email` is who Cloudflare Access said is asking (empty in token mode). */
export async function run(env, method, args, { part, email = '', now = () => jakarta() } = {}) {
  const c = cuts(now());
  const wide = WIDE.has(method) || part === 'bills';
  const unit = await openUnit(env.DB, wide ? c.bills : c.main, { rules: true, inbox: NEEDS_LOG.has(method), now, who: (cfg) => personFor(cfg, email), push: pushOf(env) });
  const { result, written } = await unit.call(method, args);
  return { result, written };
}

/** What the page asks every minute: did anything change (data_stamp) and when was the mail last looked at (scan_checked)? Two small rows, no window. */
export async function stamp(env) {
  const rows = (await env.DB.prepare("SELECT key, value FROM config WHERE key IN ('data_stamp', 'scan_checked', 'owner_email', 'partner_email')").all()).results;
  const v = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { stamp: Number(v.data_stamp) || 0, checked: Number(v.scan_checked) || null, today: 0 };
}

export async function handle(env, request, { email = '' } = {}) {
  const url = new URL(request.url);
  const p = url.searchParams;
  if (request.method === 'GET') {
    if (url.pathname === '/dashboard') { const part = p.get('part') || 'main'; return (await run(env, 'dashboard', { owner: p.get('who') || undefined, part }, { part, email })).result; }
    if (url.pathname === '/review') return (await run(env, 'review', {}, { email })).result;
    if (url.pathname === '/list') return (await run(env, 'list', { limit: Number(p.get('limit')) || 50 }, { email })).result;
    if (url.pathname === '/settings') return (await run(env, 'settings', {}, { email })).result;
    return null;
  }
  const m = /^\/api\/([A-Za-z]+)$/.exec(url.pathname);
  if (request.method === 'POST' && m) {
    if (m[1] === 'stamp') return { data: await stamp(env) };
    if (!API_METHODS.includes(m[1])) throw new HttpError(404, `unknown method ${m[1].slice(0, 40)}`);
    const args = await request.json().catch(() => ({}));
    const { result, written } = await run(env, m[1], args, { part: args.part, email });
    return { data: result, written: written.statements };
  }
  return null;
}

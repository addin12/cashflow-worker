// cashflow-feed: serves each person's calendar feed (built by the cashflow Worker, src/feed.js) at a secret address, /<token>.ics.
// It is a separate Worker because the app itself sits behind Cloudflare Access, which Google Calendar cannot sign in to. It only reads one row.
// Secrets: FEED_OWNER and FEED_PARTNER (long random strings; whoever has the address sees that person's bills, so treat it like a password).
import { sameSecret } from './index.js';

export default {
  async fetch(request, env) {
    const m = /^\/([A-Za-z0-9_-]{20,128})\.ics$/.exec(new URL(request.url).pathname);
    if (request.method !== 'GET' || !m) return new Response('not found', { status: 404 });
    const who = (await sameSecret(m[1], env.FEED_OWNER)) ? 'owner' : (await sameSecret(m[1], env.FEED_PARTNER)) ? 'partner' : '';
    if (!who) return new Response('not found', { status: 404 });
    const row = await env.DB.prepare('SELECT json FROM tabs WHERE tab = ?1 AND id = ?2').bind('feed', who).first();
    if (!row) return new Response('not built yet', { status: 503, headers: { 'retry-after': '3600' } });
    return new Response(JSON.parse(row.json).ics, { headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'private, max-age=900', 'content-disposition': 'inline; filename="cashflow.ics"' } });
  },
};

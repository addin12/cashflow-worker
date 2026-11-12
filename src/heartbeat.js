// An outside watchman. The phone alerts live inside the app and need its database, so they cannot fire when the database itself is blocked (the free daily read
// limit, an outage). A heartbeat service (healthchecks.io has a free plan) hears from the Worker every 10 minutes while everything works, and contacts the owner
// when the pings stop. The Worker only pings when its minute job finished and the mail reader is not silent; when the reader is silent it reports a failure at once.
// Not set up (no HEARTBEAT_URL secret): nothing happens.

export const EVERY_MINUTES = 10;

/** Pings once per EVERY_MINUTES. `ok` false reports a failure (healthchecks.io: <url>/fail). Never throws: the watchman must not break the job it watches. */
export async function heartbeat(env, { ok = true, now = Date.now(), fetchImpl = (...a) => fetch(...a) } = {}) {
  const url = String(env.HEARTBEAT_URL || '').trim().replace(/\/$/, '');
  if (!/^https:\/\//.test(url)) return 'off';
  const minute = new Date(now).getUTCMinutes();
  if (ok && minute % EVERY_MINUTES !== 0) return 'skipped'; // a failure is reported at once, a success only now and then
  try {
    const res = await fetchImpl(ok ? url : `${url}/fail`, { method: 'GET', signal: AbortSignal.timeout(5000) });
    return res.ok ? (ok ? 'ok' : 'failed-reported') : `answered ${res.status}`;
  } catch (e) { return 'unreachable'; }
}

// Which connected Gmail accounts have stopped syncing. Each account's sync runs on its own trigger and writes last_sync every time it reads its
// mail (at least every 30 minutes); an account that has not for hours is one whose trigger is gone, and nothing else would say so.

export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

/**
 * @param {{gmail: string, last_sync?: any}[]} connections  rows of the Connections tab
 * @param {Date} now
 * @param {{maxAgeMs?: number, skip?: string}} opts  `skip`: an address that is running right now (it is not stale by definition)
 * @returns {{gmail: string, hours: number}[]}  accounts whose last sync is older than maxAgeMs, longest silent first
 */
export function staleSyncs(connections, now, { maxAgeMs = STALE_AFTER_MS, skip = '' } = {}) {
  const out = [];
  for (const c of connections) {
    const gmail = String(c.gmail || '').trim();
    if (!gmail || gmail.toLowerCase() === String(skip).toLowerCase()) continue;
    const at = c.last_sync instanceof Date ? c.last_sync.getTime() : Date.parse(c.last_sync);
    if (!Number.isFinite(at)) continue; // never synced: it has been connected for a moment, or the row is new
    const age = now.getTime() - at;
    if (age > maxAgeMs) out.push({ gmail, hours: Math.floor(age / 3600000) });
  }
  return out.sort((a, b) => b.hours - a.hours);
}

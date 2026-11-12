// Market prices for the Aset tab, as the Apps Script app does them (src/gas/prices.js there): Yahoo Finance first, Google Finance's page when Yahoo does not
// answer, and Antam gold from harga-emas.org. Runs from its own schedule (every 30 minutes) so its CPU never adds to the mail scan.
import { priceFromGooglePage, priceFromYahoo, priceSymbols, goldFromHargaEmas } from '../vendor/core/wealth.js';
import { TABS } from '../vendor/core/schema.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const MAX_ITEMS = 20; // a Worker may make 50 subrequests; each item can take two (Yahoo, then Google). The rest wait for the next run.

/** Fetches prices for the assets that are due; returns how many were updated. `get(url)` returns the page text or throws. */
export async function refreshPrices(db, { get = defaultGet, now = Date.now, maxAgeMs = 25 * 60000 } = {}) {
  const rows = (await db.prepare('SELECT id, json FROM tabs WHERE tab = ?1').bind(TABS.assets).all()).results.map((r) => ({ id: r.id, ...JSON.parse(r.json) }));
  const due = rows.filter((r) => (r.ticker || (r.kind === 'gold' && !r.ticker)) && !(Number(r.price_at) && now() - Number(r.price_at) < maxAgeMs)).slice(0, MAX_ITEMS);
  if (!due.length) return { updated: 0, tried: 0 };
  const problems = [];
  const safe = async (url) => { try { return await get(url); } catch (e) { problems.push(`${url.split('/')[2]}: ${String((e && e.message) || e).slice(0, 100)}`); return ''; } };
  const fromTicker = async (ticker) => {
    const s = priceSymbols(ticker);
    if (!s) return null;
    try { const v = priceFromYahoo(JSON.parse((await safe(`https://query1.finance.yahoo.com/v8/finance/chart/${s.yahoo}?range=1d&interval=1d`)) || '{}')); if (v > 0) return v; } catch (e) { /* try Google */ }
    try { const v = priceFromGooglePage(await safe(`https://www.google.com/finance/quote/${s.google}?hl=en`)); if (v > 0) return v; } catch (e) { /* no price this time */ }
    return null;
  };
  const gold = due.some((r) => !r.ticker) ? (async () => { try { const v = goldFromHargaEmas(await safe('https://harga-emas.org/')); return v > 0 ? v : null; } catch (e) { return null; } })() : null;
  const prices = await Promise.all(due.map((r) => (r.ticker ? fromTicker(r.ticker) : gold)));
  if (due.some((r) => !r.ticker) && !(await gold)) problems.push('emas: harga Antam tidak terbaca dari harga-emas.org');
  const at = now();
  const st = [];
  prices.forEach((p, i) => { if (p) st.push(db.prepare("UPDATE tabs SET json = json_set(json, '$.price', ?3, '$.price_at', ?4) WHERE tab = ?1 AND id = ?2").bind(TABS.assets, due[i].id, p, at)); });
  const updated = st.length;
  const stamp = new Date(at).toISOString().slice(0, 16).replace('T', ' ');
  st.push(db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('price_status', ?1)").bind(`${stamp} UTC: ${updated} of ${due.length} priced${problems.length ? `; ${[...new Set(problems)].join('; ')}` : ''}`));
  if (updated) st.push(db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('data_stamp', ?1)").bind(String(at))); // open pages notice the change
  await db.batch(st);
  return { updated, tried: due.length };
}

async function defaultGet(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

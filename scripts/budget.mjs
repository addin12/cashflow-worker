// A guard for scripts that read the LIVE database: D1's free plan stops the whole app (the minute job fails, mail is not read) once 5,000,000 rows are read in a UTC day.
// Yesterday a round of live tests did exactly that. `await assertBudget()` at the top of such a script stops it when today's reads are already above `max` of the limit
// (or when the analytics cannot be read: then it also stops). Bypass on purpose with --force.
import { execSync } from 'node:child_process';

export const FREE_ROWS_PER_DAY = 5_000_000;

/** Rows read since 00:00 UTC today, from Cloudflare's analytics. */
export async function rowsReadToday() {
  const quiet = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };
  const token = execSync('npx wrangler auth token', quiet).trim().split('\n').pop();
  const account = (execSync('npx wrangler whoami', quiet).match(/[0-9a-f]{32}/) || [])[0];
  const since = `${new Date().toISOString().slice(0, 10)}T00:00:00Z`;
  const query = `{ viewer { accounts(filter: { accountTag: "${account}" }) { d1AnalyticsAdaptiveGroups(limit: 100, filter: { datetime_geq: "${since}" }) { sum { rowsRead } } } } }`;
  const res = await (await fetch('https://api.cloudflare.com/client/v4/graphql', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ query }) })).json();
  if (res.errors) throw new Error(JSON.stringify(res.errors).slice(0, 200));
  return res.data.viewer.accounts[0].d1AnalyticsAdaptiveGroups.reduce((n, g) => n + g.sum.rowsRead, 0);
}

export async function assertBudget({ max = 0.5, force = process.argv.includes('--force') } = {}) {
  if (force) return;
  let used;
  try { used = await rowsReadToday(); } catch (e) { console.error(`Cannot read today's D1 usage (${e.message}); not touching the live database. Use --force to go on anyway.`); process.exit(2); }
  const share = used / FREE_ROWS_PER_DAY;
  console.log(`D1 reads today: ${used.toLocaleString('en')} of ${FREE_ROWS_PER_DAY.toLocaleString('en')} (${Math.round(share * 100)}%)`);
  if (share > max) { console.error(`Above ${Math.round(max * 100)}%: this script would risk stopping the live app for the rest of the day. Wait for 00:00 UTC (07:00 WIB) or use --force.`); process.exit(2); }
}

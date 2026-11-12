// What the deployed Worker really costs, from Cloudflare's own analytics: requests, errors and CPU time per hour for the last day, and the D1 rows read.
// Free plan limits: 10 ms CPU per request, 100,000 requests a day, 5,000,000 D1 rows read a day.   node scripts/live-stats.mjs [hours] [script]
import { execSync } from 'node:child_process';

const hours = Number(process.argv[2]) || 24;
const script = process.argv[3] || 'cashflow';
const token = execSync('npx wrangler auth token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').pop();
const account = (execSync('npx wrangler whoami', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).match(/[0-9a-f]{32}/) || [])[0];
const since = new Date(Date.now() - hours * 3600e3).toISOString();
const until = new Date().toISOString();

const ask = async (query) => {
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
  const body = await res.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors).slice(0, 300));
  return body.data.viewer.accounts[0];
};

const w = await ask(`{ viewer { accounts(filter: { accountTag: "${account}" }) { workersInvocationsAdaptive(limit: 200, filter: { scriptName: "${script}", datetime_geq: "${since}", datetime_leq: "${until}" }, orderBy: [datetimeHour_ASC]) {
  dimensions { datetimeHour status } sum { requests errors subrequests } quantiles { cpuTimeP50 cpuTimeP99 wallTimeP50 } } } } }`);
const rows = w.workersInvocationsAdaptive;
const total = rows.reduce((t, r) => ({ requests: t.requests + r.sum.requests, errors: t.errors + r.sum.errors }), { requests: 0, errors: 0 });
console.log(`${script}, last ${hours} h: ${total.requests} invocations, ${total.errors} errors`);
const byHour = new Map();
rows.forEach((r) => { const h = r.dimensions.datetimeHour.slice(5, 13); const o = byHour.get(h) || { requests: 0, p50: 0, p99: 0 }; o.requests += r.sum.requests; o.p50 = Math.max(o.p50, r.quantiles.cpuTimeP50); o.p99 = Math.max(o.p99, r.quantiles.cpuTimeP99); byHour.set(h, o); });
console.log('hour (UTC)   invocations   CPU p50 (ms)   CPU p99 (ms)');
for (const [h, o] of byHour) console.log(`${h.padEnd(12)} ${String(o.requests).padStart(11)}   ${(o.p50 / 1000).toFixed(1).padStart(12)}   ${(o.p99 / 1000).toFixed(1).padStart(12)}`);

const day = new Date(Date.now() - 24 * 3600e3).toISOString();
const d = await ask(`{ viewer { accounts(filter: { accountTag: "${account}" }) { d1AnalyticsAdaptiveGroups(limit: 10, filter: { datetime_geq: "${day}", datetime_leq: "${until}" }) { sum { readQueries writeQueries rowsRead rowsWritten } } } } }`);
const s = d.d1AnalyticsAdaptiveGroups.reduce((t, g) => { Object.keys(g.sum).forEach((k) => { t[k] = (t[k] || 0) + g.sum[k]; }); return t; }, {});
console.log(`D1, last 24 h: ${s.readQueries || 0} read queries, ${s.writeQueries || 0} write queries, ${s.rowsRead || 0} rows read (limit 5,000,000/day), ${s.rowsWritten || 0} rows written`);

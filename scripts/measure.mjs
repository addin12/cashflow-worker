// Calls the deployed spike many times while `wrangler tail` records each request's real CPU time (whole ms), then prints a table.
//   node scripts/measure.mjs <base url> [calls per endpoint]
import { execSync, spawn } from 'node:child_process';

const base = process.argv[2];
const calls = Number(process.argv[3] || 12);
const paths = (process.argv[4] || '/noop,/lean,/naive').split(';');
const AUTH = process.env.AUTH ? { authorization: `Bearer ${process.env.AUTH}` } : {};
const events = [];
let buf = '';
const tail = spawn('npx', ['wrangler', 'tail', process.env.WORKER || 'cashflow-spike', ...(process.env.CONFIG ? ['-c', process.env.CONFIG] : []), '--format', 'json'], { shell: true });
// wrangler prints each event as an indented, multi-line JSON object: cut the stream into top-level {...} pieces by brace depth.
const take = (chunk) => {
  buf += chunk.toString();
  for (;;) {
    const start = buf.indexOf('{');
    if (start < 0) { buf = ''; break; }
    let depth = 0; let inStr = false; let esc = false; let end = -1;
    for (let i = start; i < buf.length; i += 1) {
      const c = buf[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true; else if (c === '{') depth += 1; else if (c === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) { buf = buf.slice(start); break; }
    try { const e = JSON.parse(buf.slice(start, end + 1)); if (e.event && e.event.request) events.push(e); } catch { /* not an event */ }
    buf = buf.slice(end + 1);
  }
};
tail.stdout.on('data', take);
tail.stderr.on('data', () => {});
await new Promise((r) => setTimeout(r, 9000)); // let the tail attach
const keyOf = (p) => { const post = /^POST (\S+) /.exec(p); return post ? `POST ${post[1]}` : p; };
const hit = (p) => { const post = /^POST (\S+) (.*)$/.exec(p); return post ? fetch(base + post[1], { method: 'POST', headers: { 'content-type': 'application/json', ...AUTH }, body: post[2] }) : fetch(base + p, { headers: AUTH }); };
for (const p of paths) for (let i = 0; i < calls; i += 1) { const res = await hit(p); await res.arrayBuffer(); await new Promise((r) => setTimeout(r, 400)); }
await new Promise((r) => setTimeout(r, 6000));
try { execSync(`taskkill /pid ${tail.pid} /T /F`, { stdio: 'ignore' }); } catch { /* already gone */ }
const by = new Map();
for (const e of events) {
  const u = new URL(e.event.request.url); const path = e.event.request.method === 'POST' ? `POST ${u.pathname}` : u.pathname + u.search;
  const row = by.get(path) || { cpu: [], wall: [], outcomes: new Map() };
  row.cpu.push(e.cpuTime); row.wall.push(e.wallTime);
  row.outcomes.set(e.outcome, (row.outcomes.get(e.outcome) || 0) + 1);
  by.set(path, row);
}
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log(`events captured: ${events.length}`);
console.log('endpoint  calls  cpu ms (min / median / max)   wall ms (median)   outcomes');
for (const p of paths) {
  const r = by.get(keyOf(p));
  if (!r) { console.log(keyOf(p).padEnd(9), 'no events'); continue; }
  console.log(keyOf(p).padEnd(9), String(r.cpu.length).padStart(5), `  ${Math.min(...r.cpu)} / ${med(r.cpu)} / ${Math.max(...r.cpu)}`.padEnd(30), String(med(r.wall)).padEnd(18), [...r.outcomes].map(([k, v]) => `${k}:${v}`).join(' '));
}
process.exit(0);

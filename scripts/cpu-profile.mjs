// What does a request cost in CPU on the owner's real data (a local copy in the D1 stand-in)? Each screen's request is run two ways, alternating so
// the computer's own ups and downs cancel out: "first after a change" (loads its rows) and "next" (uses the rows the request before kept).
// A real Worker is a little slower than this computer; read the ratio, not the milliseconds.
//   node scripts/cpu-profile.mjs
import { readFileSync } from 'node:fs';
import { cuts } from '../src/app.js';
import { clearWindowCache, openUnit } from '../src/unit.js';
import { localD1 } from '../test/d1shim.js';

const NOW = new Date();
const db = localD1();
db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
db.exec(readFileSync(new URL('../private/real-seed.sql', import.meta.url), 'utf8'));
db.exec("INSERT OR REPLACE INTO config (key, value) VALUES ('data_stamp', '1')");
const who = () => ({ name: 'Me', email: 'a@example.com', owner: true });
const c = cuts(NOW);
const RUNS = 40;
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function once(method, args, { wide, inbox }, cold) {
  db.newRequest(); db.resetRows();
  if (cold) clearWindowCache();
  const t0 = performance.now();
  const unit = await openUnit(db, wide ? c.bills : c.main, { rules: true, inbox, now: () => NOW, who });
  const { result } = await unit.call(method, args);
  JSON.stringify({ data: result });
  return { ms: performance.now() - t0, rows: db.rowsRead() };
}

async function profile(label, method, args, opts = {}) {
  await once(method, args, opts, false); await once(method, args, opts, true); // warm up
  const cold = []; const kept = []; let rowsCold = 0; let rowsKept = 0;
  for (let i = 0; i < RUNS; i += 1) {
    const a = await once(method, args, opts, true); cold.push(a.ms); rowsCold = a.rows;
    await once(method, args, opts, true); // fill the kept window ...
    const b = await once(method, args, opts, false); kept.push(b.ms); rowsKept = b.rows; // ... and use it
  }
  const [m1, m2] = [median(cold), median(kept)];
  console.log(`${label.padEnd(20)} first after a change ${m1.toFixed(1).padStart(5)} ms, ${String(rowsCold).padStart(5)} rows | next ${m2.toFixed(1).padStart(5)} ms, ${String(rowsKept).padStart(4)} rows | ${Math.round(100 - (100 * m2) / m1)}% less CPU`);
}

console.log(`CPU per request (median of ${RUNS}), rows read from the database`);
await profile('bootstrap', 'bootstrap', {}, { inbox: true });
await profile('review (Cek)', 'review', {}, { inbox: true });
await profile('dashboard main', 'dashboard', { part: 'main' });
await profile('dashboard insights', 'dashboard', { part: 'insights' });
await profile('dashboard bills', 'dashboard', { part: 'bills' }, { wide: true });
await profile('incoming (bell)', 'incoming', {});
await profile('list (50 rows)', 'list', { limit: 50 });
await profile('settings', 'settings', {}, { wide: true });

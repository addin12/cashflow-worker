// How many rows does each action read from the database, on the owner's real data? D1's free plan allows 5 million rows read a day; this shows
// where the rows go and what a normal day adds up to. Rows returned stand in for rows read (every query is indexed: see scripts/explain.mjs).
//   node scripts/reads-estimate.mjs
import { readFileSync } from 'node:fs';
import { cuts } from '../src/app.js';
import { openUnit } from '../src/unit.js';
import { scan } from '../src/sync.js';
import { localD1 } from '../test/d1shim.js';

const FREE_PER_DAY = 5_000_000;
const NOW = new Date();
const db = localD1();
db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
db.exec(readFileSync(new URL('../private/real-seed.sql', import.meta.url), 'utf8'));
const who = () => ({ name: 'Me', email: 'a@example.com', owner: true });

async function cost(label, fn) {
  db.resetRows(); db.newRequest();
  await fn();
  const n = db.rowsRead();
  console.log(`${String(n).padStart(6)} rows  ${label}`);
  return n;
}
const call = (method, args = {}, { wide = false, inbox = false } = {}) => async () => {
  const c = cuts(NOW);
  const unit = await openUnit(db, wide ? c.bills : c.main, { rules: true, inbox, now: () => NOW, who });
  await unit.call(method, args);
};

console.log('One action:');
const bootstrap = await cost('bootstrap (page start)', call('bootstrap', {}, { inbox: true }));
const review = await cost('review (Cek)', call('review', {}, { inbox: true }));
const dash = (await cost('dashboard main', call('dashboard', { part: 'main' }))) + (await cost('dashboard insights', call('dashboard', { part: 'insights' }))) + (await cost('dashboard bills', call('dashboard', { part: 'bills' }, { wide: true })));
const incoming = await cost('incoming (the bell)', call('incoming'));
const open = bootstrap + review + dash + incoming;
console.log(`${String(open).padStart(6)} rows  = ONE PAGE OPEN (all of the above)`);
const list = await cost('transaction list', call('list', { limit: 50 }));
const settings = await cost('settings (Pengaturan)', call('settings', {}, { wide: true }));
const stamp = await cost('stamp (asked every minute while a page is open)', async () => { await db.prepare("SELECT key, value FROM config WHERE key IN ('data_stamp', 'scan_checked')").all(); });
const write = await cost('one write (edit a row)', async () => { const id = db.sqlite.prepare("SELECT id FROM transactions WHERE status = 'approved' ORDER BY date DESC LIMIT 1").get().id; await call('update', { id, fields: { description: 'EDITED' } })(); });

console.log('\nBehind the scenes:');
const mail = { list: async () => [], fetch: async () => { throw new Error('none'); } };
await scan(db, mail, { now: () => NOW.getTime() }); // the first scan learns what is known
const quiet = await cost('one quiet minute of mail scanning', async () => { await scan(db, mail, { now: () => NOW.getTime() + 60000 }); });

const day = { opens: 60, stamps: 60 * 20, scans: 1440, emails: 120, writes: 100, lists: 40, settings: 6 };
const emailRows = 400; // read per email read by the sync: its near rows, the accounts, the rules, the household's Config
const total = day.opens * open + day.stamps * stamp + day.scans * quiet + day.emails * emailRows + day.writes * write + day.lists * list + day.settings * settings;
console.log(`\nA busy day: ${day.opens} page opens, ${day.stamps} minute checks, ${day.scans} mail scans, ${day.emails} emails read, ${day.writes} saves, ${day.lists} lists, ${day.settings} settings`);
console.log(`  = about ${total.toLocaleString('en')} rows read, ${(100 * total / FREE_PER_DAY).toFixed(1)}% of the free ${FREE_PER_DAY.toLocaleString('en')} a day`);
console.log(`  the page opens alone are ${(100 * day.opens * open / total).toFixed(0)}% of it; mail scanning ${(100 * day.scans * quiet / total).toFixed(0)}%`);

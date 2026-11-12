// Picks a few of the app's invented test emails (BCA, BRI, Grab) into src/fixtures.json for the sync measurement.
import { readFileSync, writeFileSync } from 'node:fs';

const DIR = 'D:/Project/Cashflow Tracker/test/fixtures/emails/';
const WANT = { 'bca.txt': ['bca-qris', 'bca-transfer-bca', 'bca-transfer-other-bank'], 'bri.txt': ['bri-qris', 'bri-notif-out'], 'grab.txt': ['grab-ovo', 'grab-food-ovo'] };
const SUBJECT = { 'bca-qris': 'Internet Transaction Journal', 'bca-transfer-bca': 'Internet Transaction Journal', 'bca-transfer-other-bank': 'Internet Transaction Journal' };
const out = [];
for (const [file, names] of Object.entries(WANT)) {
  for (const chunk of readFileSync(DIR + file, 'utf8').split(/^=== /m).slice(1)) {
    const [head, ...rest] = chunk.split(/^---$/m);
    const lines = head.split(/\r?\n/);
    const name = lines[0].trim();
    if (!names.includes(name)) continue;
    const h = Object.fromEntries(lines.slice(1).filter(Boolean).map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
    out.push({ name, from: h.from, subject: h.subject || SUBJECT[name] || '', body: rest.join('---').replace(/^\r?\n/, '') });
  }
}
writeFileSync(new URL('../test/fixtures.json', import.meta.url), JSON.stringify(out));
console.log(out.map((f) => `${f.name} (${f.subject.slice(0, 30)})`).join('\n'));

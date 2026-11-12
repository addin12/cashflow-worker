// Copies the REAL data of the live Google Sheet into private/real.json on THIS computer (git-ignored, never uploaded).
// Uses the same clasp login as Cashflow Tracker's scripts/read-tab.mjs and the same cell conversions as src/gas/store.js.
//   node scripts/export-real.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { TABS } from '../vendor/core/schema.js';

const CASHFLOW = 'D:/Project/Cashflow Tracker';
const sheetId = JSON.parse(readFileSync(`${CASHFLOW}/.clasp.json`, 'utf8')).parentId;
const cred = JSON.parse(readFileSync(join(homedir(), '.clasprc.json'), 'utf8')).tokens.default;
const tok = await (await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: cred.client_id, client_secret: cred.client_secret, refresh_token: cred.refresh_token, grant_type: 'refresh_token' }),
})).json();
const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const res = await fetch(`https://www.googleapis.com/drive/v3/files/${sheetId}/export?mimeType=${encodeURIComponent(mime)}`, { headers: { authorization: `Bearer ${tok.access_token}` } });
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));

const pad = (n) => String(n).padStart(2, '0');
// Like src/gas/store.js fromCell, but on UTC parts: the export gives dates as UTC midnight.
function cell(header, v) {
  if (v && typeof v === 'object' && !(v instanceof Date)) v = v.result !== undefined ? v.result : v.text !== undefined ? v.text : '';
  if (v instanceof Date) {
    if (header === 'time') return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`;
    if (['updated_at', 'connected_at', 'last_sync', 'created_at'].includes(header)) return v.toISOString();
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  }
  if (header === 'time' && typeof v === 'number') { const s = Math.round(v * 86400); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`; }
  return v == null ? '' : v;
}
const table = (name) => {
  const ws = wb.getWorksheet(name);
  if (!ws) return [];
  const rows = [];
  ws.eachRow((row) => rows.push(row.values.slice(1)));
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, cell(h, r[i])]))).filter((o) => Object.values(o).some((v) => v !== ''));
};

const out = { exportedAt: new Date().toISOString(), tabs: {}, config: {} };
for (const key of ['transactions', 'accounts', 'rules', 'budgets', 'goals', 'owed', 'assets', 'plans', 'inboxLog', 'connections']) out.tabs[TABS[key]] = table(TABS[key]);
for (const r of table(TABS.config)) if (r.key && !/token|nonce|device|chat/i.test(r.key)) out.config[r.key] = r.value;
// The category slots: CASHFLOW K5:K10 are income, K11:K38 expense (as src/gas/sheetstore.js reads them).
const cf = wb.getWorksheet('CASHFLOW');
const k = (r) => String(cell('k', cf.getRow(r).getCell(11).value));
out.slots = { income: Array.from({ length: 6 }, (_, i) => k(5 + i)), expense: Array.from({ length: 28 }, (_, i) => k(11 + i)) };
mkdirSync(new URL('../private', import.meta.url), { recursive: true });
writeFileSync(new URL('../private/real.json', import.meta.url), JSON.stringify(out));
console.log(Object.entries(out.tabs).map(([k, v]) => `${k}: ${v.length} rows`).join('\n'));
console.log(`config: ${Object.keys(out.config).length} keys`);

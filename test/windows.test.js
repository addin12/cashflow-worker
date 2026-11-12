// Which rows a request loads: an older month, a year and the full list must answer exactly as if every row were loaded.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { DASHBOARD_PARTS } from '../vendor/core/api.js';
import { cuts, cutFor, run } from '../src/app.js';
import { openUnit } from '../src/unit.js';
import { localD1 } from './d1shim.js';

const NOW = new Date('2026-11-11T03:00:00Z');
const who = () => ({ name: 'Me', email: 'a@example.com', owner: true });
let db;

const everything = async (method, args) => { db.newRequest(); const u = await openUnit(db, '1970-01-01', { rules: true, inbox: true, now: () => NOW, who }); return (await u.call(method, args)).result; };
const asked = async (method, args, part) => { db.newRequest(); return (await run({ DB: db }, method, args, { part, now: () => NOW, email: '' })).result; };
const recentOnly = async (method, args) => { db.newRequest(); const u = await openUnit(db, cuts(NOW).main, { rules: true, now: () => NOW, who }); return (await u.call(method, args)).result; };

beforeAll(() => {
  db = localD1();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(execFileSync(process.execPath, ['scripts/gen-seed.mjs', '600'], { encoding: 'utf8', cwd: new URL('..', import.meta.url), maxBuffer: 50e6 }));
});

describe('cutFor: where a request\'s rows start', () => {
  const at = NOW;
  it('today\'s screens use the recent window, the bills data the longer one', () => {
    expect(cutFor('dashboard', { part: 'main' }, 'main', at)).toBe(cuts(at).main);
    expect(cutFor('dashboard', { part: 'bills' }, 'bills', at)).toBe(cuts(at).bills);
    expect(cutFor('settings', {}, '', at)).toBe(cuts(at).bills);
    expect(cutFor('incoming', {}, '', at)).toBe(cuts(at).main);
  });
  it('the current month keeps the recent window; an older month starts two pay months before itself', () => {
    expect(cutFor('dashboard', { month: '2026-11' }, 'main', at)).toBe(cuts(at).main);
    expect(cutFor('dashboard', { month: '2026-09' }, 'main', at)).toBe('2026-07-28');
    expect(cutFor('monthTotals', { month: '2026-01' }, '', at)).toBe('2025-11-28');
  });
  it('a year starts at the end of the one before; the whole list starts at the beginning', () => {
    expect(cutFor('yearly', { year: 2026 }, '', at)).toBe('2025-12-28');
    expect(cutFor('spt', { year: 2025 }, '', at)).toBe('2024-12-28');
    expect(cutFor('list', { limit: 1000000 }, '', at)).toBe('1970-01-01');
    expect(cutFor('list', { limit: 50 }, '', at)).toBe(cuts(at).main);
    expect(cutFor('list', { limit: 50, q: 'x' }, '', at)).toBe('1970-01-01');
  });
});

describe('answers equal the answers from every row', () => {
  it('an older month, every part, both ways of looking', async () => {
    for (const month of ['2026-11', '2026-10', '2026-09']) {
      for (const part of Object.keys(DASHBOARD_PARTS)) {
        const want = await everything('dashboard', { month, part });
        const got = await asked('dashboard', { month, part }, part);
        expect(JSON.stringify(got), `${month} ${part}`).toBe(JSON.stringify(want));
      }
    }
  });
  it('the recent window alone would have been wrong for an older month (this test is not trivial)', async () => {
    const want = await everything('dashboard', { month: '2026-09', part: 'main' });
    const wrong = await recentOnly('dashboard', { month: '2026-09', part: 'main' });
    expect(JSON.stringify(wrong)).not.toBe(JSON.stringify(want));
  });
  it('the year view, the tax list, the month totals and the full list', async () => {
    for (const [method, args] of [['yearly', { year: 2026 }], ['spt', { year: 2026 }], ['monthTotals', { month: '2026-09' }], ['monthTotals', { month: '2026-10' }]]) {
      expect(JSON.stringify(await asked(method, args)), method).toBe(JSON.stringify(await everything(method, args)));
    }
    const all = db.sqlite.prepare('SELECT COUNT(*) AS n FROM transactions').get().n;
    expect((await asked('list', { limit: 1000000 })).rows).toHaveLength(all);
    expect((await asked('list', { limit: 50 })).rows).toHaveLength(50);
  });
});

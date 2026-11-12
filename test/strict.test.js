// The app only READS the rows it is handed: a request shares one copy of each row between all the reads it makes (copying them on every read was
// most of the CPU). Here every row is locked, and every read-only method runs; one that changed a row it read would throw.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DASHBOARD_PARTS } from '../vendor/core/api.js';
import { TABS } from '../vendor/core/schema.js';
import { cuts } from '../src/app.js';
import { openUnit, strictRows } from '../src/unit.js';
import { localD1 } from './d1shim.js';

const NOW = new Date('2026-11-11T03:00:00Z');
const who = () => ({ name: 'Me', email: 'a@example.com', owner: true });

describe('locked rows', () => {
  it('are switched on for everything these tests run', () => {
    expect(strictRows.on).toBe(true);
  });

  it('every read-only method works on them, for both people, and gives the same answer twice', async () => {
    const db = localD1();
    db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
    db.exec(execFileSync(process.execPath, ['scripts/gen-seed.mjs', '400'], { encoding: 'utf8', cwd: new URL('..', import.meta.url), maxBuffer: 50e6 }));
    const c = cuts(NOW);
    const calls = [
      ['init', {}], ['bootstrap', {}], ['review', {}], ['list', { limit: 50 }], ['incoming', {}], ['settings', {}], ['yearly', { year: 2026 }], ['spt', { year: 2026 }],
      ['monthTotals', { month: '2026-11' }], ['dashboard', {}], ['dashboard', { owner: 'Dewi' }], ...Object.keys(DASHBOARD_PARTS).map((part) => ['dashboard', { part }]),
    ];
    for (const [name, args] of calls) {
      const answers = [];
      for (let i = 0; i < 2; i += 1) {
        db.newRequest();
        const unit = await openUnit(db, c.bills, { rules: true, inbox: true, now: () => NOW, who });
        answers.push(JSON.stringify((await unit.call(name, args)).result));
      }
      expect(answers[0], name).toBe(answers[1]);
      expect(answers[0].length, name).toBeGreaterThan(2);
    }
  });

  it('an update replaces the row: a row handed out before keeps its old value', async () => {
    const db = localD1();
    db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
    db.exec(execFileSync(process.execPath, ['scripts/gen-seed.mjs', '100'], { encoding: 'utf8', cwd: new URL('..', import.meta.url), maxBuffer: 50e6 }));
    const unit = await openUnit(db, cuts(NOW).main, { rules: true, now: () => NOW, who });
    const before = unit.store.read(TABS.transactions).find((r) => r.status === 'approved');
    unit.store.update(TABS.transactions, [{ id: before.id, changes: { description: 'EDITED' } }]);
    expect(before.description).not.toBe('EDITED');
    expect(unit.store.read(TABS.transactions).find((r) => r.id === before.id).description).toBe('EDITED');
  });
});

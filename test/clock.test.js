import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { run, cuts } from '../src/app.js';
import { jakarta } from '../src/clock.js';
import { localD1 } from './d1shim.js';

// 03:00 on 11 November in Jakarta is still 10 November in UTC
const NIGHT = Date.parse('2026-11-10T20:00:00Z');

describe('the Jakarta clock', () => {
  it('shows the Jakarta wall clock through the local getters and the true moment everywhere else', () => {
    const d = jakarta(NIGHT);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getDay()]).toEqual([2026, 10, 11, 3, 3]);
    expect(d.getTime()).toBe(NIGHT);
    expect(d.toISOString()).toBe('2026-11-10T20:00:00.000Z');
    expect(d - new Date(NIGHT - 1000)).toBe(1000);
    expect(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getDate()).toBe(11);
  });
  it('the windows start from the Jakarta day too', () => {
    // Jakarta 28 Oct 03:00 (UTC 27 Oct): the pay month 28 Oct-27 Nov has begun, so its window is two months earlier than in UTC's view
    expect(cuts(new Date('2026-10-27T20:00:00Z')).main).toBe(cuts(new Date('2026-10-28T05:00:00Z')).main);
    expect(cuts(new Date('2026-10-27T20:00:00Z')).main).not.toBe(cuts(new Date('2026-10-27T05:00:00Z')).main);
  });
  it('the app answers with the Jakarta date at night', async () => {
    const db = localD1();
    db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
    db.exec(execFileSync(process.execPath, ['scripts/gen-seed.mjs', '100'], { encoding: 'utf8', cwd: new URL('..', import.meta.url), maxBuffer: 50e6 }));
    const { result } = await run({ DB: db }, 'bootstrap', {}, { now: () => jakarta(NIGHT) });
    expect(result.today).toBe('2026-11-11');
  });
});

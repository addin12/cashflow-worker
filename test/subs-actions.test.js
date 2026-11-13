// "Kelola langganan" through the Worker: marking a subscription (still used / stop), taking the mark off, hiding it ("Bukan langganan") and bringing it back
// must all persist and show up in the next read of the dashboard.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { run } from '../src/app.js';
import { localD1 } from './d1shim.js';

let db;
const env = () => { db.newRequest(); return { DB: db }; }; // each call is its own request (the free plan allows 50 statements per request)
const bills = async () => (await run(env(), 'dashboard', { part: 'bills' }, { part: 'bills', email: '' })).result;

beforeEach(() => {
  db = localD1();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(execFileSync(process.execPath, ['scripts/gen-seed.mjs', '600'], { encoding: 'utf8', cwd: new URL('..', import.meta.url), maxBuffer: 50e6 }));
});

describe('subscriptions', () => {
  it('the seed has some to work with', async () => {
    const d = await bills();
    expect(d.recurring.items.length).toBeGreaterThan(0);
  });

  it('a mark persists, shows under the subscription\'s key, and can be taken off again', async () => {
    const item = (await bills()).recurring.items[0];
    await run(env(), 'markRecurring', { name: item.name, mark: 'stop' }, { email: '' });
    expect((await bills()).recurringMarks[item.key]).toBe('stop');
    await run(env(), 'markRecurring', { name: item.name, mark: 'keep' }, { email: '' });
    expect((await bills()).recurringMarks[item.key]).toBe('keep');
    await run(env(), 'markRecurring', { name: item.name, mark: '' }, { email: '' });
    expect((await bills()).recurringMarks[item.key]).toBeUndefined();
  });

  it('"Bukan langganan" removes it from the list and "undo" brings it back', async () => {
    const before = (await bills()).recurring;
    const item = before.items[0];
    await run(env(), 'hideRecurring', { name: item.name }, { email: '' });
    const hidden = (await bills()).recurring;
    expect(hidden.items.find((i) => i.key === item.key)).toBeUndefined();
    expect(hidden.items.length).toBe(before.items.length - 1);
    await run(env(), 'unhideRecurring', { name: item.name }, { email: '' });
    expect((await bills()).recurring.items.find((i) => i.key === item.key)).toBeDefined();
  });

  it('a mark of one subscription does not touch another', async () => {
    const [a, b] = (await bills()).recurring.items;
    await run(env(), 'markRecurring', { name: a.name, mark: 'stop' }, { email: '' });
    const marks = (await bills()).recurringMarks;
    expect(marks[a.key]).toBe('stop');
    expect(marks[b.key]).toBeUndefined();
  });
});

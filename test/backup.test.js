// The weekly backup must be something you can really restore from: back up a database, load the SQL into a fresh one, and compare.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { TABLES, backupTable, insertsOf, pruneBackups } from '../src/backup.js';
import { dueJobs, JOBS, runJob } from '../src/daily.js';
import { localD1 } from './d1shim.js';

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const seed = () => execFileSync(process.execPath, ['scripts/gen-seed.mjs', '120'], { encoding: 'utf8', cwd: new URL('..', import.meta.url), maxBuffer: 50e6 });

const bucket = () => {
  const files = new Map();
  return {
    files,
    put: async (key, body) => { files.set(key, String(body)); },
    delete: async (keys) => { [].concat(keys).forEach((k) => files.delete(k)); },
    list: async ({ prefix = '' } = {}) => ({ objects: [...files.keys()].filter((k) => k.startsWith(prefix)).sort().map((key) => ({ key })), truncated: false }),
  };
};

let db;
beforeEach(() => { db = localD1(); db.exec(schema); db.exec(seed()); });

describe('backupTable', () => {
  it('writes every table as SQL, and a fresh database loaded from it holds the same rows', async () => {
    const b = bucket();
    db.sqlite.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('note', ?)").run("it's a \"quoted\" value\nwith a newline");
    for (const t of TABLES) await backupTable(db, b, t, { now: () => Date.UTC(2026, 10, 15) });
    expect([...b.files.keys()].sort()).toEqual(TABLES.map((t) => `weekly/2026-11-15/${t}.sql`).sort());
    const fresh = localD1();
    fresh.exec(schema);
    for (const t of TABLES) fresh.exec(b.files.get(`weekly/2026-11-15/${t}.sql`));
    for (const t of TABLES) {
      const a = db.sqlite.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n;
      expect(fresh.sqlite.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n, t).toBe(a);
    }
    const sum = (d) => d.sqlite.prepare('SELECT ROUND(SUM(amount), 2) AS s, COUNT(*) AS n, MAX(date) AS d FROM transactions').get();
    expect(sum(fresh)).toEqual(sum(db));
    expect(fresh.sqlite.prepare("SELECT value FROM config WHERE key = 'note'").get().value).toBe("it's a \"quoted\" value\nwith a newline");
  });
  it('refuses a table that is not on the list, and does nothing without a bucket', async () => {
    await expect(backupTable(db, bucket(), 'sqlite_master')).rejects.toThrow('unknown table');
    expect(await backupTable(db, null, 'config')).toMatch(/no bucket/);
  });
  it('an empty table is an empty file', () => { expect(insertsOf('config', [])).toBe(''); });
});

describe('pruneBackups', () => {
  it('keeps the newest weeks and removes the rest', async () => {
    const b = bucket();
    for (let w = 1; w <= 10; w += 1) for (const t of ['config', 'tabs']) await b.put(`weekly/2026-0${w < 10 ? w : 9}-${w < 10 ? '01' : '02'}/${t}.sql`, 'x');
    const before = new Set([...b.files.keys()].map((k) => k.split('/')[1]));
    const note = await pruneBackups(b, { keep: 8 });
    const after = new Set([...b.files.keys()].map((k) => k.split('/')[1]));
    expect(before.size).toBe(10);
    expect(after.size).toBe(8);
    expect(note).toMatch(/removed 2/);
    expect([...after].sort()[0] > [...before].sort()[1]).toBe(true); // the oldest are the ones that went
  });
});

describe('the weekly job', () => {
  it('is due on Sunday night only, once, and has a message per table plus the clean-up', async () => {
    const job = JOBS.find((j) => j.name === 'backup');
    expect(job.messages).toHaveLength(TABLES.length + 1);
    const sunday = Date.UTC(2026, 10, 15, job.hour, 5);
    const monday = Date.UTC(2026, 10, 16, job.hour, 5);
    expect(await dueJobs(db, monday)).toEqual([]);
    expect((await dueJobs(db, sunday)).filter((m) => m.backup)).toHaveLength(TABLES.length + 1);
    expect(await dueJobs(db, sunday + 60000)).toEqual([]);
  });
  it('runs through the job runner', async () => {
    const b = bucket();
    expect(await runJob(db, { backup: 'config' }, { bucket: b })).toMatch(/backup config: \d+ rows/);
    expect(await runJob(db, { backup: 'prune' }, { bucket: b })).toMatch(/prune/);
  });
});

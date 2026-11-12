// A local stand-in for D1: SQLite underneath (node:sqlite), the same prepare/bind/all/first/run/batch shape, and D1's limits enforced:
// 100 bound values per statement, 50 statements per request (call `newRequest()` where a Worker request would start).
import { DatabaseSync } from 'node:sqlite';
import { clearWindowCache, strictRows } from '../src/unit.js';

// Everything that runs on the stand-in runs with locked rows: the app must never change a row it only read (see strictRows in src/unit.js).
strictRows.on = true;

export function localD1() {
  clearWindowCache(); // a new database must not be answered from what an earlier one left in memory
  const sqlite = new DatabaseSync(':memory:');
  let used = 0;
  let rows = 0; // rows the SELECTs returned (D1 charges rows scanned: for indexed queries about the same)
  const log = []; // every statement that ran, for tests that check what a request touches
  const count = (n = 1) => { used += n; if (used > 50) throw new Error(`D1 limit: ${used} statements in one request (50 allowed on the free plan)`); };
  const run = (s) => {
    if (s.args.length > 100) throw new Error(`D1 limit: ${s.args.length} bound values in one statement (100 allowed)`);
    log.push(s.sql);
    const stmt = sqlite.prepare(s.sql);
    if (/^\s*select/i.test(s.sql)) { const results = stmt.all(...s.args); rows += results.length; return { results }; }
    stmt.run(...s.args);
    return { results: [] };
  };
  // like D1's PreparedStatement: it can be run as it is, or bound first
  const statement = (sql, args) => {
    const s = { sql, args };
    return { ...s, bind: (...a) => statement(sql, a), all: async () => { count(); return run(s); }, first: async () => { count(); return run(s).results[0] || null; }, run: async () => { count(); return run(s); } };
  };
  return {
    sqlite,
    newRequest() { used = 0; },
    statementsUsed: () => used,
    log,
    rowsRead: () => rows,
    resetRows: () => { rows = 0; },
    exec: (sql) => sqlite.exec(sql),
    prepare: (sql) => statement(sql, []),
    async batch(stmts) {
      count(stmts.length);
      sqlite.exec('BEGIN');
      try { const out = stmts.map(run); sqlite.exec('COMMIT'); return out; } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    },
  };
}

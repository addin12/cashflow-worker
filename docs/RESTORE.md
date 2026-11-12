# Backup and restore

The app's data lives in one D1 database (`cashflow`). Three layers protect it.

1. **D1 Time Travel**: Cloudflare keeps the database's history for **7 days on the free plan** (30 on the paid plan). Any minute in that week can be restored in place.
   - Where are we now: `npx wrangler d1 time-travel info cashflow`
   - Restore to a moment: `npx wrangler d1 time-travel restore cashflow --timestamp=2026-11-12T03:00:00Z` (or `--bookmark=<id>` from `info`).
   - This overwrites the live data with the old state, so take a backup first (layer 2).
2. **A SQL file on your own computer**: `node scripts/backup.mjs` exports the live database to `private/backup/d1-<date>.sql`, restores that file into a scratch copy and compares it with the live
   data (rows of every table, number and total of the transactions, the newest date). It prints "matches the live data" or says what differs. Run it before anything risky and now and then
   (monthly is enough). Copy the file somewhere else too (another drive or cloud storage): it holds your finances and is git-ignored on purpose.
3. **`/backup.csv`** (signed in): every transaction as a spreadsheet file, readable without any tooling. It is not a full backup (no settings or rules), but it keeps the money records safe.

## Restoring from a SQL file (rehearsed on 2026-11-12: 613 transactions, all tables identical)

1. Create an empty database: `npx wrangler d1 create cashflow-restored`
2. Load the file: `npx wrangler d1 execute cashflow-restored --remote --file=private/backup/d1-<date>.sql`
3. Check it: `npx wrangler d1 execute cashflow-restored --remote --command "SELECT COUNT(*), SUM(amount), MAX(date) FROM transactions"`
4. Point the app at it: in `wrangler.toml` change `database_name` and `database_id` of the `DB` binding to the new database (the id is printed by step 1), then `npm run deploy`.
5. Sign in and look at Ringkasan. Phones stay joined (the list of phones is in the data); the secrets (`MAIL_TOKEN`, `VAPID_PRIVATE_KEY`, Access settings) belong to the Worker, not the database.
6. When sure, delete the broken database: `npx wrangler d1 delete cashflow`.

The Google Sheet (kept until about 2026-12-11) is a last-resort copy from the day of the move: `private/backup/sheet-before-cutover.json` and `d1-before-cutover.sql` are the same moment.

# DONE 2026-11-12 ~09:40 WIB: the switch happened (owner decided after day 1 of the shadow run)
What was done: backups (private/backup/sheet-before-cutover.json, d1-before-cutover.sql) -> Google app retired (web app version 125, private/retired.json build: every trigger stops, the page says Cashflow moved) -> final compare identical (610 vs 609, one harmless ignored row) -> Config worker_push = on -> notification site merged and pushed (links and phone joining point to the Worker). No fresh re-copy was needed (data already identical). The Sheet and script are untouched as backup/rollback. Still to do by people: Dewi signs in once; each phone joins notifications (Pengaturan > Notifikasi); delete the old Cashflow Google calendar and subscribe to the feed address.
Rollback: redeploy the Google app without private/retired.json (npm run deploy in Cashflow Tracker, after renaming that file), set Config worker_push empty in D1, revert the notification site the cutover commit, copy back what was entered on Cloudflare (/backup.csv).

# Switching from the Google app to Cloudflare

Do this only when the owner says so, and only after the shadow run (about two weeks) showed the same numbers every day.

## During the shadow run (now)
- The Google app stays the real one. The Cloudflare app reads the same mail on its own and keeps its own copy: open it at
  https://<your-worker>.workers.dev (sign in with the one-time code).
- Every morning (07:23 WIB) `node scripts/compare-data.mjs` (removed on 2026-11-12 with the Sheet) compared the Sheet with the Cloudflare data. Edits made by hand in the Google app
  do not appear in Cloudflare: that is the only expected difference. Anything else is looked into.
- Cloudflare's automatic notifications are OFF (Config `worker_push` empty), so phones do not get everything twice. "Send test notification"
  in the Cloudflare app's settings still works (a phone must have joined through the Google app's link first; see below).
- Calendar feeds (`secrets/feed-urls.txt`) can be added to Google Calendar at any time. Do not also keep the old "Cashflow" calendar
  (the Google app's own) switched on, or every bill shows twice.

## Cutover day (about 30 minutes)
1. Tell Dewi: from now until the end, nothing is entered in the Google app.
2. Stop the Google app's time triggers (each person's own, in their Apps Script: Triggers -> delete all), so nothing is sent or read twice.
3. Fresh copy of everything, so hand edits come across and the two never disagree:
   `node scripts/export-real.mjs` then `node scripts/migrate-real.mjs`, then load `private/real-seed.sql` into D1
   (`npx wrangler d1 execute cashflow --remote --file private/real-seed.sql`; the file starts by emptying the tables). This is the one
   moment the Google Sheet is the source; ask the owner before running it.
4. Switch the automatic notifications on: `npx wrangler d1 execute cashflow --remote --command "INSERT OR REPLACE INTO config (key, value) VALUES ('worker_push', 'on')"`.
5. Point the notifications site at Cloudflare, so phones can join: in the notification site's repository merge branch `cutover` (it changes the address
   in `index.js`, `notifikasi.js`, `index.html`, `notifikasi.html` from the Google script to the Cloudflare Worker) and deploy it (`npx wrangler deploy` in the karjimut folder).
   Every phone then opens Settings -> Notifications -> enable on this device once more (the old ones keep working until they are replaced).
6. Both people open the Cloudflare address, add it to the home screen, and send a test notification.
7. Watch for a day: the Worker alerts the owner by notification if Gmail stops being read. `node scripts/compare-data.mjs` is no longer
   needed; `/backup.csv` (signed in) downloads every transaction.

## Rolling back (the first month)
The Google Sheet and script are kept untouched. To go back: re-create the Google triggers (open the Google app once, it installs them),
set Config `worker_push` to empty in D1, repoint the site (revert the merge), and copy back what was entered on Cloudflare
(`/backup.csv` lists it).

## What is not carried over
- The CASHFLOW report formulas in the Sheet (the Sheet keeps them, but they stop updating).
- E-mails (weekly, monthly, payday, bills, close-day, notes-by-email): replaced by notifications and `/backup.csv` by the owner's choice.
- The yearly Gmail scan for yearly plans.

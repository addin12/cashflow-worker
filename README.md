# cashflow-worker

A household money tracker that runs entirely on Cloudflare's free plan: **Workers** (the app and its schedules), **D1** (the database), **Queues** (one email at a time) and **Access** (sign-in for the two people of the household).

It is the Cloudflare edition of [cashflow-tracker](https://github.com/addin12/cashflow-tracker), which is where the app's own logic (screens, parsers, planner, API) lives. `vendor/core` is a copy of that logic; `src/` is what makes it run on Workers and D1.

## What it does
- Serves the app's screens and API (`src/index.js`, `src/app.js`). Each request loads only the window of rows its screen needs, runs the app's own method, and writes the change in one atomic D1 batch (`src/unit.js`).
- Reads bank emails every minute through a separate mail-reader Worker ([household-mail](https://github.com/addin12/household-mail), bound as a service) and turns them into transactions (`src/sync.js`).
- Prices of stocks and gold every 30 minutes (`src/prices.js`), a calendar feed per person as an `.ics` file served by a tiny second Worker (`src/feed.js`, `src/feed-worker.js`), phone notifications through a small push relay (`src/push.js`), and a few daily jobs (`src/daily.js`).
- Only the two people of the household get in: Cloudflare Access signs them in, and the Worker checks the Access token itself (`src/access.js`).

## Set it up
1. `npm install`
2. Create a D1 database and load `schema.sql`.
3. Copy `wrangler.example.toml` to `wrangler.toml` (and `wrangler.feed.example.toml` to `wrangler.feed.toml`) and fill in your own values. Those two files are not committed.
4. Put the household in the database's `config` table (owner and partner names and emails, the mail accounts) and the app's data in its tables (`scripts/migrate-real.mjs` shows how one real household was moved in).
5. Secrets are set with `wrangler secret put`: `MAIL_TOKEN`, `VAPID_PRIVATE_KEY`, `HEARTBEAT_URL` (optional), and for the feed Worker `FEED_OWNER` and `FEED_PARTNER`.
6. `npm run deploy`.

## Tests
`npm test` runs the suite on a local stand-in for D1 (`test/d1shim.js`, SQLite with D1's limits). Everything in the tests is invented data.

## Notes
- `docs/CUTOVER.md` is the plan and the notes of moving a household from the earlier Google Sheets version.
- Free-plan limits shaped the design: 10 ms of CPU per request, 50 queries per request, 5 million rows read per day. `scripts/reads-estimate.mjs` shows where a day's reads go.
- No license has been chosen yet, so by default all rights are reserved.

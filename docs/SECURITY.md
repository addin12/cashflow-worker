# Security notes (reviewed 2026-11-12)

## How the app is protected
- **Who gets in:** Cloudflare Access (one-time code to one of two e-mails). The Worker does not trust that alone: it verifies the signed Access token itself (RS256 signature against the team's keys, issuer, this application's audience, expiry) and then checks the e-mail is one of the household's two (`src/access.js`, `src/identity.js`). A missing or weak secret never lets anyone in (`src/secret.js`, constant-time compare).
- **Other sites:** a POST that a browser says another site started (Sec-Fetch-Site or Origin) is refused with 403 (`crossSite` in `src/index.js`). The phone joining notifications is a GET navigation and needs a one-time code (30 minutes) anyway.
- **Headers on every answer:** `frame-ancestors 'none'` (nobody can frame the app), nosniff, no referrer, no camera/microphone/location. The page itself is one file with inline script, so a full script-src policy is not possible without a rebuild; the Worker only serves it after sign-in.
- **SQL:** every value is bound; the only interpolated pieces are constants, placeholder lists and one table name checked against a fixed list (`src/backup.js`).
- **Push:** the stored phone addresses are called only if they belong to a browser push service (`allowedEndpoint`); messages are encrypted (RFC 8291) and signed with a key that only the Worker holds (secret `VAPID_PRIVATE_KEY`).
- **Secrets** live in Cloudflare (Worker secrets), never in the repository; `private/` and `secrets/` are git-ignored.

## Audit of 2026-11-12 (quick profile, source only)
No critical, high or medium finding. Fixed afterwards: the unreadable-e-mail list, its dismiss action and the owner's phone alert now respect whose mailbox a line belongs to; the CSV guard quotes every text cell that starts with "-" unless it is a plain number; the calendar feed neutralises every line-break character; the Gmail layer validates message ids itself. Still open and outside the source: Access policy and session length, any rate-limit rule on the public Gmail-reader route, bucket privacy, dependency advisories (`npm audit`).

## Known and accepted
- API errors return up to 300 characters of the reason, only to the two signed-in people.
- The Gmail reader (`household-mail`) is reachable on the internet with a long bearer token (`MCP_TOKEN`) and no rate limit. It is read-only. If that token is ever shared or leaked, replace it (`wrangler secret put MCP_TOKEN` there, and `MAIL_TOKEN` here, and the token in the Claude connector).
- Inside each API method the arguments are validated by the app's core (`vendor/core`); that code was not re-audited line by line in this review.

## Watching
`src/heartbeat.js` pings an outside watchman every 10 minutes while the minute job finishes and the mail reader is not silent (secret `HEARTBEAT_URL`; healthchecks.io has a free plan). Silence there means the app is down, also when the database itself is blocked.

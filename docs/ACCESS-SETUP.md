# Signing in with Cloudflare Access (free for up to 50 people)

Until this is done the app opens with a private token (`secrets/app-token.txt`, used as `https://<worker>/login?token=...`). Access replaces that
with a normal sign-in for exactly the two people of the household.

Simplest and free: **"One-time PIN"** (Cloudflare e-mails a code to the address that is signing in; only addresses on the policy get one). No Google
OAuth client is needed.

1. Cloudflare dashboard -> **Zero Trust** (one.dash.cloudflare.com). First time: choose a team name (for example `household`), pick the **Free** plan.
   (If it asks for a card only to verify the free plan, say so before adding one: the plan itself costs nothing.)
2. **Workers & Pages** -> the Worker `cashflow` -> **Settings** -> **Domains & Routes** -> the `workers.dev` line -> turn on **Cloudflare Access**.
   This creates an Access application for `cashflow.<account>.workers.dev`.
3. Open that application in Zero Trust (Access -> Applications) and make its **policy**: Action *Allow*, rule *Emails*:
   the owner's address and both of the partner's addresses (the same ones as in the app's Config `owner_email` / `partner_email`).
   Login method: One-time PIN.
4. Copy two values from the application: its **Application Audience (AUD) tag**, and your **team domain** (`<team>.cloudflareaccess.com`, the `<team>` part).
   They are not secrets.
5. Give them to Claude (or run: `wrangler secret put ACCESS_TEAM` and `wrangler secret put ACCESS_AUD`, then `npm run deploy`).
   From then on the Worker ignores the token and accepts only a valid Access sign-in from the two addresses; anyone else gets a 403.

Check: open the Worker address in a private window: it must ask for your e-mail and a code; a third address must be refused.

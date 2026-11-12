// Routes an email to its bank parser. See common.js for the result shapes.
import { bodyToTokens, maskedOutline } from '../text.js';
import { bca } from './bca.js';
import { livin } from './livin.js';
import { bri } from './bri.js';
import { grab } from './grab.js';
import { blu } from './blu.js';
import { jago, sekuritas, gopay } from './others.js';
import { apple } from './apple.js';
import { SHOP_PARSERS, SHOP_QUERIES } from './shops.js';
import { fail, skip } from './common.js';

const PARSERS = [bca, livin, bri, grab, blu, jago, sekuritas, gopay, apple, ...SHOP_PARSERS];

/** Gmail search for every sender a parser exists for. */
export const SENDERS = [
  'bca@bca.co.id', 'noreply.livin@bankmandiri.co.id', 'receipts@blubybcadigital.id', 'noreply@jago.com', 'bankbri@bri.co.id', 'no-reply@grab.com',
  'corporate_action@mandirisekuritas.co.id', 'no-reply@customers.go-pay.co.id',
];

/**
 * What every account's mail was last read with. When it changes (a new sender, or PARSERS_REVISION bumped because a reader now
 * understands mail it used to skip), each account reads its mail again from the start date once.
 */
export const PARSERS_REVISION = 3; // 1: BRI · 2: BCA cash withdrawal · 3: Grab layouts (tip, mart, food, no payment line)
export const READ_SIGNATURE = `${SENDERS.join(',')}#${PARSERS_REVISION}`;

/**
 * Receipt searches run from the start date on every run (not only the last two days), so
 * receipts from before a parser existed are read too. Few emails, and read ones are skipped.
 */
const BACKFILL_QUERIES = ['from:no_reply@email.apple.com subject:receipt', ...SHOP_QUERIES];
export const backfillQuery = (afterSec) => `(${BACKFILL_QUERIES.map((q) => `(${q})`).join(' OR ')}) after:${afterSec}`;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {{id: string, from: string, subject: string, epochMs: number, body: string, isHtml: boolean}} email
 * @returns {{status: 'ok'|'skip'|'error', events?: object[], reason?: string, parser?: string}}
 */
export function parseEmail(email) {
  const out = readEmail(email);
  // An email nobody could read is logged with its masked outline (no names, numbers or amounts), so a reader can be fixed from the log.
  if (out.status === 'error') out.reason = `${out.reason} [outline: ${maskedOutline(bodyToTokens(email.body || '', email.isHtml))}]`;
  return out;
}

function readEmail(email) {
  const from = String(email.from || '').replace(/^.*<([^>]+)>.*$/, '$1').trim().toLowerCase();
  const tokens = bodyToTokens(email.body || '', email.isHtml);
  const msg = { ...email, from, subject: String(email.subject || ''), tokens, text: tokens.join('\n') };
  const parser = PARSERS.find((p) => p.matches(msg));
  if (!parser) return skip(`no parser for ${from}`);
  let res;
  try {
    res = parser.parse(msg);
  } catch (e) {
    return { ...fail(e.message), parser: parser.id };
  }
  if (res.status === 'ok') {
    for (const ev of res.events) {
      if (!DATE.test(ev.date || '') || !(ev.amount >= 0) || !ev.account?.institution) {
        return { ...fail(`incomplete event ${JSON.stringify(ev)}`), parser: parser.id };
      }
      ev.parser = parser.id;
    }
  }
  return { ...res, parser: parser.id };
}

/**
 * Does a reader already exist for mail like this? Only the sender and subject are known here, so a parser that also needs the
 * body to recognise its mail counts as missing: the coverage report may list a sender that is in fact read.
 */
export function hasReader(from, subject) {
  const address = String(from || '').replace(/^.*<([^>]+)>.*$/, '$1').trim().toLowerCase();
  return PARSERS.some((p) => { try { return p.matches({ from: address, subject: String(subject || ''), tokens: [], text: '' }); } catch (e) { return false; } });
}

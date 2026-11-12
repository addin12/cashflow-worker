// Bank accounts that emails mention but the Accounts tab doesn't know (a newcomer's first emails), and moving the
// transactions that waited for such an account onto it once it is added.
import { resolveAccount } from './accounts.js';

const NOT_RECOGNISED = /account not recognised \(([^)…]+?)(?:\s*…(\S+))?\)/g;

/** The (institution, hint) pairs a log line says were not recognised. */
function mentions(reason) {
  return [...String(reason || '').matchAll(NOT_RECOGNISED)].map((m) => ({ institution: m[1].trim(), hint: m[2] || '' }));
}

const sameMailbox = (line, mailboxes) => !line.gmail || mailboxes.includes(String(line.gmail).toLowerCase());

/**
 * @param {object[]} log  Inbox Log rows
 * @param {string[]} mailboxes  the person's own Google accounts (lowercase)
 * @param {object[]} accounts  the person's accounts (they may already match some)
 * @returns {{institution: string, hint: string, count: number}[]} biggest first; only what no account of the person matches yet
 */
export function unknownAccounts(log, mailboxes, accounts) {
  const found = new Map();
  for (const line of log) {
    if (!sameMailbox(line, mailboxes)) continue;
    for (const ref of mentions(line.reason)) {
      if (resolveAccount(ref, accounts, { strict: Boolean(ref.hint) })) continue; // with no number to compare, the person's only account there is the one
      const key = `${ref.institution.toLowerCase()}|${ref.hint}`;
      found.set(key, { ...ref, count: (found.get(key) || { count: 0 }).count + Math.max(Number(line.rows) || 1, 1) });
    }
  }
  return [...found.values()].sort((a, b) => b.count - a.count);
}

/**
 * Transactions with no account whose email was "not recognised" for what `account` now matches: they get that account.
 * @returns {{id: string, changes: {stream: string}}[]}
 */
export function adoptRows(log, rows, account) {
  const ids = new Set();
  for (const line of log) {
    if (mentions(line.reason).some((ref) => resolveAccount(ref, [account], { strict: Boolean(ref.hint) }))) ids.add(String(line.gmail_id));
  }
  return rows
    .filter((r) => !r.stream && ids.has(String(r.gmail_id)) && (!r.owner || !account.owner || r.owner === account.owner))
    .map((r) => ({ id: r.id, changes: { stream: account.stream } }));
}

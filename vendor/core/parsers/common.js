// Shared pieces of the bank parsers.
//
// A parser gets an email { id, from, subject, epochMs, tokens, text } and returns one of:
//   { status: 'ok', events: [Event, ...] }
//   { status: 'skip', reason }     not a money movement (promo, failed payment, pocket creation…)
//   { status: 'error', reason }    looked like a transaction but could not be read
//
// Event (money moving in or out of ONE of the owner's accounts):
//   type         'payment' | 'transfer' | 'topup' | 'income' | 'dividend' | 'summary'
//   direction    'in' | 'out' (relative to `account`)
//   amount       principal, without fee
//   fee          bank fee charged on top (0 if none)
//   date, time   'YYYY-MM-DD', 'HH:MM:SS' in WIB ('' when the email has no time)
//   account      { institution, hint?, pocket? }   which of the owner's accounts
//   counterparty { name, institution?, account? }  merchant / payee / payer
//   description  short text for the ledger (merchant or person)
//   details      extra info (QRIS, location, note)
//   refNo        bank reference number

import { parseAmount } from '../money.js';

const INSTITUTIONS = [
  [/blu by bca|\bblu\b|bca digital/i, 'blu'],
  [/bank central asia|\bbca\b/i, 'BCA'],
  [/mandiri sekuritas/i, 'Mandiri Sekuritas'],
  [/mandiri/i, 'Mandiri'],
  [/jago/i, 'Jago'],
  [/gopay|go-pay/i, 'GoPay'],
  [/\bdana\b|danatopup/i, 'DANA'],
  [/e-?money/i, 'e-money'],
  [/\bovo\b/i, 'OVO'],
  [/shopee ?pay/i, 'ShopeePay'],
  [/bank rakyat|\bbri\b/i, 'BRI'],
  [/bank negara|\bbni\b/i, 'BNI'],
  [/tabungan negara|\bbtn\b/i, 'BTN'],
  [/\bcimb\b/i, 'CIMB Niaga'],
  [/seabank/i, 'SeaBank'],
];

/** Canonical institution name, or '' when the text names no known bank / wallet. */
export function knownInstitution(raw) {
  const s = String(raw || '').trim();
  for (const [re, name] of INSTITUTIONS) if (re.test(s)) return name;
  return '';
}

/**
 * "UMAR ZULKIFLI BCA" -> { name: 'UMAR ZULKIFLI', institution: 'BCA' }: the shortest run of
 * trailing words (up to 4) that names a known bank. No bank -> the whole text is the name.
 */
export function splitNameBank(raw) {
  const words = String(raw || '').trim().split(/\s+/).filter(Boolean);
  for (let k = 1; k <= Math.min(4, words.length - 1); k += 1) {
    const bank = knownInstitution(words.slice(-k).join(' '));
    if (bank) {
      const name = words.slice(0, -k);
      while (name.length > 1 && /^(bank|bk)$/i.test(name[name.length - 1])) name.pop(); // "… BANK JAGO"
      return { name: name.join(' '), institution: bank };
    }
  }
  return { name: words.join(' '), institution: '' };
}

/** Canonical institution name, or the trimmed input when unknown. */
export function institutionOf(raw) {
  return knownInstitution(raw) || String(raw || '').trim();
}

export const ok = (...events) => ({ status: 'ok', events });
export const skip = (reason) => ({ status: 'skip', reason });
export const fail = (reason) => ({ status: 'error', reason });

/** Amount or throws (a transaction without a readable amount is an error, not a skip). */
export function amountOf(raw, what = 'amount') {
  const v = parseAmount(raw);
  if (!Number.isFinite(v) || v <= 0) throw new Error(`no ${what} found (${JSON.stringify(raw)})`);
  return v;
}

export function feeOf(raw) {
  const v = parseAmount(raw);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** "-" and empty remarks mean "no remark". */
export function remark(raw) {
  const s = String(raw || '').trim();
  return s === '-' ? '' : s;
}

export function joinDetails(...parts) {
  return parts.map((p) => String(p || '').trim()).filter(Boolean).join(' · ');
}

/**
 * "AFIFAH KHOERIAH Bank Mandiri - 1310019980103" or name + "Bank Central Asia - 7410702775"
 * -> { name, institution, account }.
 */
export function splitPayee(first, second = '') {
  const tail = /^(.*?)\s*-\s*(\d[\d ]{5,})$/;
  if (tail.test(second)) {
    const [, bank, acct] = second.match(tail);
    return { name: first.trim(), institution: institutionOf(bank), account: acct.replace(/\s/g, '') };
  }
  const m = first.match(/^(.*?)\s*-\s*(\d[\d ]{5,})$/);
  if (!m) return { name: first.trim() };
  const left = m[1].trim();
  const account = m[2].replace(/\s/g, '');
  const at = left.search(/\sBank\s/i);
  if (at >= 0) return { name: left.slice(0, at).trim(), institution: institutionOf(left.slice(at + 1)), account };
  return { ...splitNameBank(left), account };
}

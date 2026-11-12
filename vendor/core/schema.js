// Layout of the tabs the app owns, and the fixed coordinates of the template.
// Everything that touches a cell address goes through this file.


export const TABS = {
  transactions: 'Transactions',
  accounts: 'Accounts',
  rules: 'Rules',
  connections: 'Connections',
  config: 'Config',
  inboxLog: 'Inbox Log',
  preview: 'Preview',
  budgets: 'Budgets',
  goals: 'Goals',
  owed: 'Tagih',
  plans: 'Rutin',
  assets: 'Aset',
  selfTest: 'Self-test',
};

export const BUDGET_HEADERS = ['category', 'monthly_budget', 'scope']; // scope: empty = Kita (the household), or one person's name

export const GOAL_HEADERS = ['stream', 'name', 'target', 'target_date'];

// Money friends owe you for a payment you made ("Tagih").
export const OWED_HEADERS = ['id', 'tx_id', 'who', 'amount', 'note', 'date', 'status', 'paid_at'];
// Transactions you plan (rent, cash bills): put in Review (or saved) on their day each month.
export const PLAN_HEADERS = ['id', 'name', 'amount', 'direction', 'stream', 'category', 'day', 'auto', 'last', 'active'];
// What you own and owe beyond the accounts; price is a GOOGLEFINANCE formula when a ticker is set.
// price and price_at (epoch ms) are written by the script from Yahoo / Google Finance (gas/prices.js).
export const ASSET_HEADERS = ['id', 'name', 'kind', 'qty', 'unit_value', 'ticker', 'price', 'paid', 'notes', 'price_at', 'warranty'];

export const INBOX_LOG_HEADERS = ['gmail_id', 'received', 'from', 'subject', 'status', 'parser', 'reason', 'rows', 'gmail'];

// Column order matters: formulas reference these letters (see TX_COL).
export const TRANSACTION_HEADERS = [
  'id', 'date', 'time', 'owner', 'stream', 'direction', 'amount', 'category',
  'description', 'details', 'source', 'sender', 'gmail', 'gmail_id', 'ref_no',
  'status', 'transfer_id', 'rule_id', 'updated_by', 'updated_at',
];

export const ACCOUNT_HEADERS = ['stream', 'type', 'owner', 'institution', 'match_hint', 'opening_balance', 'notes'];

export const RULE_HEADERS = ['id', 'field', 'pattern', 'category', 'stream_override', 'auto_approve', 'hits', 'created_by', 'created_at'];

export const CONNECTION_HEADERS = ['gmail', 'owner', 'method', 'connected_at', 'last_sync', 'last_status', 'seen', 'parsed', 'skipped', 'errors', 'checkpoint'];

// Config tab: key in column A, value in column B. Row numbers are fixed so named ranges stay valid.
export const CONFIG_KEYS = [
  { key: 'start_date', name: 'CFG_START_DATE', note: 'First day the sync reads email from' },
  { key: 'payday_day', name: 'CFG_PAYDAY', note: 'Day of the month salary arrives (1-31)' },
  { key: 'owner_name', name: 'CFG_OWNER', note: 'Short name used as the owner of rows' },
  { key: 'setup_version', name: 'CFG_SETUP_VERSION', note: 'Written by setup; do not edit' },
  { key: 'last_selftest', name: 'CFG_LAST_SELFTEST', note: 'Result of the last self-test' },
  // Added in setup version 2 (rows are only ever appended, so named ranges stay valid).
  { key: 'owner_bank_names', name: 'CFG_OWNER_BANK_NAMES', note: 'Your name as banks print it (comma-separated); used to spot transfers between your own accounts' },
  { key: 'sync_mode', name: 'CFG_SYNC_MODE', note: 'live = write to Transactions; preview = write to the Preview tab only; empty = app default' },
  { key: 'cat_transfer', name: 'CFG_CAT_TRANSFER', note: 'Category for transfers between your own accounts' },
  { key: 'cat_fee', name: 'CFG_CAT_FEE', note: 'Category for bank fees' },
  { key: 'cat_dividend', name: 'CFG_CAT_DIVIDEND', note: 'Category for dividends' },
  { key: 'language', name: 'CFG_LANGUAGE', note: 'Web app language: id or en (empty = follow the phone)' },
  // Added in setup version 8.
  { key: 'weekly_email', name: 'CFG_WEEKLY_EMAIL', note: 'Weekly summary email on Mondays: on / off' },
  // Added in setup version 9.
  { key: 'monthly_email', name: 'CFG_MONTHLY_EMAIL', note: 'Monthly report email on the 1st: on / off' },
  { key: 'payday_email', name: 'CFG_PAYDAY_EMAIL', note: 'Balance-check reminder email on payday: on / off' },
  { key: 'archives', name: 'CFG_ARCHIVES', note: 'Copies of finished years ("2026 <link>", one per line); written at New Year' },
  { key: 'archived', name: 'CFG_ARCHIVED', note: 'Set in an archive copy (the year it holds); an archive never syncs' },
  // Added in setup version 13.
  { key: 'salary_stream', name: 'CFG_SALARY_STREAM', note: 'Account the salary is paid into (no email reports it, so the app asks on payday)' },
  { key: 'salary_amount', name: 'CFG_SALARY_AMOUNT', note: 'Usual salary, suggested on the salary card (the last one recorded)' },
  { key: 'salary_skipped', name: 'CFG_SALARY_SKIPPED', note: 'Months without salary (YYYY-MM, comma-separated)' },
  { key: 'opening_checks', name: 'CFG_OPENING_CHECKS', note: 'Date each opening balance was set from a balance check (JSON); written by the app' },
  { key: 'summary_period', name: 'CFG_SUMMARY_PERIOD', note: 'Summary per calendar month (month) or from payday to payday (payday)' },
  { key: 'recurring_hidden', name: 'CFG_RECURRING_HIDDEN', note: 'Payees marked "not a subscription" (one per line)' },
  // Added in setup version 15.
  { key: 'balance_checks', name: 'CFG_BALANCE_CHECKS', note: 'Date of the last balance check per account (JSON); written by the app' },
  { key: 'big_amount', name: 'CFG_BIG_AMOUNT', note: 'Spending from this amount up is flagged in the bell and the weekly email (empty = Rp1.000.000, 0 = off)' },
  // Added in setup version 16.
  { key: 'imports', name: 'CFG_IMPORTS', note: 'Bank statement imports (JSON, newest first); each can be undone in the app' },
  // Added in setup version 17.
  { key: 'recurring_marks', name: 'CFG_RECURRING_MARKS', note: 'Subscriptions marked keep or stop (JSON by payee)' },
  // Added in setup version 19.
  { key: 'price_status', name: 'CFG_PRICE_STATUS', note: 'Last market-price run: how many priced, and why any failed' },
  // Added in setup version 20.
  { key: 'tag_budgets', name: 'CFG_TAG_BUDGETS', note: 'Budgets for #tags such as a trip (JSON: tag -> amount)' },
  { key: 'closed_days', name: 'CFG_CLOSED_DAYS', note: 'Days closed with "Tutup hari" (YYYY-MM-DD, newest first)' },
  { key: 'bill_email', name: 'CFG_BILL_EMAIL', note: 'Email the morning before a bill is due: on / off' },
  { key: 'close_email', name: 'CFG_CLOSE_EMAIL', note: 'Email at 21:00 when nothing was logged by hand today: on / off (default off)' },
  // Added in setup version 21.
  { key: 'cards', name: 'CFG_CARDS', note: 'Credit cards and paylater (JSON: account, statement day, due day)' },
  { key: 'yearly_subs', name: 'CFG_YEARLY_SUBS', note: 'Yearly plans found in older Gmail receipts (JSON, written by the app)' },
  { key: 'yearly_scan', name: 'CFG_YEARLY_SCAN', note: 'When Gmail was last read for yearly plans' },
  { key: 'calendar_sync', name: 'CFG_CALENDAR_SYNC', note: 'Bills, payday and renewals in a "Cashflow" Google Calendar: on / off (default off)' },
  { key: 'calendar_id', name: 'CFG_CALENDAR_ID', note: 'The Cashflow calendar (written by the app)' },
  { key: 'calendar_status', name: 'CFG_CALENDAR_STATUS', note: 'Last calendar update: events, or why it failed' },
  // Added in setup version 22.
  { key: 'push_devices', name: 'CFG_PUSH_DEVICES', note: 'Phones that get notifications (JSON, written by the app; private)' },
  { key: 'push_events', name: 'CFG_PUSH_EVENTS', note: 'Which notifications: new, big, bills, payday, close (empty = all but close; none = off)' },
  { key: 'push_nonce', name: 'CFG_PUSH_NONCE', note: 'One-time code for adding a phone (written by the app)' },
  // Added in setup version 23.
  { key: 'partner_email', name: 'CFG_PARTNER_EMAIL', note: 'Your partner\'s Google account(s), comma-separated: the spreadsheet is shared with them and they can use the app' },
  { key: 'partner_name', name: 'CFG_PARTNER_NAME', note: 'Short name used as the owner of your partner\'s rows' },
  { key: 'partner_bank_names', name: 'CFG_PARTNER_BANK_NAMES', note: 'Your partner\'s name as banks print it (comma-separated): money between you two is a transfer' },
  // Added in setup version 25.
  { key: 'owner_email', name: 'CFG_OWNER_EMAIL', note: 'Your Google account (written by your own sync): only it is shown as you in the app' },
  // Added in setup version 26.
  { key: 'claims', name: 'CFG_CLAIMS', note: 'Insurance claims to make (JSON: transaction id -> status and deadline; written by the app)' },
  { key: 'claim_days', name: 'CFG_CLAIM_DAYS', note: 'Days after a payment to claim it from the insurer (default 30)' },
];

// Settings each of the two people has for themselves. The owner's are the plain keys; the partner's
// are the same key behind "partner_" (added in setup version 27, after every other key so the rows
// of the earlier ones don't move).
export const PERSONAL_KEYS = [
  'payday_day', 'salary_stream', 'salary_amount', 'salary_skipped', 'closed_days', 'calendar_sync', 'calendar_id', 'calendar_status',
  'yearly_scan', 'push_events', 'weekly_email', 'monthly_email', 'payday_email', 'bill_email', 'close_email',
];
for (const key of PERSONAL_KEYS) {
  const base = CONFIG_KEYS.find((k) => k.key === key);
  CONFIG_KEYS.push({ key: `partner_${key}`, name: `CFG_PARTNER_${key.toUpperCase()}`, note: `Your partner's own: ${base.note}` });
}

// Added in setup version 28, after the partner's twins so no earlier row moves.
CONFIG_KEYS.push(
  { key: 'shared_split', name: 'CFG_SHARED_SPLIT', note: 'Shared costs (#bersama): the first person\'s part in percent (default 50; the rest is the partner\'s)' },
  { key: 'settlements', name: 'CFG_SETTLEMENTS', note: 'Settle-ups between the two of you (JSON, written by the app)' },
);

// Added in setup version 43: always at the very END. Each setting is found by its place in this list (row = index + 2), so a key
// put anywhere else moves every later key onto the wrong row (the sync read "archived" from another row and stopped).
CONFIG_KEYS.push(
  { key: 'cat_cash', name: 'CFG_CAT_CASH', note: 'Category for cash withdrawals (Tarik Tunai)' },
);

export const STATUS = ['pending', 'approved', 'ignored'];
export const DIRECTION = ['in', 'out'];
export const ACCOUNT_TYPES = ['Spending', 'Saving'];

/** Spreadsheet column letter for a 0-based index. */
export function colLetter(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Letter of a Transactions column by header name. */
export const TX_COL = Object.fromEntries(TRANSACTION_HEADERS.map((h, i) => [h, colLetter(i)]));

// ---- Template coordinates (CASHFLOW and friends) -------------------------------------------

export const CF = {
  sheet: 'CASHFLOW',
  firstDataRow: 6, // ledger rows B6:H (the template's input area)
  monthCols: ['L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W'],
  incomeRows: [5, 10], // K5:K10, sums Debit (G)
  expenseRows: [11, 38], // K11:K38, sums Credit (H)
  adjustmentRow: 39, // K39 "Penyesuaian", sums Credit
  transferRow: 40, // K40 "trf ke bank lain", sums Credit
  // Streams: per-stream IN/OUT blocks. Name row n = 67 + 4i, IN n+1, OUT n+2 (i = 0..15).
  streamBlockFirstRow: 67,
  streamBlockCount: 16,
  spendingStreamRows: [46, 53],
  savingStreamRows: [55, 62],
  payday: { today: 'Y50', payday: 'Y52', label: 'Y53', daysLeft: 'Y54', perDay: 'Y56' },
};

export const SLOTS = { income: 6, expense: 28, spending: 8, saving: 8 };

export const FIXED_CATEGORIES = { adjustment: 'Penyesuaian', transfer: 'trf ke bank lain' };

/** Placeholder written into unused category / stream slots so lookups never see blanks. */
export const EMPTY_SLOT = '-';

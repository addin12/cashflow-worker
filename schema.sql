DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS accounts;
DROP TABLE IF EXISTS budgets;
DROP TABLE IF EXISTS recurring;
DROP TABLE IF EXISTS monthly_totals;
DROP TABLE IF EXISTS rules;
DROP TABLE IF EXISTS inbox_log;
DROP TABLE IF EXISTS tabs;
DROP TABLE IF EXISTS config;
DROP TABLE IF EXISTS stream_months;
DROP TABLE IF EXISTS places_seen;
-- Transactions are relational (SQL does the sums); every column of the app's TRANSACTION_HEADERS, plus place_key and shared
CREATE TABLE transactions (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, time TEXT NOT NULL DEFAULT '', owner TEXT NOT NULL DEFAULT '', stream TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL, amount REAL NOT NULL, category TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '', sender TEXT NOT NULL DEFAULT '', gmail TEXT NOT NULL DEFAULT '', gmail_id TEXT NOT NULL DEFAULT '', ref_no TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL, transfer_id TEXT NOT NULL DEFAULT '', rule_id TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '',
  place_key TEXT NOT NULL DEFAULT '',  -- placeKey(description), set whenever the row is written
  shared INTEGER NOT NULL DEFAULT 0    -- 1 when the description has #bersama (so it can be found by an index, not a text scan)
);
CREATE INDEX idx_tx_date ON transactions(date);
CREATE INDEX idx_tx_stream_date ON transactions(stream, date);
CREATE INDEX idx_tx_status ON transactions(status);
CREATE INDEX idx_tx_gmail ON transactions(gmail_id);
CREATE INDEX idx_tx_ref ON transactions(ref_no);
CREATE INDEX idx_tx_category ON transactions(category);
CREATE INDEX idx_tx_shared ON transactions(shared);
CREATE INDEX idx_tx_place ON transactions(place_key);
-- Every other tab of the old Sheet: small, read whole, one JSON document per row; id = the tab's first column
CREATE TABLE tabs (tab TEXT NOT NULL, id TEXT NOT NULL DEFAULT '', json TEXT NOT NULL);
CREATE INDEX idx_tabs_tab ON tabs(tab, id);
CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');
-- Stored summaries, kept up to date when rows are written, so a screen never has to read the old history:
-- income and expense of each pay month per view ('' = Kita)
CREATE TABLE monthly_totals (owner TEXT NOT NULL, month TEXT NOT NULL, income REAL NOT NULL, expense REAL NOT NULL, PRIMARY KEY (owner, month));
-- what each account gained or lost in each pay month (approved rows that are not kept as rows: see unit.js KEEP), summed for the history before a window
CREATE TABLE stream_months (stream TEXT NOT NULL, month TEXT NOT NULL, net REAL NOT NULL, PRIMARY KEY (stream, month));
-- the first date each place was paid, per owner ('' = everyone), for the "first time" mark
CREATE TABLE places_seen (owner TEXT NOT NULL, place_key TEXT NOT NULL, first_date TEXT NOT NULL, PRIMARY KEY (owner, place_key));

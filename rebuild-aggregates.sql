-- Rebuilds the stored summaries (stream_months, places_seen) from the transactions: after a bulk load or a migration, or to repair them.
-- (monthly_totals needs the app's own code: see scripts/gen-seed.mjs and the unit of work.)
UPDATE transactions SET shared = CASE WHEN description LIKE '%#bersama%' THEN 1 ELSE 0 END;
DELETE FROM stream_months;
INSERT INTO stream_months (stream, month, net)
SELECT stream,
       CASE WHEN CAST(substr(date, 9, 2) AS INTEGER) >= 28 THEN strftime('%Y-%m', date(substr(date, 1, 7) || '-01', '+1 month')) ELSE substr(date, 1, 7) END AS month,
       SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END)
FROM transactions
WHERE status = 'approved' AND shared = 0 AND category != COALESCE((SELECT value FROM config WHERE key = 'salary_category'), '')
GROUP BY stream, month;
DELETE FROM places_seen;
INSERT INTO places_seen (owner, place_key, first_date)
SELECT owner, place_key, MIN(date) FROM transactions
WHERE direction = 'out' AND status NOT IN ('ignored', 'pending') AND shared = 0
  AND category NOT IN ('Penyesuaian', COALESCE((SELECT value FROM config WHERE key = 'cat_transfer'), 'trf ke bank lain'))
  AND category != COALESCE((SELECT value FROM config WHERE key = 'salary_category'), '') AND ref_no NOT LIKE 'split:%' AND place_key != ''
GROUP BY owner, place_key;
INSERT OR IGNORE INTO places_seen (owner, place_key, first_date)
SELECT '', place_key, MIN(date) FROM transactions
WHERE direction = 'out' AND status NOT IN ('ignored', 'pending') AND shared = 0
  AND category NOT IN ('Penyesuaian', COALESCE((SELECT value FROM config WHERE key = 'cat_transfer'), 'trf ke bank lain'))
  AND category != COALESCE((SELECT value FROM config WHERE key = 'salary_category'), '') AND ref_no NOT LIKE 'split:%' AND place_key != ''
GROUP BY place_key;

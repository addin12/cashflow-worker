// Synthetic data for the self-test. Fake names and round numbers only. It deliberately covers:
// every month (incl. May/Aug/Oct/Dec, which a locale-dependent TEXT(date,"mmm") would miss),
// unused "-" slots, transfers, adjustments, rows that must NOT count (pending, ignored, other
// year), and both edges of a month (1st 00:00 and last day 23:59).

export const SAMPLE_YEAR = 2026;

export const SAMPLE_CATEGORIES = {
  income: ['Gaji', 'Freelance', 'Dividen', 'Cashback', 'Hadiah'], // 5 of 6 -> one "-" slot
  expense: [
    'Makan', 'Belanja Harian', 'Belanja Online', 'Transport', 'Langganan', 'Hobi', 'Buku',
    'Kesehatan', 'Perawatan', 'Tagihan', 'Pulsa', 'Rumah Tangga', 'Pakaian', 'Hiburan',
    'Hadiah Keluar', 'Iuran', 'Pendidikan', 'Biaya Admin', 'Pengeluaran Lainnya', 'Donasi',
  ], // 20 of 28 -> eight "-" slots
};

export const SAMPLE_ACCOUNTS = [
  { stream: 'Bank A', type: 'Spending', owner: 'Tester', opening_balance: 5000000 },
  { stream: 'Bank B', type: 'Spending', owner: 'Tester', opening_balance: 1000000 },
  { stream: 'E-wallet', type: 'Spending', owner: 'Tester', opening_balance: 100000 },
  { stream: 'Cash', type: 'Spending', owner: 'Tester', opening_balance: 200000 },
  { stream: 'Tabungan', type: 'Saving', owner: 'Tester', opening_balance: 10000000 },
  { stream: 'Saham', type: 'Saving', owner: 'Tester', opening_balance: 0 },
];

const pad2 = (n) => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(y, m, 0).getDate();

/** Deterministic sample transactions. time is a fraction of a day (0..1). */
export function sampleTransactions(year = SAMPLE_YEAR) {
  const tx = [];
  let n = 0;
  const add = (m, d, time, stream, direction, amount, category, status = 'approved', y = year) => {
    n += 1;
    tx.push({
      id: `t_sample_${n}`, date: `${y}-${pad2(m)}-${pad2(d)}`, time, owner: 'Tester', stream, direction,
      amount, category, description: `sample ${n}`, details: '', source: 'selftest', status,
    });
  };
  const exp = SAMPLE_CATEGORIES.expense;
  for (let m = 1; m <= 12; m += 1) {
    add(m, 1, 0, 'Bank A', 'out', 10000 * m, exp[m % exp.length]); // first minute of the month
    add(m, 28, 0.375, 'Bank A', 'in', 8000000, 'Gaji');
    add(m, 5, 0.5, 'Bank B', 'out', 25000 + m * 1000, exp[(m + 3) % exp.length]);
    add(m, 12, 0.75, 'E-wallet', 'out', 15000, exp[(m * 7) % exp.length]);
    add(m, 15, 0.4, 'Cash', 'out', 50000, 'Makan');
    add(m, lastDay(year, m), 0.99930556, 'Bank B', 'out', 1000 * m, 'Biaya Admin'); // 23:59 on the last day
    // Own-account transfer Bank A -> Tabungan: two legs, category "trf ke bank lain".
    add(m, 20, 0.6, 'Bank A', 'out', 1000000, 'trf ke bank lain');
    add(m, 20, 0.6, 'Tabungan', 'in', 1000000, 'trf ke bank lain');
    if (m % 3 === 0) add(m, 10, 0.3, 'Saham', 'in', 250000, 'Dividen');
    if (m % 2 === 0) add(m, 18, 0.55, 'Bank B', 'in', 1500000, 'Freelance');
    if (m === 6 || m === 12) add(m, 30, 0.9, 'E-wallet', 'out', 12345, 'Penyesuaian');
    if (m === 8) add(m, 17, 0.5, 'E-wallet', 'in', 5000, 'Cashback');
  }
  // Rows that must not reach the reports.
  add(3, 3, 0.5, 'Bank A', 'out', 999999, 'Makan', 'pending');
  add(4, 4, 0.5, 'Bank A', 'out', 888888, 'Makan', 'ignored');
  add(12, 31, 0.5, 'Bank A', 'out', 777777, 'Makan', 'approved', year - 1);
  add(1, 1, 0.5, 'Bank A', 'in', 666666, 'Gaji', 'approved', year + 1);
  return tx;
}

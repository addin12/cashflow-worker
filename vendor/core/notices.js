// The other emails the app sends by itself: the monthly report (on the 1st), the payday reminder
// to check balances, and an alert when the sync has a problem. Pure: data in, subject + HTML out.

const num = (v) => Number(v) || 0;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rp = (n) => `${num(n) < 0 ? '−' : ''}Rp${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.abs(Math.round(num(n))))}`;
const MONTHS = {
  id: ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
const monthName = (ym, lang) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[lang][m - 1]} ${y}`; };
export const prevMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };

/**
 * Last month next to the month before: totals, saving rate, every expense category with its change.
 * @param {{rows, cats: {income, expense}, budgets, month: 'YYYY-MM'}} input  month = the month reported on
 */
export function monthlyReport({ rows, cats, budgets, month }) {
  const before = prevMonth(month);
  const inc = new Set(cats.income);
  const exp = new Set(cats.expense);
  const total = (m) => {
    const list = rows.filter((r) => r.status === 'approved' && String(r.date).startsWith(m));
    const byCat = new Map();
    let income = 0;
    let expense = 0;
    for (const r of list) {
      if (r.direction === 'in' && inc.has(r.category)) income += num(r.amount);
      if (r.direction === 'out' && exp.has(r.category)) { expense += num(r.amount); byCat.set(r.category, (byCat.get(r.category) || 0) + num(r.amount)); }
    }
    return { income, expense, byCat };
  };
  const now = total(month);
  const then = total(before);
  const categories = [...new Set([...now.byCat.keys(), ...then.byCat.keys()])]
    .map((category) => ({ category, amount: now.byCat.get(category) || 0, before: then.byCat.get(category) || 0 }))
    .map((c) => ({ ...c, change: c.amount - c.before }))
    .sort((a, b) => b.amount - a.amount);
  const budgetRows = budgets.filter((b) => num(b.monthly_budget) > 0)
    .map((b) => ({ category: b.category, budget: num(b.monthly_budget), spent: now.byCat.get(b.category) || 0 }))
    .map((b) => ({ ...b, over: b.spent > b.budget }));
  return {
    month, before, income: now.income, expense: now.expense, net: now.income - now.expense,
    savingRate: now.income > 0 ? Math.round(((now.income - now.expense) / now.income) * 100) : null,
    beforeIncome: then.income, beforeExpense: then.expense, categories, budgets: budgetRows,
  };
}

const L = {
  id: {
    monthSubject: (m) => `Laporan bulanan Cashflow · ${m}`, monthTitle: (m) => `Laporan ${m}`, vs: (m) => `dibanding ${m}`,
    income: 'Pemasukan', expense: 'Pengeluaran', net: 'Sisa', rate: (p) => `Ditabung ${p}% dari pemasukan`, noRate: 'Belum ada pemasukan bulan ini.',
    cats: 'Pengeluaran per kategori', more: (v) => `naik ${v}`, less: (v) => `turun ${v}`, same: 'sama', budgets: 'Budget', over: (v) => `lebih ${v}`, left: (v) => `sisa ${v}`,
    goals: 'Target tabungan', goalLine: (p, l) => `${p}% · kurang ${l}`, goalDone: 'Tercapai',
    backupNote: 'Cadangan semua transaksi terlampir (file CSV). Simpan di tempat yang aman.', open: 'Buka aplikasi', monthFooter: 'Dikirim setiap tanggal 1. Matikan di Pengaturan → Email otomatis.',
    paySubject: 'Gajian! Waktunya cek saldo rekening', payTitle: 'Waktunya cek saldo',
    payIntro: 'Hari ini tanggal gajian. Catat dulu gaji Anda di Cek (bank tidak mengirim email untuk uang masuk). Lalu bandingkan saldo di aplikasi bank dengan saldo di Cashflow. Kalau berbeda, isi saldo aslinya di Pengaturan → Cek saldo akhir bulan; selisihnya dicatat sebagai Penyesuaian.',
    payTable: 'Saldo menurut Cashflow hari ini', payFooter: 'Dikirim setiap tanggal gajian. Matikan di Pengaturan → Email otomatis.',
    alertSubject: 'Cashflow: sinkron Gmail bermasalah', alertTitle: 'Sinkron Gmail bermasalah',
    alertError: 'Sinkron terakhir gagal dengan pesan ini:', alertUnread: (n) => `${n} email bank baru belum bisa dibaca. Isi manual di aplikasi (Cek → Email yang belum terbaca), atau tunggu perbaikan.`,
    alertFooter: 'Email ini dikirim paling banyak sekali per 12 jam untuk masalah yang sama.',
    alertStale: (list) => `Sinkron Gmail berhenti untuk: ${list}. Email dari akun itu tidak masuk sampai sinkronnya jalan lagi.`, alertStaleHow: 'Perbaikannya: buka aplikasi dengan akun Google itu, lalu tekan “Sinkron sekarang”. Pemicunya dipasang ulang otomatis.', staleLine: (who, gmail, h) => `${who} (${gmail}): ${h} jam tanpa sinkron`,
    selftestSubject: 'Cashflow: uji otomatis menemukan masalah', selftestTitle: 'Uji otomatis menemukan masalah',
    selftestIntro: (n, c) => `Uji otomatis mingguan memeriksa ${c} sel laporan di spreadsheet; ${n} tidak sesuai. Data transaksi Anda aman, tapi angka laporan mungkin salah sampai diperbaiki. Contoh:`,
  },
  en: {
    monthSubject: (m) => `Cashflow monthly report · ${m}`, monthTitle: (m) => `${m} report`, vs: (m) => `compared with ${m}`,
    income: 'Income', expense: 'Expenses', net: 'Left', rate: (p) => `Saved ${p}% of income`, noRate: 'No income this month yet.',
    cats: 'Expenses by category', more: (v) => `up ${v}`, less: (v) => `down ${v}`, same: 'same', budgets: 'Budgets', over: (v) => `${v} over`, left: (v) => `${v} left`,
    goals: 'Savings goals', goalLine: (p, l) => `${p}% · ${l} to go`, goalDone: 'Reached',
    backupNote: 'A backup of every transaction is attached (a CSV file). Keep it somewhere safe.', open: 'Open the app', monthFooter: 'Sent on the 1st of every month. Turn it off in Settings → Automatic emails.',
    paySubject: 'Payday! Time to check your balances', payTitle: 'Time to check your balances',
    payIntro: 'It’s payday. First record your salary in Review (banks send no email for money coming in). Then compare the balance in your bank apps with Cashflow. If one differs, enter the real balance in Settings → Month-end balance check; the difference is recorded as an Adjustment.',
    payTable: 'Balances according to Cashflow today', payFooter: 'Sent every payday. Turn it off in Settings → Automatic emails.',
    alertSubject: 'Cashflow: the Gmail sync has a problem', alertTitle: 'The Gmail sync has a problem',
    alertError: 'The last sync stopped with this message:', alertUnread: (n) => `${n} new bank email(s) couldn’t be read. Enter them by hand in the app (Review → Emails not understood), or wait for a fix.`,
    alertFooter: 'Sent at most once every 12 hours for the same problem.',
    alertStale: (list) => `The Gmail sync has stopped for: ${list}. Email from that account is not coming in until its sync runs again.`, alertStaleHow: 'The fix: open the app with that Google account and press “Sync now”. Its trigger is put back automatically.', staleLine: (who, gmail, h) => `${who} (${gmail}): ${h} hours without a sync`,
    selftestSubject: 'Cashflow: the self-test found a problem', selftestTitle: 'The self-test found a problem',
    selftestIntro: (n, c) => `The weekly self-test checked ${c} report cells in the spreadsheet; ${n} were wrong. Your transactions are safe, but report numbers may be off until it is fixed. For example:`,
  },
};

const wrap = (parts) => `<div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1d1d1f;max-width:560px;margin:0 auto;padding:16px">${parts.join('\n')}</div>`;
const row = (left, right, sub = '') => `<tr><td style="padding:10px 0;border-bottom:1px solid #eee;font-size:16px">${esc(left)}${sub ? `<div style="color:#6e6e73;font-size:14px">${esc(sub)}</div>` : ''}</td><td style="padding:10px 0;border-bottom:1px solid #eee;font-size:16px;text-align:right;white-space:nowrap">${right}</td></tr>`;
const section = (title, body) => `<h2 style="font-size:19px;margin:28px 0 8px">${esc(title)}</h2><table style="width:100%;border-collapse:collapse">${body}</table>`;
const button = (url, label) => (url ? `<p style="margin:28px 0"><a href="${esc(url)}" style="background:#0066cc;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-size:16px;display:inline-block">${esc(label)}</a></p>` : '');
const footer = (text) => `<p style="color:#6e6e73;font-size:14px;margin-top:28px">${esc(text)}</p>`;

export function monthlyEmail(r, { appUrl = '', lang = 'id', backup = false } = {}) {
  const t = L[lang] || L.id;
  const change = (c) => (c.change > 0 ? t.more(rp(c.change)) : c.change < 0 ? t.less(rp(-c.change)) : t.same);
  const parts = [
    `<h1 style="font-size:26px;margin:0 0 4px">${esc(t.monthTitle(monthName(r.month, lang)))}</h1><p style="color:#6e6e73;font-size:16px;margin:0 0 20px">${esc(t.vs(monthName(r.before, lang)))}</p>`,
    `<table style="width:100%;border-collapse:collapse">${row(t.income, `+${rp(r.income)}`, rp(r.beforeIncome))}${row(t.expense, rp(r.expense), rp(r.beforeExpense))}${row(t.net, `<b>${rp(r.net)}</b>`, r.savingRate === null ? t.noRate : t.rate(r.savingRate))}</table>`,
  ];
  if (r.categories.length) parts.push(section(t.cats, r.categories.map((c) => row(c.category, rp(c.amount), change(c))).join('')));
  if (r.budgets.length) parts.push(section(t.budgets, r.budgets.map((b) => row(b.category, `${rp(b.spent)} / ${rp(b.budget)}`, b.over ? t.over(rp(b.spent - b.budget)) : t.left(rp(b.budget - b.spent)))).join('')));
  if ((r.goals || []).length) parts.push(section(t.goals, r.goals.map((g) => row(g.name, `${rp(g.saved)} / ${rp(g.target)}`, g.done ? t.goalDone : t.goalLine(g.percent, rp(g.left)))).join('')));
  if (backup) parts.push(`<p style="background:#f5f5f7;padding:12px 16px;border-radius:12px;font-size:16px;margin:20px 0 0">${esc(t.backupNote)}</p>`);
  parts.push(button(appUrl, t.open), footer(t.monthFooter));
  return { subject: t.monthSubject(monthName(r.month, lang)), html: wrap(parts) };
}

/** balances: [{stream, type, balance}] as the app sees them today */
export function paydayEmail(balances, { appUrl = '', lang = 'id' } = {}) {
  const t = L[lang] || L.id;
  const parts = [
    `<h1 style="font-size:26px;margin:0 0 12px">${esc(t.payTitle)}</h1><p style="font-size:16px;line-height:1.5">${esc(t.payIntro)}</p>`,
    section(t.payTable, balances.map((b) => row(b.stream, rp(b.balance), b.type)).join('')),
    button(appUrl, t.open), footer(t.payFooter),
  ];
  return { subject: t.paySubject, html: wrap(parts) };
}

/** problem: { error?: string, unread?: [{subject, from, reason}] } */
/** The morning before bills are due: what, how much, from which list. */
export function billsEmail(bills, { appUrl = '', lang = 'id' } = {}) {
  const id = lang !== 'en';
  const total = bills.reduce((t, b) => t + b.amount, 0);
  const rows = bills.map((b) => `<tr><td style="padding:10px 0;border-bottom:1px solid #eee;font-size:16px">${esc(b.name)}</td><td style="padding:10px 0;border-bottom:1px solid #eee;font-size:16px;text-align:right">${rp(b.amount)}</td></tr>`).join('');
  return {
    subject: id ? `Cashflow: tagihan besok ${rp(total)}` : `Cashflow: bills due tomorrow ${rp(total)}`,
    html: wrap([`<h1 style="font-size:26px;margin:0 0 12px">${esc(id ? 'Tagihan besok' : 'Bills due tomorrow')}</h1>`, `<table style="width:100%;border-collapse:collapse">${rows}</table>`,
      button(appUrl, id ? 'Buka aplikasi' : 'Open the app'), footer(id ? 'Matikan di Pengaturan → Email otomatis.' : 'Turn it off in Settings → Automatic emails.')]),
  };
}

/** 21:00, nothing typed in today: one line to log cash spending. */
export function closeDayEmail({ appUrl = '', lang = 'id' } = {}) {
  const id = lang !== 'en';
  return {
    subject: id ? 'Cashflow: ada pengeluaran tunai hari ini?' : 'Cashflow: any cash spending today?',
    html: wrap([`<h1 style="font-size:26px;margin:0 0 12px">${esc(id ? 'Ada yang belum dicatat hari ini?' : 'Anything not logged today?')}</h1>`,
      `<p style="font-size:16px">${esc(id ? 'Balas atau kirim email ke diri sendiri, misalnya "catat bakso 20rb cash", atau tutup hari di aplikasi (Cek).' : 'Email yourself, e.g. "catat bakso 20rb cash", or close the day in the app (Review).')}</p>`,
      button(appUrl, id ? 'Tutup hari' : 'Close the day'), footer(id ? 'Dikirim hanya kalau hari ini belum ada yang dicatat manual. Matikan di Pengaturan → Email otomatis.' : 'Sent only when nothing was logged by hand today. Turn it off in Settings → Automatic emails.')]),
  };
}

export function alertEmail(problem, { appUrl = '', lang = 'id' } = {}) {
  const t = L[lang] || L.id;
  if (problem.selftest) {
    const f = problem.selftest;
    const list = (f.failures || []).slice(0, 5).map((x) => `<li style="font-size:15px;margin:4px 0">${esc(x)}</li>`).join('');
    return { subject: t.selftestSubject, html: wrap([`<h1 style="font-size:26px;margin:0 0 12px">⚠ ${esc(t.selftestTitle)}</h1>`, `<p style="font-size:16px">${esc(t.selftestIntro((f.failures || []).length, f.checks || 0))}</p><ul>${list}</ul>`, button(appUrl, t.open), footer(t.alertFooter)]) };
  }
  const parts = [`<h1 style="font-size:26px;margin:0 0 12px">⚠ ${esc(t.alertTitle)}</h1>`];
  if (problem.error) parts.push(`<p style="font-size:16px">${esc(t.alertError)}</p><p style="font-size:15px;background:#fdecec;color:#c9252c;padding:12px 16px;border-radius:12px">${esc(problem.error)}</p>`);
  if (problem.stale && problem.stale.length) {
    parts.push(`<p style="font-size:16px">${esc(t.alertStale(problem.stale.map((s) => t.staleLine(s.who || '?', s.gmail, s.hours)).join('; ')))}</p>`, `<p style="font-size:16px">${esc(t.alertStaleHow)}</p>`);
  }
  if (problem.unread && problem.unread.length) {
    parts.push(`<p style="font-size:16px">${esc(t.alertUnread(problem.unread.length))}</p>`,
      `<table style="width:100%;border-collapse:collapse">${problem.unread.map((u) => row(u.subject || u.from, '', u.reason)).join('')}</table>`);
  }
  parts.push(button(appUrl, t.open), footer(t.alertFooter));
  return { subject: t.alertSubject, html: wrap(parts) };
}

/** The year the spreadsheet should be on, if it is behind (a new year has started). */
export function rolloverTarget(sheetYear, today) {
  const y = Number(sheetYear);
  return y && today.getFullYear() > y ? y + 1 : null;
}

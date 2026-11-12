// The weekly summary email: what went out last week, what waits, budgets running over, and the
// repeating charges due in the coming week. Pure (data in, HTML out); gas/weekly.js sends it.

const DAY = 86400000;
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const num = (v) => Number(v) || 0;

/**
 * @param {{rows, cats: {income, expense}, budgets: {category, monthly_budget}[], recurring: {items}, today: Date, bigAmount?: number}} input
 */
export function weeklySummary({ rows, cats, budgets, recurring, today, bigAmount = 0, claims = [], warranties = [], members = [] }) {
  const from = isoOf(new Date(today.getTime() - 7 * DAY));
  const to = isoOf(new Date(today.getTime() - DAY));
  const exp = new Set(cats.expense);
  const inc = new Set(cats.income);
  const week = rows.filter((r) => r.status === 'approved' && String(r.date).slice(0, 10) >= from && String(r.date).slice(0, 10) <= to);
  const spentRows = week.filter((r) => r.direction === 'out' && exp.has(r.category));
  const byCat = new Map();
  for (const r of spentRows) byCat.set(r.category, (byCat.get(r.category) || 0) + num(r.amount));
  const month = isoOf(today).slice(0, 7);
  const monthSpent = new Map();
  for (const r of rows) {
    if (r.status === 'approved' && r.direction === 'out' && exp.has(r.category) && String(r.date).startsWith(month)) monthSpent.set(r.category, (monthSpent.get(r.category) || 0) + num(r.amount));
  }
  const budgetAlerts = budgets.filter((b) => num(b.monthly_budget) > 0).map((b) => {
    const spent = monthSpent.get(b.category) || 0;
    return { category: b.category, budget: num(b.monthly_budget), spent, ratio: spent / num(b.monthly_budget) };
  }).filter((b) => b.ratio >= 0.8).sort((a, b) => b.ratio - a.ratio);
  return {
    from, to,
    spent: spentRows.reduce((s, r) => s + num(r.amount), 0),
    income: week.filter((r) => r.direction === 'in' && inc.has(r.category)).reduce((s, r) => s + num(r.amount), 0),
    count: spentRows.length,
    topCategories: [...byCat].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount).slice(0, 5),
    // Spending of bigAmount or more gets its own list; "biggest" shows the rest.
    bigAmount,
    big: bigAmount > 0 ? [...spentRows].filter((r) => num(r.amount) >= bigAmount).sort((a, b) => num(b.amount) - num(a.amount))
      .map((r) => ({ description: r.description, amount: num(r.amount), date: String(r.date).slice(0, 10), category: r.category })) : [],
    biggest: [...spentRows].filter((r) => !(bigAmount > 0 && num(r.amount) >= bigAmount)).sort((a, b) => num(b.amount) - num(a.amount)).slice(0, 3)
      .map((r) => ({ description: r.description, amount: num(r.amount), date: String(r.date).slice(0, 10), category: r.category })),
    pending: rows.filter((r) => r.status === 'pending').length,
    budgetAlerts,
    upcoming: (recurring.items || []).filter((i) => i.daysLeft >= 0 && i.daysLeft <= 7),
    // Subscriptions that went up, look stopped, or are new.
    changes: (recurring.items || []).filter((i) => i.change),
    // With two people: what each spent and received last week (the cards above are the household's).
    byPerson: members.length > 1 ? members.map((name) => ({
      name, spent: spentRows.filter((r) => r.owner === name).reduce((s, r) => s + num(r.amount), 0),
      income: week.filter((r) => r.direction === 'in' && inc.has(r.category) && r.owner === name).reduce((s, r) => s + num(r.amount), 0),
    })) : [],
    // Insurance claims whose deadline is within 14 days, and warranties ending within 30.
    claims: claims.filter((c) => c.daysLeft <= 14), warranties,
  };
}

const T = {
  id: {
    subject: (s) => `Ringkasan mingguan Cashflow · ${s.from} s.d. ${s.to}`,
    title: 'Ringkasan minggu lalu', spent: 'Pengeluaran', income: 'Pemasukan', tx: (n) => `${n} transaksi`,
    top: 'Kategori terbesar', biggest: 'Transaksi terbesar', big: (v) => `Pengeluaran besar (${v} ke atas)`, pending: (n) => `${n} transaksi menunggu dicek di aplikasi.`,
    budgets: 'Budget bulan ini', over: (p) => `${p}% terpakai`, upcoming: 'Tagihan rutin 7 hari ke depan', open: 'Buka aplikasi',
    changes: 'Langganan yang berubah', moved: (from) => `Sekarang dari ${from}`, up: (was) => `Naik dari ${was}`,
    perPerson: 'Per orang minggu lalu', claims: 'Klaim asuransi yang segera lewat batas', claimLine: (d, due) => (d < 0 ? `Lewat batas ${due}` : d === 0 ? 'Batas hari ini' : `Batas ${due} (${d} hari lagi)`),
    warranties: 'Garansi yang segera habis', warrantyLine: (d, date) => (d === 0 ? 'Habis hari ini' : `Habis ${date} (${d} hari lagi)`), late: (d) => `Belum ditagih sejak ${d}: sudah berhenti?`, fresh: 'Langganan baru',
    none: 'Tidak ada pengeluaran minggu lalu.', footer: 'Email ini dikirim setiap Senin. Matikan di Pengaturan → Ringkasan mingguan.',
  },
  en: {
    subject: (s) => `Cashflow weekly summary · ${s.from} to ${s.to}`,
    title: 'Last week', spent: 'Spent', income: 'Income', tx: (n) => `${n} transaction(s)`,
    top: 'Biggest categories', biggest: 'Biggest transactions', big: (v) => `Big spending (${v} and up)`, pending: (n) => `${n} transaction(s) waiting for review in the app.`,
    budgets: 'Budgets this month', over: (p) => `${p}% used`, upcoming: 'Repeating charges in the next 7 days', open: 'Open the app',
    changes: 'Subscriptions that changed', moved: (from) => `Now from ${from}`, up: (was) => `Up from ${was}`,
    perPerson: 'Per person last week', claims: 'Insurance claims about to lapse', claimLine: (d, due) => (d < 0 ? `Past the deadline ${due}` : d === 0 ? 'Deadline today' : `Deadline ${due} (${d} days left)`),
    warranties: 'Warranties ending soon', warrantyLine: (d, date) => (d === 0 ? 'Ends today' : `Ends ${date} (${d} days left)`), late: (d) => `Not charged since ${d}: stopped?`, fresh: 'New subscription',
    none: 'No spending last week.', footer: 'Sent every Monday. Turn it off in Settings → Weekly summary.',
  },
};

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rp = (n) => `Rp${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.round(num(n)))}`;

/** Subject and a plain, readable HTML body (16px+ text, one accent colour, meaning in words). */
export function summaryEmail(s, { appUrl = '', lang = 'id' } = {}) {
  const t = T[lang] || T.id;
  const row = (left, right, sub = '') => `<tr><td style="padding:10px 0;border-bottom:1px solid #eee;font-size:16px">${esc(left)}${sub ? `<div style="color:#6e6e73;font-size:14px">${esc(sub)}</div>` : ''}</td><td style="padding:10px 0;border-bottom:1px solid #eee;font-size:16px;text-align:right;white-space:nowrap">${right}</td></tr>`;
  const section = (title, body) => `<h2 style="font-size:19px;margin:28px 0 8px">${esc(title)}</h2><table style="width:100%;border-collapse:collapse">${body}</table>`;
  const parts = [
    `<h1 style="font-size:26px;margin:0 0 4px">${esc(t.title)}</h1><p style="color:#6e6e73;font-size:16px;margin:0 0 20px">${esc(s.from)} – ${esc(s.to)}</p>`,
    `<table style="width:100%;border-collapse:collapse"><tr>
      <td style="padding:16px;background:#f5f5f7;border-radius:12px;font-size:15px">${esc(t.spent)}<div style="font-size:26px;font-weight:700;margin-top:4px">${rp(s.spent)}</div><div style="color:#6e6e73">${esc(t.tx(s.count))}</div></td>
      <td style="width:12px"></td>
      <td style="padding:16px;background:#f5f5f7;border-radius:12px;font-size:15px">${esc(t.income)}<div style="font-size:26px;font-weight:700;margin-top:4px;color:#1a7f37">+${rp(s.income)}</div></td></tr></table>`,
  ];
  if (s.pending) parts.push(`<p style="background:#fff3d6;color:#8a5300;padding:12px 16px;border-radius:12px;font-size:16px;margin:20px 0 0">⚠ ${esc(t.pending(s.pending))}</p>`);
  if ((s.byPerson || []).length) parts.push(section(t.perPerson, s.byPerson.map((p) => row(p.name, rp(p.spent), p.income ? `+${rp(p.income)}` : '')).join('')));
  parts.push(s.topCategories.length ? section(t.top, s.topCategories.map((c) => row(c.category, rp(c.amount))).join('')) : `<p style="font-size:16px">${esc(t.none)}</p>`);
  if ((s.big || []).length) parts.push(section(t.big(rp(s.bigAmount)), s.big.map((b) => row(b.description, `<b>${rp(b.amount)}</b>`, `${b.date} · ${b.category}`)).join('')));
  if (s.biggest.length) parts.push(section(t.biggest, s.biggest.map((b) => row(b.description, rp(b.amount), `${b.date} · ${b.category}`)).join('')));
  if (s.budgetAlerts.length) parts.push(section(t.budgets, s.budgetAlerts.map((b) => row(b.category, `${rp(b.spent)} / ${rp(b.budget)}`, t.over(Math.round(b.ratio * 100)))).join('')));
  if ((s.changes || []).length) parts.push(section(t.changes, s.changes.map((c) => row(c.name, rp(c.amount), c.change === 'up' ? t.up(rp(c.was)) : c.change === 'moved' ? t.moved(c.from) : c.change === 'late' ? t.late(c.nextDate) : t.fresh)).join('')));
  if ((s.claims || []).length) parts.push(section(t.claims, s.claims.map((c) => row(c.description, rp(c.amount), t.claimLine(c.daysLeft, c.due))).join('')));
  if ((s.warranties || []).length) parts.push(section(t.warranties, s.warranties.map((w) => row(w.name, '', t.warrantyLine(w.daysLeft, w.date))).join('')));
  if (s.upcoming.length) parts.push(section(t.upcoming, s.upcoming.map((u) => row(u.name, rp(u.amount), `${u.nextDate} · ${u.category}`)).join('')));
  if (appUrl) parts.push(`<p style="margin:28px 0"><a href="${esc(appUrl)}" style="background:#0066cc;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-size:16px;display:inline-block">${esc(t.open)}</a></p>`);
  parts.push(`<p style="color:#6e6e73;font-size:14px;margin-top:28px">${esc(t.footer)}</p>`);
  const html = `<div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1d1d1f;max-width:560px;margin:0 auto;padding:16px">${parts.join('\n')}</div>`;
  return { subject: t.subject(s), html };
}

// Typing instead of filling a form: amounts with a little arithmetic ("12000+3500", "3x25rb") and
// one-sentence entries ("kopi 28rb gopay", "gaji 8,5jt di BCA", "parkir 5k kemarin #trip").

const MULT = { rb: 1e3, ribu: 1e3, k: 1e3, jt: 1e6, juta: 1e6, m: 1e6, million: 1e6 };

/** One number, Indonesian or English style, with an optional rb/k/jt/juta suffix. NaN if none. */
export function amountOf(raw) {
  const m = String(raw ?? '').trim().toLowerCase().replace(/^rp\.?\s*/, '').match(/^(\d[\d.,]*)\s*(rb|ribu|k|jt|juta|m|million)?$/);
  if (!m) return NaN;
  let n = m[1];
  if (m[2]) {
    // "8,5jt" / "8.5jt" are decimals; "1.250rb" groups thousands
    n = /^\d{1,3}([.,]\d{3})+$/.test(n) ? n.replace(/[.,]/g, '') : n.replace(',', '.');
    return Number(n) * MULT[m[2]];
  }
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(n)) n = n.replace(/\./g, '').replace(',', '.'); // 25.000 / 1.500.000,50
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(n)) n = n.replace(/,/g, ''); // 1,500,000.50
  else n = n.replace(',', '.');
  const v = Number(n);
  return Number.isFinite(v) ? v : NaN;
}

/** "12000+3500", "3x25rb", "100rb/4", "50.000 - 12.500" -> number (NaN when it isn't a sum). */
export function evalAmount(raw) {
  const s = String(raw ?? '').trim().toLowerCase().replace(/[×x*]/g, '*').replace(/[÷:]/g, '/').replace(/[−–]/g, '-');
  if (!s) return NaN;
  const parts = s.split(/\s*([+\-*/])\s*/).filter((p) => p !== '');
  const nums = [];
  const ops = [];
  for (let i = 0; i < parts.length; i += 1) {
    if (i % 2 === 0) { const v = amountOf(parts[i]); if (!Number.isFinite(v)) return NaN; nums.push(v); } else ops.push(parts[i]);
  }
  if (nums.length !== ops.length + 1) return NaN;
  // * and / first, then + and -
  const n = [nums[0]];
  const o = [];
  ops.forEach((op, i) => {
    if (op === '*') n[n.length - 1] *= nums[i + 1];
    else if (op === '/') n[n.length - 1] = nums[i + 1] ? n[n.length - 1] / nums[i + 1] : NaN;
    else { o.push(op); n.push(nums[i + 1]); }
  });
  const v = o.reduce((t, op, i) => (op === '+' ? t + n[i + 1] : t - n[i + 1]), n[0]);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN;
}

const IN_WORDS = /\b(gaji|salary|terima|diterima|dapat|masuk|refund|cashback|dividen|bonus|dibayar|thr|income|pemasukan|jual|transfer dari)\b/i;
const FILLER = /\b(pakai|pake|pk|via|dengan|dgn|with|using|di|on|dari|ke|bayar|beli|buat|untuk|utk|for|at|in|rp|kemarin|yesterday|hari ini|today|tadi)\b/gi;
const CASH = /\b(cash|tunai|kas)\b/i;

/**
 * One sentence -> what the Add form needs. Fields it can't tell stay empty (the form asks).
 * @param {{accounts: {stream, institution?}[], rules?: {pattern, category}[], today: string, salaryCategory?: string}} ctx
 * @returns {{amount, direction, stream, description, category, date, tags}}
 */
export function parseQuick(text, { accounts = [], rules = [], today, salaryCategory = '' }) {
  let rest = ` ${String(text || '')} `;
  const tags = [...rest.matchAll(/#([\p{L}\p{N}_-]+)/gu)].map((m) => m[1]);
  rest = rest.replace(/#[\p{L}\p{N}_-]+/gu, ' ');
  // The amount: the first number (with rb/k/jt), or a small sum like 25rb+5rb.
  const am = rest.match(/(?:rp\.?\s*)?\d[\d.,]*\s*(?:rb|ribu|k|jt|juta|m|million)?(?:\s*[+\-x×*/]\s*\d[\d.,]*\s*(?:rb|ribu|k|jt|juta|m|million)?)*(?![\p{L}])/iu);
  const amount = am ? evalAmount(am[0].replace(/^rp\.?\s*/i, '')) : NaN;
  if (am) rest = rest.replace(am[0], ' ');
  let date = today;
  if (/\b(kemarin|yesterday)\b/i.test(rest) && today) {
    const d = new Date(`${today}T00:00:00`);
    d.setDate(d.getDate() - 1);
    date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  // The account: its name (or bank) as a word in the sentence, longest name first; "cash/tunai" means Cash.
  let stream = '';
  const names = accounts.flatMap((a) => [a.stream, a.institution].filter(Boolean).map((n) => ({ n: String(n), stream: a.stream })))
    .sort((a, b) => b.n.length - a.n.length);
  for (const { n, stream: st } of names) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'iu');
    if (re.test(rest)) { stream = st; rest = rest.replace(re, ' '); break; }
  }
  if (!stream && CASH.test(rest)) {
    const cash = accounts.find((a) => CASH.test(a.stream));
    if (cash) { stream = cash.stream; rest = rest.replace(CASH, ' '); }
  }
  const direction = IN_WORDS.test(rest) ? 'in' : 'out';
  const description = rest.replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
  let category = '';
  for (const r of rules) {
    try { if (r.pattern && new RegExp(r.pattern, 'i').test(description)) { category = r.category; break; } } catch (e) { /* a broken rule is skipped */ }
  }
  if (!category && direction === 'in' && /\b(gaji|salary)\b/i.test(description)) category = salaryCategory;
  return { amount, direction, stream, description, category, date, tags };
}

/**
 * The sentences in an email you sent yourself to log spending: every line starting with "catat"
 * (or "log"), or every line of the body when the subject is just "catat". Quoted replies and
 * signatures are left out.
 */
export function notesFromEmail(subject, text) {
  const NOTE = /^\s*(catat|log)\b[:\s-]*/i;
  const lines = [String(subject || ''), ...String(text || '').split(/\r?\n/)].map((l) => l.trim());
  const sub = String(subject || '').trim();
  const bodyIsNotes = NOTE.test(sub) && !sub.replace(NOTE, '').trim();
  const out = [];
  for (const [i, l] of lines.entries()) {
    if (!l || /^>/.test(l) || /^(--|__|sent from|dikirim dari|on .* wrote:|pada .* menulis:)/i.test(l)) {
      if (/^(--|__)/.test(l)) break;
      continue;
    }
    if (NOTE.test(l)) { const t = l.replace(NOTE, '').trim(); if (t) out.push(t); } else if (bodyIsNotes && i > 0) out.push(l);
  }
  return out.slice(0, 20);
}

/**
 * The most common things typed by hand (Add or notes) lately, with their usual amount, account and
 * category: one tap on Add instead of filling the form.
 */
export function usualEntries(rows, { today, days = 90, limit = 6 }) {
  const since = new Date(today.getTime() - days * 86400000).toISOString().slice(0, 10);
  const by = new Map();
  for (const r of rows) {
    if (r.status !== 'approved' || !['manual', 'note'].includes(r.source) || !r.description || String(r.date).slice(0, 10) < since) continue;
    if (!['in', 'out'].includes(r.direction) || /^Cek saldo /.test(r.description)) continue;
    const k = String(r.description).trim().toLowerCase();
    const x = by.get(k) || { description: String(r.description).trim(), count: 0, amounts: new Map(), last: r };
    x.count += 1;
    x.amounts.set(Number(r.amount), (x.amounts.get(Number(r.amount)) || 0) + 1);
    if (String(r.date) >= String(x.last.date)) x.last = r;
    by.set(k, x);
  }
  return [...by.values()].filter((x) => x.count >= 2).sort((a, b) => b.count - a.count).slice(0, limit).map((x) => ({
    description: x.description, count: x.count, amount: [...x.amounts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0],
    stream: x.last.stream || '', category: x.last.category || '', direction: x.last.direction,
  }));
}

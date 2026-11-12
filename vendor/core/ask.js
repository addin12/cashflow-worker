// "Tanya apa saja" / "Ask anything": questions about your own money, answered from your own numbers.
//
//   parseQuestion(text, ctx)   rules (Indonesian and English) that turn a sentence into { intent, period, category, merchant, person, ... } or null
//   sanitizeParsed(obj, ctx)   the same shape from somewhere else (the AI): every field is checked against what exists, nothing is trusted
//   answerQuestion(parsed, d)  the numbers, as data (no text: the screen words them in the person's language)
//
// An answer is always computed here from the rows; the AI (src/ask-ai.js in the Worker) only ever helps to read the sentence, never to produce a number.

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => new Date(d.getTime() + n * DAY);
const num = (v) => Number(v) || 0;
const round2 = (n) => Math.round(n * 100) / 100;
const day10 = (r) => String(r.date).slice(0, 10);

export const INTENTS = ['spend', 'income', 'compare', 'last', 'bills', 'who', 'budget', 'where', 'week', 'subs'];
export const PERIODS = ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'last_30', 'this_year'];
const DEFAULT_PERIOD = { spend: 'this_month', income: 'this_month', compare: 'this_month', who: 'this_month', where: 'this_month', week: 'this_week' };

/** The four buttons on the card: exact sentences, in both languages. */
export const CHIPS = {
  week: { id: 'Tinjau minggu ini', en: 'Review my week' },
  where: { id: 'Ke mana uangnya?', en: 'Where did it go?' },
  subs: { id: 'Cek langganan', en: 'Check subscriptions' },
  bills: { id: 'Tagihan minggu ini', en: 'Bills this week' },
};

// ---------- reading the sentence

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9&#\s]/g, ' ').replace(/\s+/g, ' ').trim();

const UNSUPPORTED_PERIOD = /\b(?!30\b)(\d+|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|two|three|four|five|six)\s+(hari|minggu|pekan|bulan|tahun|days?|weeks?|months?|years?)\s+(yang\s+)?(lalu|terakhir|ago)\b/;
const PERIOD_WORDS = [
  ['last_week', /\b(minggu|pekan) (lalu|kemarin)\b|\blast week\b/],
  ['this_week', /\b(minggu|pekan) ini\b|\bthis week\b/],
  ['last_month', /\bbulan (lalu|kemarin)\b|\blast month\b/],
  ['this_month', /\bbulan ini\b|\bthis month\b/],
  ['last_30', /\b30 hari\b|\bsebulan terakhir\b|\blast 30\b/],
  ['this_year', /\btahun ini\b|\bthis year\b/],
  ['yesterday', /\bkemarin\b|\byesterday\b/],
  ['today', /\bhari ini\b|\btoday\b/],
];

/** Periods named in the text, in the order they appear. */
function periodsIn(t) {
  const hits = [];
  let rest = t;
  for (const [key, re] of PERIOD_WORDS) {
    const m = re.exec(rest);
    if (m) { hits.push({ key, at: m.index + (t.length - rest.length) }); rest = rest.replace(re, ' '.repeat(m[0].length)); }
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.key);
}

const STOP = new Set(('berapa total pengeluaran pemasukan pendapatan uang aku saya gue dia kita berdua pasangan partner untuk buat di ke yang dari dengan dan atau bulan minggu pekan ini lalu hari kemarin tahun '
  + 'kapan terakhir bayar beli sisa budget tagihan siapa paling banyak lebih boros habis keluar masuk spent spend much how many did does for the and with last this when who more than left '
  + 'pay paid buy bought purchase purchased ago remaining on my me our us in of to is are was bandingkan banding dibanding bandingkan compare vs versus apa saja ada mana kemana tinjau review rangkuman langganan cek lihat tampilkan show what '
  + 'seberapa jatuh tempo depan sekarang tolong tentang soal punya punyaku miliki nya per sama sudah belum masih').split(' '));

// question words -> words that appear in category names
const SYNONYMS = {
  makan: ['food', 'makan'], makanan: ['food', 'makan'], jajan: ['food', 'makan'], resto: ['food', 'makan'], restoran: ['food', 'makan'], minum: ['beverages', 'minum'], minuman: ['beverages', 'minum'],
  kopi: ['beverages', 'food'], belanja: ['belanja', 'shopping'], groceries: ['belanja'], bensin: ['transportasi', 'bensin', 'transport'], transport: ['transportasi', 'transport'],
  ojek: ['transportasi', 'transport'], listrik: ['tagihan', 'utilitas'], tagihan: ['tagihan', 'bill'], hobi: ['hobi', 'hobby'], hiburan: ['hiburan', 'nongkrong'], kesehatan: ['kesehatan', 'health'],
};

const words = (name) => norm(name).split(' ').filter((w) => w.length >= 3 && w !== 'dan' && w !== 'and');

/** The category the text means (exact name first, then shared words), or '' ; and the tokens it used. */
function findCategory(tokens, names) {
  const text = ` ${tokens.join(' ')} `;
  const exact = names.find((n) => norm(n).length >= 3 && text.includes(` ${norm(n)} `));
  if (exact) return { name: exact, used: new Set(norm(exact).split(' ')) };
  const open = tokens.filter((w) => !STOP.has(w)); // "pengeluaran" in the question is not the category "Pengeluaran Lainnya"
  let best = null;
  for (const name of names) {
    const ws = words(name);
    const used = new Set();
    for (const tk of open) {
      const mapped = SYNONYMS[tk] || [tk];
      if (tk.length >= 4 || SYNONYMS[tk]) if (ws.some((w) => mapped.includes(w) || (tk.length >= 5 && (w.startsWith(tk) || tk.startsWith(w) && w.length >= 5)))) used.add(tk);
    }
    if (used.size && (!best || used.size > best.used.size)) best = { name, used };
  }
  return best || { name: '', used: new Set() };
}

function findPerson(t, ctx) {
  const members = (ctx.members || []).filter(Boolean);
  for (const m of members) if (new RegExp(`\\b${norm(m).replace(/[^a-z0-9 ]/g, '')}\\b`).test(t)) return m;
  if (/\b(aku|saya|gue|punyaku|my|me|mine)\b/.test(t)) return ctx.me || '';
  if (/\b(dia|pasangan|partner|istri|suami|she|he|her|his)\b/.test(t)) return members.find((m) => m !== ctx.me) || '';
  return '';
}

/** @returns {null|{intent: string, period?: string, comparePeriod?: string, category?: string, merchant?: string, person?: string}} */
export function parseQuestion(text, ctx = {}) {
  const raw = String(text || '').slice(0, 200);
  // "pengeluaranku" = "pengeluaran aku" (only for words where -ku means "my": "buku" is a book)
  const t = norm(raw).replace(/\b(pengeluaran|pemasukan|belanja|jajan|tagihan|uang|gaji|langganan|budget|transaksi)ku\b/g, '$1 aku');
  if (!t) return null;
  const cats = ctx.categories || { expense: [], income: [] };
  for (const [intent, c] of Object.entries(CHIPS)) if (t === norm(c.id) || t === norm(c.en)) return finish({ intent }, t, ctx);

  if (UNSUPPORTED_PERIOD.test(t)) return null;
  const found = periodsIn(t);
  let intent = '';
  if (/\b(tagihan|jatuh tempo|bills? due|upcoming bills?|bills?)\b/.test(t)) intent = 'bills';
  else if (/\b(langganan|subscriptions?|subs)\b/.test(t) && !/\bkapan\b|\bwhen\b/.test(t)) intent = 'subs';
  else if (/\bkapan terakhir\b|\bterakhir (kali )?(bayar|beli|ke|di)\b|\blast time\b|\bwhen did i (last|pay)\b/.test(t)) intent = 'last';
  else if (/\b(bandingkan|banding|dibanding|compare|versus|vs)\b/.test(t)) intent = 'compare';
  else if (/\bsiapa\b.*\b(banyak|boros|paling|lebih)\b|\bwho\b.*\b(more|most|spends?)\b/.test(t)) intent = 'who';
  else if (/\b(lebih|paling) (boros|banyak)\b/.test(t) && /\b(atau|or)\b/.test(t)) intent = 'who'; // "Dewi atau aku yang lebih boros"
  else if (/\b(sisa budget|budget (tinggal|sisa)|budget left|remaining budget|how much budget)\b|\bbudget\b.*\b(sisa|tinggal|left)\b/.test(t)) intent = 'budget';
  else if (/\b(ke ?mana|where did|where is)\b/.test(t)) intent = 'where';
  else if (/\b(tinjau|review|rangkuman|recap|summary)\b/.test(t)) intent = 'week';
  else if (/\b(pemasukan|pendapatan|gaji masuk|income|earned|received)\b/.test(t)) intent = 'income';
  else if (/\b(berapa|total|pengeluaran|habis|keluar|spent|spend|jajan|belanja|how much|expenses?)\b/.test(t)) intent = 'spend';
  if (!intent) return null;
  return finish({ intent, period: found[0], comparePeriod: found[1] }, t, ctx, cats);
}

function finish(p, t, ctx, cats = ctx.categories || { expense: [], income: [] }) {
  const tokens = t.split(' ');
  const pool = p.intent === 'income' ? cats.income : cats.expense;
  const cat = ['bills', 'subs', 'week', 'where'].includes(p.intent) ? { name: '', used: new Set() } : findCategory(tokens, pool || []);
  const person = findPerson(t, ctx);
  const memberWords = new Set((ctx.members || []).flatMap((m) => norm(m).split(' ')));
  const leftover = tokens.filter((w) => w.length >= 3 && !STOP.has(w) && !cat.used.has(w) && !memberWords.has(w) && !/^\d+$/.test(w));
  const out = { intent: p.intent };
  const period = p.period || DEFAULT_PERIOD[p.intent];
  if (period) out.period = period;
  if (p.intent === 'compare') {
    out.comparePeriod = p.comparePeriod || (out.period === 'this_week' ? 'last_week' : out.period === 'today' ? 'yesterday' : out.period === 'this_month' ? 'last_month' : '');
    if (!out.comparePeriod || out.comparePeriod === out.period) {
      delete out.comparePeriod;
      out.intent = person && /\b(aku|saya|dia|kita|boros|siapa|who|me)\b/.test(t) ? 'who' : 'spend';
      if (out.intent === 'who') return { intent: 'who', period: out.period, ...(out.category ? { category: out.category } : {}) };
    }
  }
  if (cat.name) out.category = cat.name;
  else if (leftover.length && ['spend', 'income', 'compare', 'last', 'who', 'budget'].includes(p.intent)) out.merchant = leftover.join(' ').slice(0, 40);
  if (person && ['spend', 'income', 'compare', 'last', 'week', 'where'].includes(out.intent)) out.person = person;
  if (out.intent === 'bills' && /\b(depan|next|selanjutnya)\b/.test(t)) out.next = true;
  if (out.intent === 'last' && !out.merchant && !out.category) return null; // "when did I last…" needs a what
  return out;
}

const MONEY = /\b(berapa|duit|uang|rupiah|rp|bayar|dibayar|membayar|beli|membeli|belanja|biaya|harga|boros|hemat|jajan|gaji|tagih\w*|langganan|budget|anggaran|pengeluaran|pemasukan|keluar|masuk|habis|spent|spend|paid|pay|cost|price|expens\w*|income|earn\w*|buy|bought|bills?|subscri\w*|salary|tabung\w*|cicil\w*|utang|hutang|transfer|kopi|makan|minum|ojek|bensin|listrik|pulsa|transaksi|transactions?)\b/;
const TIME = /\b(hari|minggu|pekan|bulan|tahun|kemarin|lalu|ini|terakhir|today|yesterday|week|month|year|day|last|this)\b/;
// what a question must contain before an intent can be believed (an intent with no such word becomes the plain "how much was spent")
const EVIDENCE = {
  budget: /\b(budget|anggaran|jatah)\b/, bills: /\b(tagihan|bills?|jatuh tempo|cicilan|due)\b/, subs: /\b(langganan|subscriptions?|subs)\b/, last: /\b(terakhir|last|kapan|when)\b/,
  who: /\b(siapa|who|boros|lebih banyak|paling)\b/, compare: /\b(bandingkan|banding|dibanding|compare|vs|versus|selisih)\b/, where: /\b(ke ?mana|where)\b/,
  week: /\b(tinjau|review|rangkuman|recap|summary)\b/, income: /\b(pemasukan|pendapatan|gaji|income|earn\w*|received|masuk)\b/,
};

/** Is this about money at all? (Questions that are not never go to the AI.) Words of the household's own categories count. */
export function looksFinancial(text, ctx = {}) {
  const t = norm(text);
  if (!t) return false;
  if (MONEY.test(t)) return true;
  const cats = ctx.categories || { expense: [], income: [] };
  return [...(cats.expense || []), ...(cats.income || [])].some((c) => words(c).some((w) => w.length >= 4 && t.includes(w)));
}

/**
 * The same shape from the AI. The AI only proposes; with the question's own `text`, each field must also be backed by words in the question:
 * a category the rules find there, a person who is named or meant, a shop that appears in it, a period word, an intent word. Without `text` only the shape is checked.
 */
export function sanitizeParsed(obj, ctx = {}, text = '') {
  if (!obj || typeof obj !== 'object') return null;
  let intent = String(obj.intent || '').toLowerCase();
  if (!INTENTS.includes(intent)) return null;
  const t = norm(text);
  const check = Boolean(t);
  if (check && EVIDENCE[intent] && !EVIDENCE[intent].test(t)) intent = 'spend';
  const out = { intent };
  const period = String(obj.period || '').toLowerCase();
  const timeWords = !check || TIME.test(t);
  const fallback = DEFAULT_PERIOD[intent];
  if (PERIODS.includes(period) && timeWords) out.period = period; else if (fallback) out.period = fallback;
  if (intent === 'compare') {
    const cmp = String(obj.comparePeriod || '').toLowerCase();
    if (!PERIODS.includes(cmp) || cmp === out.period) { if (check) { out.intent = 'spend'; delete out.comparePeriod; } else out.comparePeriod = { this_week: 'last_week', today: 'yesterday', this_month: 'last_month' }[out.period] || 'last_month'; } else out.comparePeriod = cmp;
  }
  const cats = ctx.categories || { expense: [], income: [] };
  const pool = out.intent === 'income' ? cats.income || [] : cats.expense || [];
  const wanted = String(obj.category || '').trim();
  const cat = wanted && pool.find((c) => norm(c) === norm(wanted));
  const found = check && cat ? findCategory(t.split(' '), pool).name : cat;
  if (cat && found === cat) out.category = cat;
  const clean = (v) => String(v || '').replace(/[^\p{L}\p{N}&#\s.'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  const merchant = clean(obj.merchant) || (wanted && !cat ? clean(wanted) : '');
  if (merchant && !out.category && (!check || t.includes(norm(merchant)))) out.merchant = merchant;
  const members = (ctx.members || []).filter(Boolean);
  const person = String(obj.person || '').trim();
  const who = members.find((m) => norm(m) === norm(person)) || (/^(me|aku|saya|i)$/i.test(person) ? ctx.me : /^(partner|dia|pasangan|other)$/i.test(person) ? members.find((m) => m !== ctx.me) : '');
  if (who && (!check || findPerson(t, ctx) === who)) out.person = who;
  if (out.intent === 'bills' && obj.next && (!check || /\b(depan|next|selanjutnya)\b/.test(t))) out.next = true;
  if (out.intent === 'last' && !out.merchant && !out.category) return null;
  return out;
}

// ---------- the numbers

/** { from, to } (inclusive ISO dates) of a period. `month(which)` gives the app's own month ('this' or 'last'; by payday when that is the setting). */
export function rangeOfPeriod(period, today, month = () => null) {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const monday = addDays(t, -((t.getDay() + 6) % 7));
  switch (period) {
    case 'today': return { from: iso(t), to: iso(t) };
    case 'yesterday': return { from: iso(addDays(t, -1)), to: iso(addDays(t, -1)) };
    case 'this_week': return { from: iso(monday), to: iso(t) };
    case 'last_week': return { from: iso(addDays(monday, -7)), to: iso(addDays(monday, -1)) };
    case 'last_30': return { from: iso(addDays(t, -29)), to: iso(t) };
    case 'this_year': return { from: `${t.getFullYear()}-01-01`, to: iso(t) };
    case 'last_month': { const r = month('last'); if (r) return r; const s = new Date(t.getFullYear(), t.getMonth() - 1, 1); return { from: iso(s), to: iso(new Date(t.getFullYear(), t.getMonth(), 0)) }; }
    default: { const r = month('this'); if (r) return r; return { from: iso(new Date(t.getFullYear(), t.getMonth(), 1)), to: iso(t) }; }
  }
}

const matchText = (r, needle) => !needle || `${r.description} ${r.details} ${r.category} ${r.stream}`.toLowerCase().includes(needle.toLowerCase());
const inRange = (r, { from, to }) => day10(r) >= from && day10(r) <= to;

/** @param {{rows, cats: {expense: string[], income: string[]}, today: Date, month?: Function, budgets?: {category, monthly_budget}[], recurring?: {items, monthlyTotal}, bills?: {name, amount, date, daysLeft}[], members?: string[], me?: string}} d */
export function answerQuestion(p, d) {
  const exp = new Set(d.cats.expense);
  const inc = new Set(d.cats.income);
  const ok = d.rows.filter((r) => r.status === 'approved');
  const spendRows = ok.filter((r) => r.direction === 'out' && exp.has(r.category));
  const incomeRows = ok.filter((r) => r.direction === 'in' && inc.has(r.category));
  const range = (period) => ({ period, ...rangeOfPeriod(period, d.today, d.month) });
  const pick = (rows, rg) => rows.filter((r) => inRange(r, rg) && (!p.category || r.category === p.category) && (!p.person || r.owner === p.person) && matchText(r, p.merchant));
  const sum = (rows) => round2(rows.reduce((s, r) => s + num(r.amount), 0));
  const label = { category: p.category || '', merchant: p.merchant || '', person: p.person || '' };
  const drill = (rg, extra = {}) => ({ from: rg.from, to: rg.to, category: p.category || '', q: p.merchant || '', owner: p.person || '', ...extra });
  const top = (rows, key, n = 5) => {
    const m = new Map();
    for (const r of rows) m.set(r[key] || '-', (m.get(r[key] || '-') || 0) + num(r.amount));
    return [...m].map(([name, amount]) => ({ name, amount: round2(amount) })).sort((a, b) => b.amount - a.amount).slice(0, n);
  };
  const biggest = (rows) => { const r = [...rows].sort((a, b) => num(b.amount) - num(a.amount))[0]; return r ? { description: r.description, amount: num(r.amount), date: day10(r), category: r.category } : null; };

  switch (p.intent) {
    case 'spend': case 'income': {
      const rg = range(p.period);
      const rows = pick(p.intent === 'spend' ? spendRows : incomeRows, rg);
      const days = Math.max(1, Math.round((new Date(`${rg.to}T00:00:00`) - new Date(`${rg.from}T00:00:00`)) / DAY) + 1);
      return { kind: p.intent, ...rg, label, total: sum(rows), count: rows.length, perDay: round2(sum(rows) / days), top: p.category ? top(rows, 'description', 3) : top(rows, 'category', 3), biggest: biggest(rows), drill: drill(rg, { direction: p.intent === 'spend' ? 'out' : 'in' }) };
    }
    case 'compare': {
      const a = range(p.period);
      const b = range(p.comparePeriod || 'last_month');
      const ra = pick(spendRows, a);
      const rb = pick(spendRows, b);
      const ta = sum(ra);
      const tb = sum(rb);
      return { kind: 'compare', label, a: { ...a, total: ta, count: ra.length }, b: { ...b, total: tb, count: rb.length }, diff: round2(ta - tb), pct: tb > 0 ? Math.round(((ta - tb) / tb) * 100) : null, drill: drill(a, { direction: 'out' }) };
    }
    case 'last': {
      const rows = [...spendRows, ...incomeRows].filter((r) => (!p.category || r.category === p.category) && (!p.person || r.owner === p.person) && matchText(r, p.merchant)).sort((x, y) => `${day10(y)}${y.time || ''}`.localeCompare(`${day10(x)}${x.time || ''}`));
      const r = rows[0];
      if (!r) return { kind: 'last', found: false, label, drill: drill({ from: '', to: '' }) };
      const daysAgo = Math.round((new Date(d.today.getFullYear(), d.today.getMonth(), d.today.getDate()) - new Date(`${day10(r)}T00:00:00`)) / DAY);
      return { kind: 'last', found: true, label, description: r.description, amount: num(r.amount), date: day10(r), daysAgo, category: r.category, direction: r.direction, owner: r.owner, count: rows.length, drill: drill({ from: '', to: '' }) };
    }
    case 'bills': {
      const days = p.next ? 14 : 7;
      const items = (d.bills || []).filter((b) => b.daysLeft >= (p.next ? 8 : 0) && b.daysLeft <= days).map((b) => ({ name: b.name, amount: num(b.amount), date: b.date, daysLeft: b.daysLeft }));
      return { kind: 'bills', next: Boolean(p.next), items, total: round2(items.reduce((s, b) => s + b.amount, 0)) };
    }
    case 'subs': {
      const r = d.recurring || { items: [], monthlyTotal: 0 };
      const items = (r.items || []).map((i) => ({ name: i.name, amount: num(i.amount), nextDate: i.nextDate, daysLeft: i.daysLeft })).slice(0, 12);
      return { kind: 'subs', items, count: (r.items || []).length, monthlyTotal: round2(num(r.monthlyTotal)) };
    }
    case 'who': {
      const rg = range(p.period);
      const people = (d.members || []).map((name) => { const rows = spendRows.filter((r) => r.owner === name && inRange(r, rg) && (!p.category || r.category === p.category) && matchText(r, p.merchant)); return { name, total: sum(rows), count: rows.length }; }).sort((a, b) => b.total - a.total);
      return { kind: 'who', ...rg, label, people, drill: drill(rg, { direction: 'out', owner: people[0] && people[0].total > 0 ? people[0].name : '' }) };
    }
    case 'budget': {
      const rg = range('this_month');
      const budgets = (d.budgets || []).filter((b) => num(b.monthly_budget) > 0);
      const spentOf = (cat) => sum(spendRows.filter((r) => r.category === cat && inRange(r, rg)));
      const row = (b) => { const spent = spentOf(b.category); return { category: b.category, budget: num(b.monthly_budget), spent, left: round2(num(b.monthly_budget) - spent), ratio: round2(spent / num(b.monthly_budget)) }; };
      if (p.category) {
        const b = budgets.find((x) => x.category === p.category);
        return { kind: 'budget', category: p.category, set: Boolean(b), ...rg, items: b ? [row(b)] : [], drill: drill(rg, { direction: 'out' }) };
      }
      return { kind: 'budget', category: '', set: budgets.length > 0, ...rg, items: budgets.map(row).sort((a, b) => b.ratio - a.ratio).slice(0, 5), drill: drill(rg, { direction: 'out' }) };
    }
    case 'where': {
      const rg = range(p.period);
      const rows = pick(spendRows, rg);
      const total = sum(rows);
      return { kind: 'where', ...rg, label, total, count: rows.length, top: top(rows, 'category', 5).map((x) => ({ ...x, pct: total > 0 ? Math.round((x.amount / total) * 100) : 0 })), drill: drill(rg, { direction: 'out' }) };
    }
    case 'week': {
      const a = range('this_week');
      const b = range('last_week');
      const ra = pick(spendRows, a);
      const rb = pick(spendRows, b);
      return {
        kind: 'week', label, ...a, total: sum(ra), count: ra.length, previous: { ...b, total: sum(rb), count: rb.length }, diff: round2(sum(ra) - sum(rb)),
        income: sum(pick(incomeRows, a)), top: top(ra, 'category', 3), biggest: biggest(ra), pending: d.rows.filter((r) => r.status === 'pending').length, drill: drill(a, { direction: 'out' }),
      };
    }
    default: return { kind: 'unknown' };
  }
}

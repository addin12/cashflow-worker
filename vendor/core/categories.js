import { SLOTS, FIXED_CATEGORIES, EMPTY_SLOT } from './schema.js';

// Names end up as SUMIFS criteria, so characters with a meaning there are not allowed:
// wildcards (* ? ~) anywhere, and comparison operators (= < >) at the start.
const FORBIDDEN = /[*?~]/;
const OPERATOR_START = /^[=<>]/;

/** Returns a list of problems with one name (empty = valid). */
export function nameProblems(name) {
  const problems = [];
  if (typeof name !== 'string' || name.trim() === '') return ['empty name'];
  if (name !== name.trim()) problems.push('leading/trailing spaces');
  if (name === EMPTY_SLOT) problems.push(`"${EMPTY_SLOT}" is reserved for unused slots`);
  if (FORBIDDEN.test(name)) problems.push('contains * ? or ~');
  if (OPERATOR_START.test(name)) problems.push('starts with = < or >');
  if (name.length > 40) problems.push('longer than 40 characters');
  return problems;
}

/**
 * Validates the category lists and returns them padded to the template's slot counts.
 * @param {{income: string[], expense: string[]}} cats
 */
export function buildCategorySlots(cats, fixed = [FIXED_CATEGORIES.adjustment, FIXED_CATEGORIES.transfer]) {
  const errors = [];
  const { income = [], expense = [] } = cats || {};
  if (income.length > SLOTS.income) errors.push(`at most ${SLOTS.income} income categories (got ${income.length})`);
  if (expense.length > SLOTS.expense) errors.push(`at most ${SLOTS.expense} expense categories (got ${expense.length})`);
  const all = [...income, ...expense, ...fixed];
  const seen = new Set();
  for (const name of [...income, ...expense]) {
    for (const p of nameProblems(name)) errors.push(`"${name}": ${p}`);
  }
  for (const name of all) {
    const k = String(name).trim().toLowerCase();
    if (seen.has(k)) errors.push(`"${name}" is used more than once (names must be unique across income and expense)`);
    seen.add(k);
  }
  if (errors.length) throw new Error(`Invalid categories:\n- ${errors.join('\n- ')}`);
  const pad = (list, n) => [...list, ...Array(n - list.length).fill(EMPTY_SLOT)];
  return { income: pad(income, SLOTS.income), expense: pad(expense, SLOTS.expense) };
}

/** Stream (account) names follow the same rules, and must be unique. */
export function validateAccounts(accounts) {
  const errors = [];
  const seen = new Set();
  const counts = { Spending: 0, Saving: 0 };
  for (const a of accounts || []) {
    for (const p of nameProblems(a.stream)) errors.push(`account "${a.stream}": ${p}`);
    const k = String(a.stream).trim().toLowerCase();
    if (seen.has(k)) errors.push(`account "${a.stream}" is listed twice`);
    seen.add(k);
    if (!(a.type in counts)) errors.push(`account "${a.stream}": type must be Spending or Saving`);
    else counts[a.type] += 1;
    if (a.opening_balance != null && !Number.isFinite(Number(a.opening_balance))) errors.push(`account "${a.stream}": opening_balance is not a number`);
  }
  if (counts.Spending > SLOTS.spending) errors.push(`at most ${SLOTS.spending} Spending accounts in v1 (got ${counts.Spending})`);
  if (counts.Saving > SLOTS.saving) errors.push(`at most ${SLOTS.saving} Saving accounts in v1 (got ${counts.Saving})`);
  if (errors.length) throw new Error(`Invalid accounts:\n- ${errors.join('\n- ')}`);
  return counts;
}

/**
 * Category slots after the seed's category_changes: a rename keeps its slot (so it is seen as a
 * rename, not a new category), an addition takes the first free slot of its kind. A name that
 * already exists is left alone, so running the same changes twice changes nothing.
 */
export function slotsAfterChanges(slots, changes) {
  const next = { income: [...slots.income], expense: [...slots.expense] };
  const has = (name) => next.income.includes(name) || next.expense.includes(name);
  for (const c of changes || []) {
    for (const [from, to] of Object.entries(c.rename || {})) {
      for (const kind of ['income', 'expense']) {
        const i = next[kind].indexOf(from);
        if (i >= 0 && !has(to)) next[kind][i] = to;
      }
    }
    for (const kind of ['income', 'expense']) {
      for (const name of (c.add && c.add[kind]) || []) {
        const free = next[kind].indexOf(EMPTY_SLOT);
        if (!has(name) && free >= 0) next[kind][free] = name;
      }
    }
  }
  return next;
}

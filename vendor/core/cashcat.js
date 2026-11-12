// The "Tarik Tunai" (cash withdrawal) category: put into a free expense slot once, and given to the withdrawals already waiting.
import { EMPTY_SLOT } from './schema.js';

const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/** The slots with `name` added to the first free expense slot; null when it is already there or no slot is free. */
export function withCashCategory(slots, name) {
  if ([...slots.income, ...slots.expense].some((c) => same(c, name))) return null;
  const at = slots.expense.findIndex((c) => c === EMPTY_SLOT || String(c).trim() === '');
  if (at < 0) return null;
  const expense = [...slots.expense];
  expense[at] = name;
  return { income: [...slots.income], expense };
}

/** Whether `name` is one of the categories in the slots. */
export const hasCategory = (slots, name) => [...slots.income, ...slots.expense].some((c) => same(c, name));

/** Row updates: an ATM withdrawal that waits with no category and has an account becomes `name`, approved. */
export function cashRowUpdates(rows, name) {
  return rows
    .filter((r) => r.direction === 'out' && r.description === 'Tarik tunai ATM' && !r.category && r.status === 'pending' && r.stream)
    .map((r) => ({ id: r.id, changes: { category: name, status: 'approved' } }));
}

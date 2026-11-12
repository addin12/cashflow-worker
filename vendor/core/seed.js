// The seed is the first-run data: year, start date, payday, categories, accounts.
// The real one lives in private/seed.json (git-ignored); config/seed.example.json is the public sample.

import { buildCategorySlots, validateAccounts } from './categories.js';
import { CONFIG_KEYS } from './schema.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Throws with every problem found; returns the seed with padded category slots. */
export function validateSeed(seed) {
  const errors = [];
  if (!seed || typeof seed !== 'object') throw new Error('seed must be an object');
  if (!Number.isInteger(seed.year) || seed.year < 2000 || seed.year > 2100) errors.push('year must be a 4-digit year');
  if (!DATE.test(seed.start_date || '')) errors.push('start_date must be YYYY-MM-DD');
  else if (Number(seed.start_date.slice(0, 4)) !== seed.year) errors.push('start_date must be in the seed year');
  if (!Number.isInteger(seed.payday_day) || seed.payday_day < 1 || seed.payday_day > 31) errors.push('payday_day must be 1..31');
  if (!seed.owner_name || typeof seed.owner_name !== 'string') errors.push('owner_name is required');
  let slots;
  try { slots = buildCategorySlots(seed.categories); } catch (e) { errors.push(e.message); }
  try { validateAccounts(seed.accounts); } catch (e) { errors.push(e.message); }
  const defaults = { transfer: 'trf ke bank lain', fee: 'Biaya Admin', dividend: 'Dividen & Bunga', ...(seed.default_categories || {}) };
  const known = new Set([...(seed.categories?.income || []), ...(seed.categories?.expense || []), 'Penyesuaian', 'trf ke bank lain', defaults.transfer]);
  for (const [k, v] of Object.entries(defaults)) if (!known.has(v)) errors.push(`default_categories.${k} "${v}" is not a category`);
  const rules = seed.rules || [];
  rules.forEach((r, i) => {
    if (!known.has(r.category)) errors.push(`rules[${i}]: category "${r.category}" is not a category`);
    try { new RegExp(r.pattern, 'i'); } catch (e) { errors.push(`rules[${i}]: invalid pattern (${e.message})`); }
  });
  if (seed.owner_bank_names && !Array.isArray(seed.owner_bank_names)) errors.push('owner_bank_names must be a list');
  // category_changes: [{ since: <setup version>, rename: { old: new }, add: { income: [], expense: [] } }]
  // brings an existing sheet in line with the seed's category list when it upgrades past `since`.
  (seed.category_changes || []).forEach((c, i) => {
    if (!Number.isInteger(c.since)) errors.push(`category_changes[${i}]: since must be a setup version`);
    for (const to of Object.values(c.rename || {})) if (!known.has(to)) errors.push(`category_changes[${i}]: "${to}" is not a category`);
    for (const name of [...(c.add?.income || []), ...(c.add?.expense || [])]) if (!known.has(name)) errors.push(`category_changes[${i}]: "${name}" is not a category`);
  });
  // data_fixes: one-off repairs, see applyDataFixes in gas/setup.js.
  (seed.data_fixes || []).forEach((f, i) => {
    if (!Number.isInteger(f.since)) errors.push(`data_fixes[${i}]: since must be a setup version`);
    (f.transactions || []).forEach((t, j) => {
      if (!Array.isArray(t) || t.length !== 3) errors.push(`data_fixes[${i}].transactions[${j}]: must be [id, from, to]`);
      else if (!known.has(t[2])) errors.push(`data_fixes[${i}].transactions[${j}]: "${t[2]}" is not a category`);
    });
    (f.move_to_opening || []).forEach((m, j) => {
      if (!Array.isArray(m) || m.length !== 3 || !Number.isFinite(Number(m[2]))) errors.push(`data_fixes[${i}].move_to_opening[${j}]: must be [id, stream, amount]`);
    });
    try { validateAccounts(f.add_accounts || []); } catch (e) { errors.push(`data_fixes[${i}].add_accounts: ${e.message}`); }
    (f.set_hints || []).forEach((x, j) => {
      if (!x.stream || x.match_hint === undefined) errors.push(`data_fixes[${i}].set_hints[${j}]: stream and match_hint are required`);
    });
    (f.fill_stream || []).forEach((x, j) => {
      if (!x.owner || !x.sender || !x.stream) errors.push(`data_fixes[${i}].fill_stream[${j}]: owner, sender and stream are required`);
    });
    (f.rules || []).forEach((r, j) => {
      if (!r.pattern) errors.push(`data_fixes[${i}].rules[${j}]: pattern is required`);
      if (r.to && !known.has(r.to)) errors.push(`data_fixes[${i}].rules[${j}]: "${r.to}" is not a category`);
    });
  });
  // config: { key: value } for Config keys, filled once when empty (see fillNewConfig in gas/setup.js).
  const configKeys = new Set(CONFIG_KEYS.map((k) => k.key));
  for (const k of Object.keys(seed.config || {})) if (!configKeys.has(k)) errors.push(`config.${k} is not a Config key`);
  if (errors.length) throw new Error(`Invalid seed:\n${errors.join('\n')}`);
  return { ...seed, slots, defaults, rules, owner_bank_names: seed.owner_bank_names || [] };
}

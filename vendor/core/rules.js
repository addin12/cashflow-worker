// Auto-categorization rules (Rules tab). A rule's pattern is a case-insensitive regular
// expression tested against the row's description (field "description"), details ("details")
// or both ("any"). Rules are checked top-down; the first match wins.

export function compileRule(rule) {
  try {
    return { ...rule, re: new RegExp(rule.pattern, 'i') };
  } catch (e) {
    return { ...rule, re: null, error: `invalid pattern: ${e.message}` };
  }
}

const truthy = (v) => v === true || /^(true|ya|yes|1|✓)$/i.test(String(v).trim());

/** @returns {object|null} the first matching rule (with `autoApprove` as a boolean) */
export function matchRule(row, rules) {
  for (const r of rules) {
    const c = r.re !== undefined ? r : compileRule(r);
    if (!c.re || !c.category) continue;
    const field = String(c.field || 'description').toLowerCase();
    const text = field === 'details' ? row.details : field === 'any' ? `${row.description} ${row.details}` : row.description;
    if (c.re.test(String(text || ''))) return { ...c, autoApprove: truthy(c.auto_approve) };
  }
  return null;
}

/** Escapes text so a rule made from "CIRCLE K (JKT)" matches it literally. */
export function literalPattern(text) {
  return String(text).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Pending rows (with an account) that the rules can settle: an uncategorised row takes the first matching rule's
 * category, and a row is approved when its rule auto-approves it (a fee row, made together with its payment, when
 * it already has a category). Rows that wait for an account at sync time are the usual case.
 * @returns {{id: string, changes: object}[]}
 */
export function ruleUpdates(rows, rules) {
  const compiled = rules.map(compileRule);
  const byId = new Map(compiled.map((r) => [String(r.id), r]));
  const out = [];
  for (const r of rows) {
    if (r.status !== 'pending' || !r.stream) continue;
    const rule = r.category ? byId.get(String(r.rule_id)) : matchRule(r, compiled);
    const changes = {};
    if (!r.category && rule) { changes.category = rule.category; changes.rule_id = rule.id || ''; }
    const auto = rule && (rule.autoApprove !== undefined ? rule.autoApprove : truthy(rule.auto_approve));
    if ((r.category || changes.category) && (auto || (r.category && String(r.id).endsWith('_fee')))) changes.status = 'approved';
    if (Object.keys(changes).length) out.push({ id: r.id, changes });
  }
  return out;
}

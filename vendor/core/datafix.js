// Seed data_fixes that add accounts and give them the rows that came in before the account existed
// (a newcomer's bank emails are read first and wait with no account). Pure, so it can be tested.

/**
 * @param {{accounts: object[], rows: object[], fixes: {add_accounts?: object[], fill_stream?: {owner, sender, stream}[]}[]}} p
 * @returns {{added: object[], updates: {id: string, changes: {stream: string}}[]}}
 *   added: accounts whose name isn't in the sheet yet; updates: rows with no account of that owner and sender, now on that account
 */
export function accountFixes({ accounts, rows, fixes }) {
  const have = new Set(accounts.map((a) => a.stream));
  const added = [];
  for (const f of fixes) {
    for (const a of f.add_accounts || []) if (!have.has(a.stream)) { have.add(a.stream); added.push(a); }
  }
  const updates = [];
  for (const f of fixes) {
    for (const x of f.fill_stream || []) {
      if (!have.has(x.stream)) continue; // the account itself isn't there (the owner removed it): leave the rows alone
      for (const r of rows) {
        if (!r.stream && r.owner === x.owner && String(r.sender || '').toLowerCase().includes(String(x.sender).toLowerCase())) updates.push({ id: r.id, changes: { stream: x.stream } });
      }
    }
  }
  return { added, updates };
}

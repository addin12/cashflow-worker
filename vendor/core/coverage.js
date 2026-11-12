// Which senders look financial and have no reader yet: only the sender's domain and a count are kept, never a subject, a name or an amount.

/** The domain of a From header ("Name <a@b.co.id>" -> "b.co.id"); '' when there is none. */
export const domainOf = (from) => {
  const m = String(from || '').toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})/);
  return m ? m[1] : '';
};

/**
 * @param {{from: string, subject: string}[]} mails  headers of mail whose subject looks financial
 * @param {(from: string, subject: string) => boolean} hasReader  whether a parser already handles it
 * @returns {{domain: string, count: number}[]}  uncovered domains, most mail first
 */
export function coverageReport(mails, hasReader) {
  const counts = new Map();
  for (const m of mails) {
    const domain = domainOf(m.from);
    if (!domain || hasReader(m.from, m.subject)) continue;
    counts.set(domain, (counts.get(domain) || 0) + 1);
  }
  return [...counts].map(([domain, count]) => ({ domain, count })).sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));
}

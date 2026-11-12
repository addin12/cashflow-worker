// The Gmail reader, reached through a service binding to the `household-mail` Worker (the only place the Gmail sign-ins live).
// Its list and fetch tools are the same two calls the Apps Script sync makes.

/** @param {{fetch: Function}} binding  the service binding (env.MAIL); @param {string} token  that Worker's bearer token (env.MAIL_TOKEN) */
export function mailClient(binding, token) {
  let n = 0;
  const call = async (name, args) => {
    const res = await binding.fetch('https://household-mail/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: (n += 1), method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = await res.json().catch(() => ({}));
    const r = body.result;
    if (!res.ok || !r) throw new Error(`mail service answered ${res.status}`);
    if (r.isError) throw new Error(String(r.content[0].text).slice(0, 200));
    return JSON.parse(r.content[0].text);
  };
  return {
    /** Message ids matching a Gmail query, newest first (at most `max`, at most 500). */
    list: (who, query, max = 100) => call(`gmail_${who}_list`, { query, max }),
    /** One message as the parsers take it: { id, from, subject, epochMs, body, isHtml }. */
    fetch: (who, id) => call(`gmail_${who}_fetch`, { id }),
  };
}

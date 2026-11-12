// "Tanya apa saja", the second half: a question the rules cannot read is handed to Cloudflare's free AI (Workers AI), which only turns the sentence into a small
// structured request (what, which period, which category or shop, which person). The app then checks every field against what exists (sanitizeParsed in
// core/ask.js) and works out the numbers itself from the rows. The AI never sees a transaction or an amount, only the question and the names of the categories
// and the two people, and it never writes a number into an answer.
import { looksFinancial } from '../vendor/core/ask.js';

export const MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';
const TIMEOUT_MS = 8000;

const SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ['spend', 'income', 'compare', 'last', 'bills', 'who', 'budget', 'where', 'week', 'subs'] },
    period: { type: 'string', enum: ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'last_30', 'this_year'] },
    comparePeriod: { type: 'string', enum: ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'last_30', 'this_year'] },
    category: { type: 'string' },
    merchant: { type: 'string' },
    person: { type: 'string' },
    next: { type: 'boolean' },
  },
  required: ['intent'],
};

export function promptOf(context) {
  const cats = [...(context.categories.expense || []), ...(context.categories.income || [])].join('; ');
  return [
    'You read short questions about household money (Indonesian or English) for a budgeting app and answer with ONE JSON object, nothing else.',
    'intent: spend (how much spent), income (how much came in), compare (two periods), last (when was the last payment to something), bills (upcoming bills), who (which person spends more), budget (what is left of a budget), where (where did the money go), week (review of the week), subs (subscriptions).',
    'period (default this_month): today, yesterday, this_week, last_week, this_month, last_month, last_30, this_year. comparePeriod only for compare.',
    `category: copy ONE name exactly from this list when the question is about it, else leave it out: ${cats}.`,
    'merchant: a shop or word to search in descriptions (for example Grab, Spotify, Alfamart), else leave it out.',
    `person: one of ${(context.members || []).join(', ')} when the question is about one of them (the person asking is ${context.me || 'unknown'}), else leave it out.`,
    `Today is ${context.today}.`,
    'Examples: "berapa habis buat kopi bulan lalu" -> {"intent":"spend","period":"last_month","merchant":"kopi"}; "Dewi atau aku yang lebih boros" -> {"intent":"who"}; "kapan terakhir beli bensin" -> {"intent":"last","merchant":"bensin"}; "resep nasi goreng" -> {"intent":"none"}.',
    'If the text is not a question about money, answer {"intent":"none"}. Never invent a category, person or shop that the question does not mention.',
  ].join('\n');
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error('AI timeout')), ms))]);

/** The first JSON object in the AI's answer (an object already, or text that may wrap it in words or a code fence). */
export function objectOf(reply) {
  if (reply && typeof reply === 'object') return reply;
  const text = String(reply || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch (e) { return null; }
}

/** What the AI made of `text`, or null (no AI configured, no answer, over the free allowance, not a money question). Never throws. */
export async function parseWithAi(ai, text, context) {
  if (!ai || typeof ai.run !== 'function') return null;
  const messages = [{ role: 'system', content: promptOf(context) }, { role: 'user', content: String(text).slice(0, 200) }];
  const attempts = [{ messages, max_tokens: 120, temperature: 0, response_format: { type: 'json_schema', json_schema: SCHEMA } }, { messages, max_tokens: 120, temperature: 0 }];
  for (const input of attempts) {
    try {
      const out = await withTimeout(ai.run(MODEL, input), TIMEOUT_MS);
      const obj = objectOf(out && out.response);
      if (obj && obj.intent && obj.intent !== 'none') return obj;
      if (obj) return null; // it answered, and it is not a money question
    } catch (e) { /* the second attempt is without the schema; after that, no help */ }
  }
  return null;
}

/** Runs the app's `ask`: the rules first; the AI only for what they cannot read. `call(name, args)` is the unit's method caller. */
export async function askWithHelp({ call, ai }, text) {
  const first = (await call('ask', { text })).result;
  if (first.kind !== 'unknown') return first;
  if (!looksFinancial(text, first.context)) return { kind: 'unknown' }; // not about money: nothing to ask the AI
  const parsed = await parseWithAi(ai, text, first.context);
  if (!parsed) return { kind: 'unknown' };
  const second = (await call('ask', { text, parsed })).result;
  return second.kind === 'unknown' ? { kind: 'unknown' } : { ...second, source: 'ai' };
}

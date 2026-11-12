// Turns an email body into a list of text tokens (one per table cell / paragraph / line), so
// parsers can say "the value after the label X" whatever the email's HTML looks like.

const BLOCK_END = /<\/(p|div|td|th|tr|li|h[1-6]|table|tbody|thead|section|header|footer|center)>|<br\s*\/?>/gi;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', bull: '•', middot: '·', ndash: '–', mdash: '—' };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function clean(line) {
  return line.replace(/[ ​‌‍﻿]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** HTML body -> tokens. */
export function htmlToTokens(html) {
  const body = String(html)
    .replace(/<(head|style|script|title)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(BLOCK_END, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(body).split('\n').map(clean).filter(Boolean);
}

/**
 * Plain-text body -> tokens. Also accepts the markdown-like text some mail tools produce
 * ("| Label | : | Value |", "Penerima#### NAME"): pipes and heading marks separate tokens.
 */
export function textToTokens(text) {
  return String(text)
    .split(/\r?\n|\||#{2,}/)
    .map((t) => clean(t.replace(/^#+\s*/, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')))
    .filter((t) => t && t !== ':');
}

/**
 * The shape of an email with everything personal taken out, so an unreadable one can be fixed without reading it:
 * short labels ("Tanggal:") are kept, every other piece of text becomes what it looks like (an amount, a date, a number, so many words).
 * Runs of the same shape are counted, e.g. "<text:2> | tanggal: | <date> | nominal: | <amount>".
 */
export function maskedOutline(tokens, max = 400) {
  const shapes = [];
  for (const raw of tokens) {
    const s = clean(String(raw));
    if (!s) continue;
    let shape;
    if (s.length <= 30 && s.endsWith(':') && !/\d/.test(s)) shape = s.toLowerCase();
    else if (/^\d{1,2}[:.]\d{2}([:.]\d{2})?(\s?(wib|wita|wit))?$/i.test(s)) shape = '<time>';
    else if (/\d{4}-\d{2}-\d{2}|\d{1,2}[\s/-](\d{1,2}|[a-z]{3,9})[\s/-]\d{2,4}/i.test(s) && s.length <= 30) shape = '<date>';
    else if (/^(rp|idr|usd)\.?\s?-?[\d.,]+$/i.test(s) || /^-?\d{1,3}([.,]\d{3})+([.,]\d{1,2})?$/.test(s)) shape = '<amount>';
    else if (/\d{6,}/.test(s.replace(/[\s.-]/g, ''))) shape = '<number>';
    else shape = `<text:${s.split(/\s+/).length}>`;
    const last = shapes[shapes.length - 1];
    if (last && last.shape === shape && !shape.endsWith(':')) last.n += 1; else shapes.push({ shape, n: 1 });
  }
  const out = shapes.map((x) => (x.n > 1 ? `${x.shape}×${x.n}` : x.shape)).join(' | ');
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

export function bodyToTokens(body, isHtml) {
  return isHtml ? htmlToTokens(body) : textToTokens(body);
}

const norm = (s) => clean(String(s)).replace(/\s*:$/, '').toLowerCase();

/**
 * Value of the first token after `label` (exact, case-insensitive). Returns '' when the label
 * is missing or when the next token is itself one of `labels` (an empty field). With `inline`, a token that starts with the label and
 * carries the value after it ("Tanggal 6 Nov 2026", as plain-text mail has it) counts too, when no token is the label alone.
 */
export function valueAfter(tokens, label, labels = [], inline = false) {
  const want = norm(label);
  const stop = new Set(labels.map(norm));
  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (norm(tokens[i]) === want) {
      let j = i + 1;
      while (j < tokens.length && tokens[j].trim() === ':') j += 1;
      const v = tokens[j] ?? '';
      return stop.has(norm(v)) ? '' : v.replace(/^:\s*/, '').trim();
    }
  }
  if (!inline) return '';
  // A longer known label that starts the same way ("Nominal" and "Nominal Transaksi") is not this one.
  const longer = [...stop].filter((l) => l.length > want.length && l.startsWith(`${want} `));
  for (const t of tokens) {
    const n = norm(t);
    if (!n.startsWith(`${want} `) || longer.some((l) => n.startsWith(`${l} `) || n === l)) continue;
    const v = clean(t).slice(want.length + 1).replace(/^:\s*/, '').trim();
    if (v) return v;
  }
  return '';
}

/** First of several labels that has a value. */
export function firstValue(tokens, labels, allLabels = labels, inline = false) {
  for (const l of labels) {
    const v = valueAfter(tokens, l, allLabels, inline);
    if (v) return v;
  }
  return '';
}

/** Index of the first token matching a regex, or -1. */
export function findToken(tokens, re) {
  return tokens.findIndex((t) => re.test(t));
}

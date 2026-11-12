// Logging by Telegram: a message to your own bot becomes transactions, like an email to yourself
// ("kopi 28rb gopay"). Pure parts: reading a message, which chats may log, and what the bot answers.
// The bot token is kept as a script property, never in the sheet (gas/telegram.js does the talking).

import { safeEqual } from './push.js';

const TOKEN_FORMAT = /^\d{6,12}:[A-Za-z0-9_-]{30,50}$/;
export const validToken = (t) => TOKEN_FORMAT.test(String(t || '').trim());

const num = (v) => Number(v) || 0;
const rp = (n) => `Rp${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.round(num(n)))}`;

/** A message's text -> a command (/start, /bantuan ...) or the notes in it, one per line (at most 10). */
export function parseMessage(text) {
  const t = String(text || '').trim().slice(0, 1500);
  const cmd = t.match(/^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
  if (cmd) return { command: cmd[1].toLowerCase(), arg: String(cmd[2] || '').trim(), notes: [] };
  const notes = t.split(/\r?\n/).map((l) => l.replace(/^\s*(catat|log)\b[:\s-]*/i, '').trim()).filter(Boolean).slice(0, 10);
  return { command: '', arg: '', notes };
}

/** "code|time|name": the one-time code for linking a chat, who asked for it, and when. */
export const makeNonce = (code, at, name) => `${code}|${at}|${name}`;
export function parseNonce(text) {
  const [code, at, ...name] = String(text || '').split('|');
  return code && Number(at) ? { code, at: Number(at), name: name.join('|') } : null;
}

export const chatOwner = (chats, id) => (chats.find((c) => String(c.chat) === String(id)) || {}).owner || '';
/** The chats with this one added (one entry per chat, newest first, at most 3 a person). */
export function linkChat(chats, chat, owner, label, at) {
  const next = [{ chat, owner, label: String(label || 'Telegram').slice(0, 40), at }, ...chats.filter((c) => String(c.chat) !== String(chat))];
  const seen = new Map();
  return next.filter((c) => { const n = (seen.get(c.owner) || 0) + 1; seen.set(c.owner, n); return n <= 3; });
}
export const unlinkOwner = (chats, owner) => chats.filter((c) => c.owner !== owner);

const T = {
  id: {
    help: 'Kirim transaksi seperti ditulis di aplikasi, satu baris satu transaksi:\n• kopi 28rb gopay\n• gaji 8,5jt BCA\n• parkir 5rb cash kemarin #trip\n\nYang lengkap langsung tersimpan; yang belum lengkap menunggu di Cek di aplikasi. /bantuan menampilkan pesan ini.',
    linked: (n) => `Terhubung sebagai ${n}. Mulai sekarang pesan di sini dicatat sebagai transaksimu.`,
    badCode: 'Kode tidak dikenal atau sudah kedaluwarsa. Buka lagi Pengaturan → Telegram di aplikasi dan ketuk tombol hubungkan.',
    notLinked: 'Chat ini belum terhubung. Buka aplikasi → Pengaturan → Telegram, lalu ketuk "Hubungkan Telegram-ku".',
    saved: 'Tersimpan', waiting: 'menunggu di Cek (lengkapi kategori atau rekening)', noAmount: 'Tidak ada jumlah di:', nothing: 'Tidak ada yang bisa dicatat.',
  },
  en: {
    help: 'Send transactions the way you type them in the app, one per line:\n• coffee 28k gopay\n• salary 8.5m BCA\n• parking 5k cash yesterday #trip\n\nComplete ones are saved at once; incomplete ones wait in Review in the app. /help shows this message.',
    linked: (n) => `Connected as ${n}. From now on messages here are logged as your transactions.`,
    badCode: 'Unknown or expired code. Open Settings → Telegram in the app again and tap the connect button.',
    notLinked: 'This chat is not connected yet. Open the app → Settings → Telegram, then tap "Connect my Telegram".',
    saved: 'Saved', waiting: 'waiting in Review (add a category or account)', noAmount: 'No amount in:', nothing: 'Nothing to log.',
  },
};
const t = (lang) => T[lang] || T.id;
export const helpText = (lang = 'id') => t(lang).help;

/** What the bot says after a message was logged (the result of api.addNotes). */
export function replyText(res, lang = 'id') {
  const x = t(lang);
  const lines = [...(res.rows || []).map((r) => (r.status === 'approved'
    ? `✅ ${r.description} ${r.direction === 'in' ? '+' : ''}${rp(r.amount)} · ${[r.stream, r.category].filter(Boolean).join(' · ')}`
    : `⏳ ${r.description} ${r.direction === 'in' ? '+' : ''}${rp(r.amount)}: ${x.waiting}`)),
  ...(res.skipped || []).map((s) => `❓ ${x.noAmount} "${String(s).slice(0, 60)}"`)];
  return lines.length ? lines.join('\n') : x.nothing;
}

/**
 * One update from Telegram -> what to answer and what changed. Nothing is written here: the caller does.
 * @param {object} u  the update ({update_id, message: {text, date, chat: {id, type}, from}})
 * @param {{chats: object[], nonce: string, now: number, lang: string, addNotes: (who: string, p: {gmailId, sentMs, notes}) => object}} ctx
 * @returns {{replies: string[], chats?: object[], clearNonce?: boolean, added: number}}
 */
export function handleUpdate(u, { chats, nonce, now, lang = 'id', addNotes }) {
  const m = u && u.message;
  if (!m || typeof m.text !== 'string' || !m.chat || m.chat.type !== 'private') return { replies: [], added: 0 }; // only private chats, only text
  const msg = parseMessage(m.text);
  const x = t(lang);
  if (msg.command === 'start' && msg.arg) {
    const n = parseNonce(nonce);
    if (n && safeEqual(msg.arg, n.code) && now - n.at < 30 * 60000) {
      const label = (m.from && (m.from.first_name || m.from.username)) || 'Telegram';
      return { replies: [`${x.linked(n.name)}\n\n${x.help}`], chats: linkChat(chats, m.chat.id, n.name, label, new Date(now).toISOString()), clearNonce: true, added: 0 };
    }
    return { replies: [x.badCode], added: 0 };
  }
  const who = chatOwner(chats, m.chat.id);
  if (!who) return { replies: [x.notLinked], added: 0 };
  if (msg.command || !msg.notes.length) return { replies: [x.help], added: 0 };
  const res = addNotes(who, { gmailId: `tg${u.update_id}`, sentMs: num(m.date) * 1000 || now, notes: msg.notes });
  return { replies: [replyText(res, lang)], added: res.added || 0 };
}

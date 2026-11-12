// Fixes from the security audit of 2026-11-12: unreadable-mail alerts respect whose mailbox it is, and the calendar feed neutralises every line-break character.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { toIcs } from '../src/feed.js';
import { alertUnread } from '../src/push.js';
import { localD1 } from './d1shim.js';

let db;
let sent;
const set = (k, v) => db.sqlite.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(k, v);
const cfg = () => Object.fromEntries(db.sqlite.prepare('SELECT key, value FROM config').all().map((r) => [r.key, r.value]));
const dev = (owner) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${owner}`, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) }, owner, label: owner });
const push = { site: 'https://s', send: async (subscriptions, notification) => { sent.push({ to: subscriptions.map((s) => s.endpoint.split('/').pop()), notification }); return subscriptions.map((s) => ({ endpoint: s.endpoint, status: 201 })); } };
const line = (gmail, subject) => ({ gmail, subject, reason: 'no amount found', status: 'error' });

beforeEach(() => {
  sent = [];
  db = localD1();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  set('owner_name', 'Me');
  set('owner_email', 'me@example.com');
  set('push_devices', JSON.stringify([dev('Me'), dev('Dewi')]));
});

describe('alertUnread', () => {
  it('alone: the owner hears every subject', async () => {
    await alertUnread(db, cfg(), push, [line('me@example.com', 'Mine one'), line('x@example.com', 'Other box')]);
    expect(sent).toHaveLength(1);
    expect(sent[0].notification.body).toContain('Mine one');
    expect(sent[0].notification.body).toContain('Other box');
  });

  it('two people: each hears the subjects of their own mailbox only; the owner hears a count for the other one', async () => {
    set('partner_name', 'Dewi');
    set('partner_email', 'dewi@example.com');
    await alertUnread(db, cfg(), push, [line('me@example.com', 'Mine one'), line('dewi@example.com', 'Hers one'), line('dewi@example.com', 'Hers two')]);
    const toOwner = sent.find((s) => s.to.includes('Me'));
    const toPartner = sent.find((s) => s.to.includes('Dewi'));
    expect(toOwner.notification.body).toContain('Mine one');
    expect(toOwner.notification.body).not.toMatch(/Hers/);
    expect(toOwner.notification.body).toContain('2 email di Gmail lainnya belum terbaca');
    expect(toPartner.notification.body).toContain('Hers one');
    expect(toPartner.notification.body).not.toContain('Mine one');
    expect(toPartner.to).toEqual(['Dewi']);
  });

  it('two people, only the partner\'s mailbox has a problem: the owner is told that, without subjects', async () => {
    set('partner_name', 'Dewi');
    set('partner_email', 'dewi@example.com');
    await alertUnread(db, cfg(), push, [line('dewi@example.com', 'Hers one')]);
    expect(sent.find((s) => s.to.includes('Me')).notification.body).toBe('1 email di Gmail lainnya belum terbaca');
    expect(sent.find((s) => s.to.includes('Dewi')).notification.body).toContain('Hers one');
  });
});

describe('calendar feed text', () => {
  it('every line-break character in a title becomes a literal \\n, so it cannot start a new property', () => {
    const ics = toIcs(['2026-11-20|Bill\rATTENDEE:mailto:x@example.com', '2026-11-21|Two\u2028lines\u0085here\vok\r\nmore'], { stamp: new Date(Date.UTC(2026, 10, 12)) });
    const lines = ics.split('\r\n');
    expect(lines.some((l) => l.startsWith('ATTENDEE'))).toBe(false);
    expect(ics).toContain('SUMMARY:Bill\\nATTENDEE:mailto:x@example.com');
    expect(ics).toContain('SUMMARY:Two\\nlines\\nhere\\nok\\nmore');
    expect([0x85, 0x2028, 0x2029, 0x0b].some((c) => ics.includes(String.fromCharCode(c)))).toBe(false);
  });
});

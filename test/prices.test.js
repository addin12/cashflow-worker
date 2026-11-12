import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { TABS } from '../vendor/core/schema.js';
import { refreshPrices } from '../src/prices.js';
import { localD1 } from './d1shim.js';

const NOW = Date.parse('2026-11-11T03:00:00Z');
const asset = (o) => ({ id: 'x', name: 'n', kind: 'stock', qty: 1, unit_value: 0, ticker: '', price: '', paid: 0, notes: 'keep me', price_at: '', warranty: '', ...o });
const YAHOO = (v) => JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: v } }] } });
const GOLD = '<p>Harga pembelian kembali: Rp2.443.500/grm</p>';

let db;
const put = (rows) => rows.forEach((r) => db.sqlite.prepare('INSERT INTO tabs (tab, id, json) VALUES (?, ?, ?)').run(TABS.assets, r.id, JSON.stringify(r)));
const stored = (id) => JSON.parse(db.sqlite.prepare('SELECT json FROM tabs WHERE tab = ? AND id = ?').get(TABS.assets, id).json);
const cfg = (k) => (db.sqlite.prepare('SELECT value FROM config WHERE key = ?').get(k) || {}).value;
const site = (pages) => async (url) => { const hit = Object.keys(pages).find((k) => url.includes(k)); if (!hit) throw new Error('HTTP 404'); const v = pages[hit]; if (v instanceof Error) throw v; return v; };

beforeEach(() => { db = localD1(); db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')); });

describe('refreshPrices', () => {
  it('prices a stock from Yahoo, gold from harga-emas.org, and keeps every other field', async () => {
    put([asset({ id: 's', ticker: 'BBCA' }), asset({ id: 'g', kind: 'gold' }), asset({ id: 'h', kind: 'property' })]);
    const r = await refreshPrices(db, { get: site({ 'BBCA.JK': YAHOO(9250), 'harga-emas.org': GOLD }), now: () => NOW });
    expect(r).toEqual({ updated: 2, tried: 2 });
    expect(stored('s')).toMatchObject({ price: 9250, price_at: NOW, notes: 'keep me' });
    expect(stored('g')).toMatchObject({ price: 2443500, price_at: NOW });
    expect(stored('h').price).toBe('');
    expect(cfg('price_status')).toBe('2026-11-11 03:00 UTC: 2 of 2 priced');
    expect(cfg('data_stamp')).toBe(String(NOW));
  });

  it('falls back to the Google Finance page, and says what failed', async () => {
    put([asset({ id: 's', ticker: 'IDX:TLKM' }), asset({ id: 'z', ticker: 'NOPE' })]);
    const r = await refreshPrices(db, { get: site({ 'TLKM.JK': new Error('HTTP 429'), 'TLKM:IDX': '<div>Rp3,150</div>' }), now: () => NOW });
    expect(r.updated).toBe(1);
    expect(stored('s').price).toBe(3150);
    expect(stored('z').price).toBe('');
    expect(cfg('price_status')).toMatch(/^2026-11-11 03:00 UTC: 1 of 2 priced; .*HTTP 429/);
  });

  it('leaves fresh prices alone and asks the network for nothing', async () => {
    put([asset({ id: 's', ticker: 'BBCA', price: 9000, price_at: NOW - 10 * 60000 })]);
    let calls = 0;
    const r = await refreshPrices(db, { get: async () => { calls += 1; return ''; }, now: () => NOW });
    expect(r).toEqual({ updated: 0, tried: 0 });
    expect(calls).toBe(0);
    expect(cfg('price_status')).toBeUndefined();
  });

  it('a gold price that cannot be read is reported, and the old price stays', async () => {
    put([asset({ id: 'g', kind: 'gold', price: 2400000, price_at: NOW - 3600000 })]);
    const r = await refreshPrices(db, { get: site({ 'harga-emas.org': '<p>nothing</p>' }), now: () => NOW });
    expect(r.updated).toBe(0);
    expect(stored('g').price).toBe(2400000);
    expect(cfg('price_status')).toContain('emas: harga Antam tidak terbaca');
    expect(cfg('data_stamp')).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { heartbeat } from '../src/heartbeat.js';

const URL_ = 'https://hc-ping.example/abc-123';
const at = (min) => Date.UTC(2026, 10, 12, 5, min);
const spy = (status = 200) => { const calls = []; return { calls, fetchImpl: async (u) => { calls.push(u); return new Response('OK', { status }); } }; };

describe('heartbeat', () => {
  it('does nothing without a URL, or with one that is not https', async () => {
    const s = spy();
    expect(await heartbeat({}, { fetchImpl: s.fetchImpl })).toBe('off');
    expect(await heartbeat({ HEARTBEAT_URL: 'http://insecure.example/x' }, { fetchImpl: s.fetchImpl })).toBe('off');
    expect(s.calls).toEqual([]);
  });
  it('pings once every ten minutes while all is well', async () => {
    const s = spy();
    expect(await heartbeat({ HEARTBEAT_URL: URL_ }, { now: at(10), fetchImpl: s.fetchImpl })).toBe('ok');
    expect(await heartbeat({ HEARTBEAT_URL: URL_ }, { now: at(11), fetchImpl: s.fetchImpl })).toBe('skipped');
    expect(await heartbeat({ HEARTBEAT_URL: `${URL_}/` }, { now: at(20), fetchImpl: s.fetchImpl })).toBe('ok');
    expect(s.calls).toEqual([URL_, URL_]);
  });
  it('reports a failure at once, on any minute', async () => {
    const s = spy();
    expect(await heartbeat({ HEARTBEAT_URL: URL_ }, { ok: false, now: at(13), fetchImpl: s.fetchImpl })).toBe('failed-reported');
    expect(s.calls).toEqual([`${URL_}/fail`]);
  });
  it('never throws, whatever the watchman answers', async () => {
    expect(await heartbeat({ HEARTBEAT_URL: URL_ }, { now: at(0), fetchImpl: async () => { throw new Error('down'); } })).toBe('unreachable');
    expect(await heartbeat({ HEARTBEAT_URL: URL_ }, { now: at(0), fetchImpl: spy(500).fetchImpl })).toBe('answered 500');
  });
});

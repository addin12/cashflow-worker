// The jobs that run once a day, as the Apps Script app's daily and evening triggers do. The minute schedule starts them (a free Worker has only a few
// schedules): each job is due in its hour (UTC), is started once a day (Config daily_done), and runs as queue messages of its own, so each has its own CPU time.
//   feed     09:00 Jakarta  the calendar feeds (src/feed.js)
//   morning  08:00 Jakarta  planned transactions that are due; phone notifications for bills tomorrow, claims, warranties and payday
//   evening  21:00 Jakarta  "close the day" nudge, for whoever switched it on
import { jakarta } from './clock.js';
import { isPayday } from '../vendor/core/payday.js';
import { billsNotice, claimsNotice, closeNotice, paydayNotice, warrantyNotice } from '../vendor/core/push.js';
import { cuts } from './app.js';
import { buildFeed, householdPeople } from './feed.js';
import { live, pushOn } from './push.js';
import { openUnit } from './unit.js';

export const JOBS = [
  { name: 'feed', hour: 2, messages: [{ feed: 'owner' }, { feed: 'partner' }] },
  { name: 'morning', hour: 1, messages: [{ job: 'plans' }, { job: 'alerts' }] },
  { name: 'evening', hour: 14, messages: [{ job: 'close', who: 'owner' }, { job: 'close', who: 'partner' }] },
];

/** The queue messages of the jobs due now that have not been started today; marks them started. */
export async function dueJobs(db, nowMs) {
  const t = new Date(nowMs);
  const hour = JOBS.filter((j) => j.hour === t.getUTCHours());
  if (!hour.length) return [];
  const today = t.toISOString().slice(0, 10);
  const row = await db.prepare("SELECT value FROM config WHERE key = 'daily_done'").first();
  let done = {};
  try { done = JSON.parse((row && row.value) || '{}'); } catch (e) { done = {}; }
  const due = hour.filter((j) => done[j.name] !== today);
  if (!due.length) return [];
  for (const j of due) done[j.name] = today;
  await db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('daily_done', ?1)").bind(JSON.stringify(done)).run();
  return due.flatMap((j) => j.messages);
}

const jakartaDay = (now) => { const w = new Date(now().getTime() + 7 * 3600000); return new Date(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate()); };

/** One queue message of a daily job. Returns a short note of what it did. */
export async function runJob(db, msg, { now = () => jakarta(), push = null } = {}) {
  if (msg.feed) return `feed ${msg.feed}: ${await buildFeed(db, msg.feed, { now })} events`;
  const c = cuts(now());
  const cfgRows = (await db.prepare("SELECT key, value FROM config WHERE key IN ('owner_name','owner_email','partner_name','partner_email')").all()).results;
  const people = householdPeople(Object.fromEntries(cfgRows.map((r) => [r.key, r.value])));
  const owner = people.owner || { name: '', email: '', owner: true };
  if (msg.job === 'plans') {
    const unit = await openUnit(db, c.bills, { now, who: () => owner, push });
    const { result } = await unit.call('createDuePlanned', {});
    return `plans: ${result.created} created`;
  }
  if (msg.job === 'alerts') {
    const unit = await openUnit(db, c.bills, { now, who: () => owner, push });
    const cfg = unit.config();
    if (!live(cfg)) return 'alerts: off until cutover (Config worker_push)';
    const lang = String(cfg.language || 'id') === 'en' ? 'en' : 'id';
    const sent = [];
    const dash = unit.api.dashboard({ part: 'bills' });
    const tomorrow = (dash.bills || []).filter((b) => b.daysLeft === 1);
    const claims = (dash.claims || []).filter((x) => x.daysLeft >= 0 && x.daysLeft <= 3);
    const warranties = (dash.warranties || []).filter((x) => [30, 7, 1].includes(x.daysLeft));
    const jobs = [[tomorrow, billsNotice], [claims, claimsNotice], [warranties, warrantyNotice]];
    for (const [list, make] of jobs) if (list.length && pushOn(cfg, 'bills')) { await unit.notify(make(list, lang), { event: 'bills' }); sent.push(make.name); }
    for (const p of Object.entries(people)) {
      const [who, person] = p;
      const day = Number(cfg[who === 'owner' ? 'payday_day' : 'partner_payday_day']) || (who === 'owner' ? 28 : 0); // the partner has none until they set one
      if (day && isPayday(jakartaDay(now), day) && pushOn(cfg, 'payday', person.name)) { await unit.notify(paydayNotice(lang), { event: 'payday', only: person.name }); sent.push(`payday ${who}`); }
    }
    return `alerts: ${sent.join(', ') || 'none'}`;
  }
  if (msg.job === 'close') {
    const person = people[msg.who];
    if (!person) return 'close: no such person';
    const unit = await openUnit(db, c.main, { now, who: () => person, push });
    const cfg = unit.config();
    if (!live(cfg) || !pushOn(cfg, 'close', person.name)) return 'close: off';
    const day = unit.api.review().day;
    if (day.closed || day.byHand) return 'close: not needed';
    await unit.notify(closeNotice(String(cfg.language || 'id') === 'en' ? 'en' : 'id'), { event: 'close', only: person.name });
    return 'close: sent';
  }
  return 'unknown job';
}

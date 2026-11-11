// 3.2 coach engine: signals, tips, learning from accept/dismiss, split topics, weekly review,
// reminders and anonymous sharing.
import assert from 'node:assert/strict';
import { createChrome } from './chrome-mock.mjs';

const mock = createChrome();
globalThis.chrome = mock.chrome;
let respond = () => new Response('{}', { status: 404 });
globalThis.fetch = async (url, opts = {}) => respond(String(url), opts);

const S = await import('../lib/study.js');
const C = await import('../lib/coach.js');

const T = (id, title, extra = {}) => ({ id, title, done: false, ...extra });
const syl = { id: 'd', name: 'DBMS', units: [{ id: 'u', title: 'U', topics: [T('er', 'ER model'), T('sql', 'SQL'), T('nf', 'Normalization'), T('tx', 'Transactions')] }] };
const today = '2026-11-11'; // Wednesday
const at = (day, h = 19) => new Date(`${day}T${String(h).padStart(2, '0')}:00:00`).getTime();
const NOW = at(today, 12);
const base = (extra = {}) => S.mergeStudy({ setupDone: true, profile: { name: 'Shalu', level: 'college' }, subjects: [{ id: 's', name: 'DBMS', syllabusId: 'd', examDate: '2026-12-10', maxMarks: 100, importance: 2 }], prefs: { minutesPerDay: 180, restDays: [], revisionDays: 2 }, ...extra });

// ---- signals ----
let st = base({ dayPlan: { '2026-11-08': 180, '2026-11-09': 180, '2026-11-10': 180 }, dayDone: { '2026-11-08': 30, '2026-11-09': 20, '2026-11-10': 40 } });
assert.equal(Math.round(C.completion(st, today) * 100), 17);
assert.equal(C.completion(base(), today), null, 'needs 3 days of history');
assert.equal(C.streak(st, today), 3);
assert.equal(C.streak({ dayDone: { '2026-11-09': 10 } }, today), 0, 'broken yesterday');
assert.equal(C.lastActive(st), '2026-11-10');
const hourLog = [9, 9, 9, 21, 9, 21].map((h, i) => ({ at: at(`2026-11-0${i + 2}`, h), kind: 'item.done', data: {} }));
assert.equal(C.usualHour({ log: hourLog }, NOW), 9);
assert.equal(C.usualHour({ log: hourLog.slice(0, 3) }, NOW), null, 'needs 5 data points');

// ---- tips ----
// lighten: did 17% of the plan
let tips = C.suggestions(st, [syl], null, today, NOW);
const lighten = tips.find((t) => t.type === 'lighten');
assert.ok(lighten, 'lighten suggested');
assert.equal(lighten.actions[0].apply.patch.minutesPerDay, 120);
// more: ahead of plan
st = base({ dayPlan: { '2026-11-08': 60, '2026-11-09': 60, '2026-11-10': 60 }, dayDone: { '2026-11-08': 90, '2026-11-09': 80, '2026-11-10': 100 } });
assert.ok(C.suggestions(st, [syl], null, today, NOW).some((t) => t.type === 'more'));
// split: postponed twice
st = base({ log: [{ at: NOW - 864e5, kind: 'item.later', data: { topicId: 'nf' } }, { at: NOW - 2 * 864e5, kind: 'item.later', data: { topicId: 'nf' } }, { at: NOW - 30 * 864e5, kind: 'item.later', data: { topicId: 'sql' } }, { at: NOW - 864e5, kind: 'item.later', data: { topicId: 'sql' } }] });
tips = C.suggestions(st, [syl], null, today, NOW);
const split = tips.find((t) => t.type === 'split');
assert.equal(split.id, 'split:nf');
assert.ok(!tips.some((t) => t.id === 'split:sql'), 'old postponements don’t count');
// apply split → plan has parts
let res = C.applyTip(st, [syl], split, split.actions[0], today);
assert.equal(res.study.overrides.nf.parts, 2);
let plan = S.buildPlan(res.study, [syl], today);
const parts = plan.days.flatMap((d) => d.items).filter((i) => i.topicId === 'nf' && i.kind === 'learn');
assert.deepEqual(parts.map((p) => p.title), ['Learn: Normalization (part 1 of 2)', 'Learn: Normalization (part 2 of 2)']);
assert.deepEqual(parts.map((p) => p.minutes), [30, 30]);
assert.equal(parts[0].key, 'learnpart:nf:1');
assert.equal(res.study.coach.memory.split.accepted, 1);
assert.ok(!C.suggestions(res.study, [syl], null, today, NOW).some((t) => t.type === 'split'), 'not suggested again once split');
// part 1 done → only part 2 left
res.study.progress['learnpart:nf:1'] = today;
plan = S.buildPlan(res.study, [syl], today);
assert.deepEqual(plan.days.flatMap((d) => d.items).filter((i) => i.topicId === 'nf' && i.kind === 'learn').map((i) => i.part), [2]);
// make room: not enough time
st = base({ prefs: { minutesPerDay: 30, restDays: [], revisionDays: 2 }, subjects: [{ id: 's', name: 'DBMS', syllabusId: 'd', examDate: '2026-11-15', maxMarks: 100, importance: 2 }] });
const room = C.suggestions(st, [syl], null, today, NOW).find((t) => t.type === 'room');
assert.ok(room);
assert.deepEqual(room.actions.map((a) => a.apply.kind), ['prefs', 'skip', 'prefs']);
res = C.applyTip(st, [syl], room, room.actions[1], today);
assert.ok(Object.values(res.study.overrides).every((o) => o.skip));
// rewatch after a low quiz score → revise
const lect = { videos: { tx: { videoId: 'v1' } }, quiz: { v1: { best: 2 } } };
const rew = C.suggestions(base(), [syl], lect, today, NOW).find((t) => t.type === 'rewatch');
assert.equal(rew.id, 'rewatch:tx');
res = C.applyTip(base(), [syl], rew, rew.actions[0], today);
assert.equal(res.syllabi[0].units[0].topics[3].revise, true);
// streak saver in the evening
st = base({ dayDone: { '2026-11-09': 30, '2026-11-10': 30 } });
assert.ok(!C.suggestions(st, [syl], null, today, at(today, 12)).some((t) => t.type === 'streak'), 'not at noon');
const sk = C.suggestions(st, [syl], null, today, at(today, 19)).find((t) => t.type === 'streak');
assert.match(sk.title, /2-day streak/);
assert.equal(C.applyTip(st, [syl], sk, sk.actions[0], today).focus, sk.actions[0].apply.task);
// restart after a break
st = base({ dayDone: { '2026-11-05': 60 } });
assert.ok(C.suggestions(st, [syl], null, today, NOW).some((t) => t.type === 'restart'));
// off switch, setup not done
assert.deepEqual(C.suggestions(base({ coach: { tips: false }, dayDone: { '2026-11-05': 60 } }), [syl], null, today, NOW), []);
assert.deepEqual(C.suggestions(S.mergeStudy({ dayDone: { '2026-11-05': 60 } }), [syl], null, today, NOW), []);

// ---- learning from dismissals ----
st = base({ dayDone: { '2026-11-05': 60 } });
let tip = C.suggestions(st, [syl], null, today, NOW).find((t) => t.type === 'restart');
const w0 = tip.weight;
C.dismissTip(st, tip, today);
assert.ok(!C.suggestions(st, [syl], null, today, NOW).some((t) => t.id === tip.id), 'snoozed for 3 days');
assert.ok(C.suggestions(st, [syl], null, '2026-11-15', at('2026-11-15', 12)).some((t) => t.id === tip.id), 'back after the snooze');
const w1 = C.suggestions(st, [syl], null, '2026-11-15', at('2026-11-15', 12)).find((t) => t.id === tip.id).weight;
assert.ok(w1 < w0, 'weight halves after a dismissal');
C.dismissTip(st, tip, '2026-11-15');
C.dismissTip(st, tip, '2026-11-20');
assert.equal(st.coach.muted.restart, true, 'muted after 3 dismissals in a month');
assert.ok(!C.suggestions(st, [syl], null, '2026-12-01', at('2026-12-01', 12)).some((t) => t.type === 'restart'));

// ---- day plan + weekly review ----
st = base();
C.recordDayPlan(st, [syl], today);
assert.ok(st.dayPlan[today] > 0);
const first = st.dayPlan[today];
st.prefs.minutesPerDay = 60;
C.recordDayPlan(st, [syl], today);
assert.equal(st.dayPlan[today], first, 'recorded once per day');
assert.equal(C.weekKey('2026-11-11'), '2026-11-09');
assert.equal(C.weekKey('2026-11-15'), '2026-11-09', 'Sunday belongs to the week that started Monday');
st = base({ dayPlan: { '2026-11-09': 120, '2026-11-10': 120 }, dayDone: { '2026-11-09': 120, '2026-11-10': 90 }, log: [{ at: NOW - 3600e3, kind: 'item.done' }, { at: NOW - 7200e3, kind: 'lecture.done' }, { at: NOW - 7200e3, kind: 'lecture.note' }, { at: NOW - 10 * 864e5, kind: 'item.done' }] });
const w = C.weekStats(st, { points: { log: [{ at: NOW - 3600e3, pts: 20 }, { at: NOW - 20 * 864e5, pts: 99 }] } }, today, NOW);
assert.deepEqual([w.minutes, w.planned, w.items, w.lectures, w.notes, w.activeDays, w.points, w.bestDay], [210, 240, 1, 1, 1, 2, 20, '2026-11-09']);
assert.match(C.reviewText(w, 'Shalu'), /^Shalu, you studied 3h 30m this week on 2 days \(88% of the plan\)\. You finished 1 lecture and wrote 1 notes\./);
assert.match(C.reviewText({ minutes: 0, items: 0 }), /quiet/);
respond = (url, opts) => { const b = JSON.parse(opts.body); assert.equal(b.task, 'coach'); assert.match(b.messages[1].content, /"minutes":210/); return new Response(JSON.stringify({ content: JSON.stringify({ review: 'You studied consistently on two days. Next week, start each day with one Learn task.' }) }), { status: 200 }); };
assert.match(await C.aiReview(w, { name: 'Shalu', level: 'college' }, {}), /consistently/);

// ---- reminders ----
st = base({ log: hourLog.map((e) => ({ ...e, at: e.at + 864e5 * 5 })), dayDone: { '2026-11-09': 30, '2026-11-10': 30 } });
assert.equal(C.reminderNow(st, [syl], at(today, 9)).kind, 'usual');
assert.equal(C.reminderNow(st, [syl], at(today, 10)), null);
assert.equal(C.reminderNow(st, [syl], at(today, 20)).kind, 'streak');
st.coach = { ...C.coachOf(st), notified: { [today]: ['streak'] } };
assert.equal(C.reminderNow(st, [syl], at(today, 21)), null, 'once a day');
st.dayDone[today] = 10;
assert.equal(C.reminderNow(st, [syl], at(today, 9)), null, 'nothing once work is done');
st = base({ coach: { reminders: false }, dayDone: { '2026-11-09': 30, '2026-11-10': 30 } });
assert.equal(C.reminderNow(st, [syl], at(today, 20)), null, 'reminders off');

// ---- sharing ----
const log = [
  { at: NOW - 1000, kind: 'item.done', data: { kind: 'learn', topicId: 'nf', minutes: 60, part: 0, title: 'secret' } },
  { at: NOW - 900, kind: 'profile', data: { level: 'college' } },
  { at: NOW - 800, kind: 'coach.dismiss', data: { type: 'split' } },
  { at: NOW - 700, kind: 'lecture.note', data: { videoId: 'abc', t: 125.456 } },
];
const ev = C.sanitizeEvents(log, { since: 0, level: 'college' });
assert.equal(ev.length, 3, 'only known kinds');
assert.deepEqual(ev[0].data, { kind: 'learn', minutes: 60, part: 0 }, 'no ids, titles or text');
assert.deepEqual(ev[1].data, { type: 'split' });
assert.deepEqual(ev[2].data, { t: 125.46 });
assert.equal(ev[0].level, 'college');
assert.equal(C.sanitizeEvents(log, { since: NOW - 750 }).length, 1, 'only new events');
assert.equal(C.canShare(base()), false, 'off by default');
assert.equal(C.canShare(base({ coach: { share: true } })), true);
assert.equal(C.canShare(base({ profile: { level: 'school' }, coach: { share: true } })), false, 'school needs a guardian');
assert.equal(C.canShare(base({ profile: { level: 'school' }, coach: { share: true, guardian: true } })), true);

console.log('coach engine (signals, tips, learning, split topics, weekly review, reminders, sharing): all assertions passed');

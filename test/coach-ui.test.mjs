// 3.2 coach in the side panel + background reminders and opt-in sharing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { createChrome } from './chrome-mock.mjs';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const html = fs.readFileSync(new URL('../sidepanel/sidepanel.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/sidepanel/sidepanel.html', pretendToBeVisual: true });
const errors = [];
dom.window.addEventListener('error', (e) => errors.push(e.error || e.message));
process.on('unhandledRejection', (e) => errors.push(e));
for (const k of ['window', 'document', 'Node', 'HTMLElement', 'Event', 'CustomEvent', 'KeyboardEvent', 'localStorage', 'navigator', 'DOMParser', 'Blob']) {
  Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true });
}
globalThis.scrollTo = () => {};
dom.window.scrollTo = () => {};
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
const downloads = [];
dom.window.HTMLAnchorElement.prototype.click = function () { if (this.download) downloads.push(this.download); };
globalThis.URL.createObjectURL = () => 'blob:x';
globalThis.URL.revokeObjectURL = () => {};

const uploads = [];
globalThis.fetch = async (url, opts = {}) => {
  const b = JSON.parse(opts.body || '{}');
  if (b.task === 'events') { uploads.push(b.events); return new Response(JSON.stringify({ saved: b.events.length }), { status: 200 }); }
  if (b.task === 'coach') return new Response(JSON.stringify({ content: JSON.stringify({ review: 'Two solid days of study. Next week, begin with the hardest topic while you are fresh.' }) }), { status: 200 });
  return new Response('{}', { status: 404 });
};

const iso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const T = (id, title) => ({ id, title, done: false, videos: null });
const nowHour = new Date().getHours();
const atHour = (daysAgo, h) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(h, 5, 0, 0); return d.getTime(); };
const dayPlan = {}; const dayDone = {};
for (let i = 1; i <= 8; i++) { dayPlan[iso(-i)] = 240; dayDone[iso(-i)] = i <= 3 ? 30 : 200; }
dayDone[iso(0)] = 10; // something done today, so no evening streak tip whatever the clock says
const log = [
  { at: Date.now() - 864e5, kind: 'item.later', data: { topicId: 'nf' } },
  { at: Date.now() - 2 * 864e5, kind: 'item.later', data: { topicId: 'nf' } },
  ...[1, 2, 3, 4, 5, 6].map((d) => ({ at: atHour(d, nowHour), kind: 'item.done', data: { kind: 'learn', minutes: 30 } })),
];

const mock = createChrome();
globalThis.chrome = mock.chrome;
await import('../background.js');
await mock.fire.installed();
await tick();
await chrome.storage.local.set({
  settings: { ...mock.store.settings, cloudAI: true },
  syllabi: [{ id: 'S', name: 'DBMS', subject: 'DBMS', units: [{ id: 'u', title: 'Design', topics: [T('er', 'ER model'), T('nf', 'Normalization'), T('sql', 'SQL queries')] }] }],
  study: { setupDone: true, profile: { name: 'Shalu', level: 'school', classYear: '12' }, subjects: [{ id: 's', name: 'DBMS', syllabusId: 'S', examDate: iso(30), maxMarks: 100, importance: 2 }], prefs: { minutesPerDay: 240, restDays: [], revisionDays: 1 }, dayPlan, dayDone, log },
});
await import('../sidepanel/app.js');
await tick(80);
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const byText = (sel, text) => $$(sel).find((b) => b.textContent.trim() === text);
const study = () => mock.store.study;

byText('#subnav button', 'Plan').click();
await tick(80);
assert.ok(study().dayPlan[iso(0)] > 0, 'today’s planned minutes recorded');

// Coach shows the two strongest tips
const tips = $$('.coach .tip');
assert.equal(tips.length, 2);
assert.ok($$('.tip-title').some((t) => /Normalization” keeps moving to tomorrow/.test(t.textContent)));
assert.ok($$('.tip-title').some((t) => /too full/.test(t.textContent)), 'lighter days (did 12% over 3 days)');

// Accept: split Normalization into 2 parts
byText('.tip-split button', 'Split into 2 parts').click();
await tick(80);
assert.equal(study().overrides.nf.parts, 2);
assert.equal(study().log.at(-1).kind, 'coach.accept');
const partItems = () => $$('.plan-item').filter((i) => /Normalization \(part/.test(i.textContent));
assert.equal(partItems().length, 2, 'two parts in the plan');
// Tick part 1: topic not learned yet; part 2: learned
const tickPart = async (n) => {
  const it = $$('.plan-item').find((i) => i.textContent.includes(`Normalization (part ${n} of 2)`));
  it.querySelector('input[type="checkbox"]').click();
  await tick(80);
};
const nf = () => mock.store.syllabi[0].units[0].topics[1];
await tickPart(1);
assert.equal(nf().done, false, 'one part done is not the whole topic');
assert.ok(study().progress['learnpart:nf:1']);
await tickPart(2);
assert.equal(nf().done, true, 'last part done → topic learned');

// Dismiss "lighter days" three times (a few days apart) → muted
const lightTip = () => $('.tip-lighten');
for (let n = 1; n <= 3; n++) {
  assert.ok(lightTip(), `shown before dismissal ${n}`);
  byText('.tip-lighten button', 'Not now').click();
  await tick(80);
  assert.ok(!lightTip(), 'snoozed after Not now');
  assert.equal(study().coach.memory.lighten.dismissed.length, n);
  if (n < 3) { await chrome.storage.local.set({ study: { ...study(), coach: { ...study().coach, snooze: {} } } }); await tick(80); }
}
assert.equal(study().coach.muted.lighten, true, 'muted after 3 dismissals');
assert.ok(study().log.filter((l) => l.kind === 'coach.dismiss').length === 3);
await chrome.storage.local.set({ study: { ...study(), coach: { ...study().coach, snooze: {} } } });
await tick(80);
assert.ok(!lightTip(), 'muted tips stay hidden even after the snooze');

// Plan settings: muted tip listed and can be turned back on
$('.plan-settings').open = true;
await tick();
const unmute = byText('.coach-settings button', 'Lighter days');
assert.ok(unmute, 'muted tip listed');
unmute.click();
await tick(80);
assert.equal(study().coach.muted.lighten, undefined);
await chrome.storage.local.set({ study: { ...study(), coach: { ...study().coach, snooze: {} } } });
await tick(80);
assert.ok(lightTip(), 'back after turning it on');

// Weekly review (8 days of history) with template text, then AI
assert.match($('.review').textContent, /Your week/);
assert.match($('.review-text').textContent, /^Shalu, you studied /);
byText('.review button', 'Get a personal review (AI)').click();
await tick(100);
assert.match($('.review-text').textContent, /Two solid days/);
assert.ok($('.review').textContent.includes('Written by AI'));
byText('.review button', 'Hide').click();
await tick(60);
assert.equal($('.review'), null);

// Coach settings: sharing needs a guardian for school students
const sw = (label) => $$('.coach-settings .toggle').find((t) => t.textContent.startsWith(label)).querySelector('input');
assert.equal(sw('Help improve Oris').checked, false, 'off by default');
sw('Help improve Oris').click();
await tick(80);
assert.match($('.coach-settings').textContent, /Nothing is shared until a parent or guardian agrees/);
// background tick: no upload without guardian
await mock.fire.alarm('oris-coach');
await tick(80);
assert.equal(uploads.length, 0, 'no sharing without guardian consent');
$('.guardian input').click();
await tick(80);
assert.equal(study().coach.guardian, true);

// Background: reminder at the usual hour (once), plus the daily anonymous upload
await chrome.storage.local.set({ study: { ...study(), dayDone: { ...study().dayDone, [iso(0)]: 0 } } }); // nothing done yet today
await tick(40);
const before = mock.notifications.length;
await mock.fire.alarm('oris-coach');
await tick(120);
const sent = mock.notifications.slice(before);
assert.equal(sent.length, 1, 'one reminder');
assert.match(sent[0].title, /Your usual study time|streak/);
assert.equal(uploads.length, 1, 'shared once');
assert.ok(uploads[0].length > 0);
assert.ok(uploads[0].every((e) => !JSON.stringify(e).includes('nf') && !JSON.stringify(e).includes('Normalization') && !JSON.stringify(e).includes('Shalu')), 'nothing identifying');
assert.ok(uploads[0].every((e) => e.level === 'school'));
await mock.fire.alarm('oris-coach');
await tick(120);
assert.equal(mock.notifications.length, before + 1, 'not repeated');
assert.equal(uploads.length, 1, 'once a day');

// Reminders off
sw('Reminders').click();
await tick(60);
assert.equal(study().coach.reminders, false);

// Download learning data
byText('.coach-settings button', 'Download my learning data').click();
assert.match(downloads.at(-1), /^oris-learning-data-\d{4}-\d{2}-\d{2}\.json$/);

// Coach tips off hides the coach
sw('Coach tips').click();
await tick(80);
assert.equal($('.coach'), null);

assert.equal(/\bnull\b|\bundefined\b|NaN/.test(document.body.textContent), false, 'no stray null/undefined/NaN');
assert.deepEqual(errors, [], 'no runtime errors');
console.log('coach UI: tips, split topics, learning from dismissals, mute/unmute, weekly review, guardian-gated sharing, reminders, data download: all assertions passed');
process.exit(0);

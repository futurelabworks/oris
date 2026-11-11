// 3.1 lecture player page end to end (the YouTube relay is simulated with postMessage events).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { createChrome } from './chrome-mock.mjs';

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const html = fs.readFileSync(new URL('../player/player.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'chrome-extension://abcdefghijklmnop/player/player.html#v=acidVideo01&topic=acid&syl=S', pretendToBeVisual: true });
const errors = [];
dom.window.addEventListener('error', (e) => errors.push(e.error || e.message));
process.on('unhandledRejection', (e) => errors.push(e));
for (const k of ['window', 'document', 'Node', 'HTMLElement', 'Event', 'CustomEvent', 'KeyboardEvent', 'MessageEvent', 'navigator', 'location', 'history', 'Blob']) {
  Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true });
}
const downloads = [];
dom.window.HTMLAnchorElement.prototype.click = function () { if (this.download) downloads.push(this.download); };
globalThis.URL.createObjectURL = () => 'blob:x';
globalThis.URL.revokeObjectURL = () => {};
dom.window.HTMLElement.prototype.requestFullscreen = function () { this._full = true; };
let quizCalls = 0;
globalThis.fetch = async (url, opts = {}) => {
  const body = JSON.parse(opts.body || '{}');
  if (body.task === 'quiz') {
    quizCalls++;
    return new Response(JSON.stringify({ content: JSON.stringify({ questions: [1, 2, 3, 4, 5].map((n) => ({ q: `Question ${n}?`, options: ['Right', 'Wrong'], answer: 'Right', explain: 'Because.' })) }) }), { status: 200 });
  }
  return new Response('{}', { status: 404 });
};

const T = (id, title) => ({ id, title, done: false });
const mock = createChrome();
globalThis.chrome = mock.chrome;
await import('../background.js');
await mock.fire.installed();
await tick();
await chrome.storage.local.set({
  syllabi: [{ id: 'S', name: 'DBMS', subject: 'DBMS', units: [{ id: 'u', title: 'Transactions', topics: [T('acid', 'ACID properties'), T('ser', 'Serializability')] }] }],
  lectures: { videos: { acid: { videoId: 'acidVideo01', title: 'ACID in one shot', channel: 'Prof', seconds: 600 }, ser: { videoId: 'serVideo001', title: 'Serializability', channel: 'Prof', seconds: 900 } } },
  study: { subjects: [], setupDone: true },
});
await import('../player/player.js');
await tick(80);
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const byText = (sel, text) => $$(sel).find((b) => b.textContent.trim() === text);
const key = (k) => document.body.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true }));
const frame = () => $('#stage iframe');
const posted = [];
const hook = () => { frame().contentWindow.postMessage = (m) => posted.push(m); };
const relay = (data) => dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { oris: 1, ...data }, origin: 'https://futurelabworks.github.io', source: frame().contentWindow }));
const lect = () => mock.store.lectures;

// Boot: relay player for the video, crumbs, points
assert.ok(frame().src.startsWith('https://futurelabworks.github.io/oris/player/#v=acidVideo01'));
hook();
assert.match($('#crumbs').textContent, /DBMS · ACID properties · Prof/);
assert.equal($('#points').textContent, '★ 0 points');
assert.equal($('#btn-prev').disabled, true);
assert.equal($('#btn-next').disabled, false);
relay({ type: 'ready', d: 600 });
relay({ type: 'state', state: 1 });

// Controls send commands
key(' ');
assert.equal(posted.at(-1).cmd, 'pauseVideo', 'space pauses while playing');
relay({ type: 'state', state: 2 });
key(' ');
assert.equal(posted.at(-1).cmd, 'playVideo');
$('#speed').value = '1.5'; $('#speed').dispatchEvent(new dom.window.Event('change'));
assert.deepEqual(posted.at(-1), { oris: 1, cmd: 'setPlaybackRate', args: [1.5] });
key(']');
assert.equal($('#speed').value, '1.75');
relay({ type: 'time', t: 100, d: 600, state: 1, rate: 1.75 });
key('l');
assert.deepEqual(posted.at(-1).args, [110, true], 'L = +10s');
$('#btn-back').click();
assert.deepEqual(posted.at(-1).args, [100, true]);
assert.equal($('#time').textContent, '1:40 / 10:00');

// Timestamped note (pauses while typing), then a pinned sticky
relay({ type: 'time', t: 125, d: 600, state: 1, rate: 1 });
const ta = $('#note-input');
ta.value = 'Atomicity = all or nothing';
ta.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
assert.equal(posted.at(-1).cmd, 'pauseVideo', 'pauses while typing');
ta.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
await tick(60);
assert.equal(lect().notes.acidVideo01.length, 1);
assert.equal(Math.round(lect().notes.acidVideo01[0].t), 125, 'stamped at the time typing started');
relay({ type: 'time', t: 300, d: 600, state: 2, rate: 1 });
$('#btn-pin').click();
await tick();
$('#note-input').value = 'Exam question here!';
$('#note-input').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
byText('.note-box button', 'Save note').click();
await tick(60);
const notes = lect().notes.acidVideo01;
assert.equal(notes.length, 2);
assert.equal(notes[1].sticky, true);
assert.equal($$('.pl-mark').length, 2);
assert.equal($$('.pl-mark.sticky').length, 1, 'sticky pinned on the timeline');
assert.equal($('.pl-mark.sticky').style.left, '50%');
// clicking a note's time seeks
$$('.note .t-chip')[0].click();
assert.deepEqual(posted.at(-1).args, [125, true]);
// download + add to Oris notes
byText('button', 'Download notes (.md)').click();
assert.deepEqual(downloads, ['oris-notes-acid-properties.md']);
byText('button', 'Add to my Oris notes').click();
await tick(60);
assert.match(mock.store.planner.notes[0].text, /ACID properties \(lecture notes\)/);
// delete a note
$$('.note .x')[0].click();
await tick(60);
assert.equal(lect().notes.acidVideo01.length, 1);

// A–B loop
relay({ type: 'time', t: 200, d: 600, state: 1, rate: 1 });
key('a');
relay({ type: 'time', t: 230, d: 600, state: 1, rate: 1 });
key('b');
assert.deepEqual(posted.at(-1).args, [200, true], 'loop starts');
relay({ type: 'time', t: 231, d: 600, state: 1, rate: 1 });
assert.deepEqual(posted.at(-1).args, [200, true], 'jumps back at the end of the loop');
key('b'); // loop off
assert.equal($('#loopband').hidden, true);

// Watching most of it completes the lecture: +20 points, topic learned in the plan
for (let t = 0; t <= 560; t += 2) relay({ type: 'time', t, d: 600, state: 1, rate: 1 });
await tick(120);
assert.equal(lect().points.total, 20);
assert.equal(lect().progress.acidVideo01.done, true);
assert.equal(mock.store.syllabi[0].units[0].topics[0].done, true, 'topic marked learned');
assert.ok(mock.store.study.progress['learn:acid']);
assert.ok(mock.store.study.log.some((l) => l.kind === 'lecture.done'));
assert.equal($('#points').textContent, '★ 20 points');
relay({ type: 'state', state: 0 });
await tick(30);
assert.equal($('#endcard').hidden, false);
assert.match($('#endcard').textContent, /Lecture complete ✓/);
assert.ok(byText('#endcard button', 'Next: Serializability'));

// Practice: 5 questions, points only for beating your best
byText('#endcard button', 'Practice now').click();
await tick();
await chrome.storage.local.set({ settings: { ...mock.store.settings, cloudAI: true } });
await tick(30);
byText('.pl-panel button', 'Start practice').click();
await tick(80);
assert.equal(quizCalls, 1);
for (let i = 0; i < 5; i++) {
  byText('.quiz-opts button', i < 4 ? 'A. Right' : 'B. Wrong').click();
  await tick();
  byText('.pl-panel button', i < 4 ? 'Next question' : 'See score').click();
  await tick(40);
}
assert.equal($('.quiz-score').textContent, '4/5');
assert.equal(lect().points.total, 40, '+20 for 4 right');
byText('.pl-panel button', 'New questions').click();
await tick(80);
for (let i = 0; i < 5; i++) { byText('.quiz-opts button', 'A. Right').click(); await tick(); byText('.pl-panel button', i < 4 ? 'Next question' : 'See score').click(); await tick(40); }
assert.equal(lect().points.total, 55, '+5 for one more right, +10 perfect');
byText('.pl-panel button', 'New questions').click();
await tick(80);
for (let i = 0; i < 5; i++) { byText('.quiz-opts button', 'A. Right').click(); await tick(); byText('.pl-panel button', i < 4 ? 'Next question' : 'See score').click(); await tick(40); }
assert.equal(lect().points.total, 55, 'no farming');
assert.match(document.body.textContent, /No new points/);
assert.equal(lect().quiz.acidVideo01.attempts, 3);

// Playlist tab and switching lectures
$('#tab-next').click();
await tick();
assert.equal($$('.pl-item').length, 2);
assert.match($$('.pl-item')[0].textContent, /✓ watched/);
$$('.pl-item')[1].click();
await tick(60);
assert.match(location.hash, /v=serVideo001/);
assert.ok(frame().src.includes('v=serVideo001'));
assert.match($('#crumbs').textContent, /Serializability/);
assert.equal($('#btn-next').disabled, true);

// Focus while watching
$('#btn-focus').click();
await tick(60);
assert.equal(mock.store.timer.status, 'running');
assert.equal(mock.store.timer.task, 'Lecture: Serializability');

// Fullscreen + video that can't play
$('#btn-full').click();
assert.equal($('#stage-wrap')._full, true);
hook();
relay({ type: 'ready', d: 900 });
relay({ type: 'error', code: 101 });
await tick();
assert.equal($('#failcard').hidden, false);
assert.ok($('#failcard a').href.startsWith('https://www.youtube.com/watch?v=serVideo001'));

assert.equal(/\bnull\b|\bundefined\b|NaN/.test(document.body.textContent), false, 'no stray null/undefined/NaN');
assert.deepEqual(errors, [], 'no runtime errors');
console.log('lecture player: relay, controls, notes, stickies, loop, completion + points, practice, playlist, focus, fallback: all assertions passed');
process.exit(0);

// 3.1 Study → Lectures in the side panel, plus the Plan's "▶ Lecture" button.
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
for (const k of ['window', 'document', 'Node', 'HTMLElement', 'Event', 'CustomEvent', 'KeyboardEvent', 'localStorage', 'navigator', 'DOMParser']) {
  Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true });
}
globalThis.scrollTo = () => {};
dom.window.scrollTo = () => {};
dom.window.HTMLElement.prototype.scrollIntoView = () => {};

let ytConfigured = false;
const ytCalls = [];
globalThis.fetch = async (url, opts = {}) => {
  const b = JSON.parse(opts.body || '{}');
  if (b.task === 'yt') {
    ytCalls.push(b);
    if (!ytConfigured) return new Response(JSON.stringify({ error: 'Lecture search isn’t set up yet.', code: 'yt_not_configured' }), { status: 503 });
    if (b.action === 'search') {
      const slug = b.query.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '').padEnd(8, 'x').slice(0, 8);
      return new Response(JSON.stringify({ videos: [1, 2].map((n) => ({ id: `${slug}00${n}`.padEnd(11, '0'), title: `${b.query} lecture ${n}`, channel: `Teacher ${n}`, durationSec: 1200 + n, views: 1e5 / n, likes: 4e3 / n, thumb: '' })) }), { status: 200 });
    }
    if (b.action === 'playlists') return new Response(JSON.stringify({ playlists: [{ id: 'PLcourse0001', title: 'DBMS full course', channel: 'Gate Smashers', count: 3 }] }), { status: 200 });
    if (b.action === 'playlist') return new Response(JSON.stringify({ videos: [
      { id: 'plACID00001', title: 'L1 ACID properties explained', channel: 'GS', durationSec: 900 },
      { id: 'plSER000001', title: 'L2 Serializability', channel: 'GS', durationSec: 900 },
      { id: 'plINTRO0001', title: 'Course introduction', channel: 'GS', durationSec: 300 },
    ] }), { status: 200 });
  }
  return new Response('{}', { status: 404 });
};

const T = (id, title) => ({ id, title, done: false, videos: null });
const mock = createChrome();
globalThis.chrome = mock.chrome;
await import('../background.js');
await mock.fire.installed();
await tick();
const iso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
await chrome.storage.local.set({
  syllabi: [
    { id: 'S', name: 'DBMS', subject: 'DBMS', units: [{ id: 'u', title: 'Transactions', topics: [T('acid', 'ACID properties'), T('ser', 'Serializability'), T('dl', 'Deadlock')] }] },
    { id: 'O', name: 'OS', subject: 'OS', units: [{ id: 'v', title: 'Processes', topics: [T('proc', 'Processes')] }] },
  ],
  study: { setupDone: true, profile: { name: 'Shalu' }, subjects: [{ id: 's1', name: 'DBMS', syllabusId: 'S', examDate: iso(20), maxMarks: 100, importance: 2 }, { id: 's2', name: 'OS', syllabusId: 'O', examDate: iso(25), maxMarks: 100, importance: 2 }], prefs: { minutesPerDay: 240, restDays: [], revisionDays: 0 }, deps: { ser: ['acid'] } },
});
await import('../sidepanel/app.js');
await tick(80);
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const byText = (sel, text) => $$(sel).find((b) => b.textContent.trim() === text);
const lect = () => mock.store.lectures;
const opened = () => mock.tabs.map((t) => t.url).filter((u) => u && u.includes('player/player.html'));

byText('#subnav button', 'Lectures').click();
await tick();
assert.deepEqual($$('.subj-tabs button').map((b) => b.textContent), ['DBMS', 'OS']);
assert.match($('.lec-head h2').textContent, /DBMS playlist/);
assert.match($('.lec-head').textContent, /0 of 0 lectures watched · 3 topics without a lecture/);
assert.deepEqual($$('.lec-topic').map((n) => n.textContent), ['ACID properties', 'Serializability', 'Deadlock'], 'study order');

// Server search not switched on yet: clear hint, nothing breaks
byText('button', 'Find lectures for all topics').click();
await tick(120);
assert.match($('.lec-head').textContent, /Automatic lecture search isn’t switched on yet/);
assert.equal(ytCalls.length, 1, 'stops after the first "not set up" answer');

// Paste a link for one topic
byText('.lec button', 'Choose').click();
await tick(80);
$('.lec-change input').value = 'https://youtu.be/AbCdEfGhIjK?t=30';
$('.lec-change form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
await tick(60);
assert.equal(lect().videos.acid.videoId, 'AbCdEfGhIjK');
assert.equal(lect().videos.acid.source, 'link');

// With search on: find the rest, then change one
ytConfigured = true;
byText('button', 'Find lectures for all topics').click();
await tick(150);
assert.ok(lect().videos.ser && lect().videos.dl, 'remaining topics filled');
assert.equal(lect().videos.acid.videoId, 'AbCdEfGhIjK', 'the student’s link kept');
assert.match($('.lec-head').textContent, /0 of 3 lectures watched/);
const serRow = $$('.lec').find((l) => l.textContent.includes('Serializability'));
byText('.lec button', 'Change') && [...serRow.querySelectorAll('button')].find((b) => b.textContent === 'Change').click();
await tick(80);
const opts = $$('.lec-opt');
assert.equal(opts.length, 2);
opts[1].click();
await tick(60);
assert.equal(lect().videos.ser.source, 'picked');
assert.match(lect().videos.ser.title, /lecture 2/);

// Play opens the Oris player in a new tab
$$('.lec-thumb')[0].click();
await tick();
assert.match(opened().at(-1), /player\/player\.html#v=AbCdEfGhIjK&topic=acid&syl=S$/);
byText('button', 'Start watching').click();
await tick();
assert.match(opened().at(-1), /v=AbCdEfGhIjK/);

// Find and import a full-course playlist
byText('button', 'Find a full-course playlist').click();
await tick(80);
assert.match($('.find-hit').textContent, /DBMS full course/);
byText('.find-hit button', 'Import').click();
await tick(120);
assert.equal(lect().videos.ser.videoId, 'plSER000001', 'playlist video matched to its topic');
assert.equal(lect().videos.acid.videoId, 'AbCdEfGhIjK', 'pasted link still kept');
assert.equal(lect().extras.S.length, 2, 'unmatched videos at the end');
assert.match(document.body.textContent, /More from the playlist/);

// Import by pasting a playlist link
$$('.lec-head .lec-link input')[0].value = 'https://www.youtube.com/playlist?list=PLcourse0001';
$$('.lec-head .lec-link input')[0].dispatchEvent(new dom.window.Event('input', { bubbles: true }));
$('.lec-head .lec-link').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
await tick(120);
assert.equal(ytCalls.filter((c) => c.action === 'playlist').length, 2);

// Other subject tab
byText('.subj-tabs button', 'OS').click();
await tick();
assert.match($('.lec-head h2').textContent, /OS playlist/);

// Player settings
$('.lec-settings').open = true;
const sel = $('.lec-settings select');
sel.value = 'direct'; sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
await tick(60);
assert.equal(lect().prefs.mode, 'direct');

// Plan: "▶ Lecture" opens the player, "Find lecture" goes to Lectures
byText('#subnav button', 'Plan').click();
await tick(60);
const lecBtn = byText('.plan-item button', '▶ Lecture');
assert.ok(lecBtn, 'plan offers the lecture');
lecBtn.click();
await tick();
assert.match(opened().at(-1), /player\/player\.html#v=/);
const find = byText('.plan-item button', 'Find lecture');
if (find) { find.click(); await tick(); assert.equal($('#subnav [aria-current="page"]').textContent, 'Lectures'); }

// Lecture points count towards Earn XP
await chrome.storage.local.set({ lectures: { ...lect(), points: { total: 75, log: [] } } });
await tick(60);
byText('.modes button', 'Earn').click();
await tick();
byText('#subnav button', 'Rewards').click();
await tick();
assert.ok($$('.xp-table tr').some((tr) => /Lecture points\s*75\s*1\s*75/.test(tr.textContent.replace(/\s+/g, ' ').replace(/(\D)(\d)/g, '$1 $2'))) || $$('.xp-table tr').some((tr) => tr.textContent.includes('Lecture points') && tr.textContent.includes('75')));

assert.equal(/\bnull\b|\bundefined\b|NaN/.test(document.body.textContent), false, 'no stray null/undefined/NaN');
assert.deepEqual(errors, [], 'no runtime errors');
console.log('lectures tab: order, not-set-up hint, paste link, find all, change, play, playlist import, settings, plan button, XP: all assertions passed');
process.exit(0);

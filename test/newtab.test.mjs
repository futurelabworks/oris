// New Tab page end to end: real background.js + app.js + newtab.js in jsdom.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { createChrome } from './chrome-mock.mjs';
import { settingsFromAnswers, describeSetup } from '../newtab/onboarding.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

// ---- onboarding mapping ----
const deep = settingsFromAnswers({ goal: 'learn', style: 'deadline', level: 'intermediate' });
assert.equal(deep.focusMin, 50);
assert.equal(deep.blockMode, 'session');
assert.equal(deep.autoStartFocus, true);
assert.match(describeSetup(deep).join('|'), /50-minute focus sessions with 10-minute breaks/);
assert.equal(settingsFromAnswers({ style: 'flow', level: 'expert' }).focusMin, 90);

const html = fs.readFileSync(new URL('../newtab/newtab.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/newtab/newtab.html', pretendToBeVisual: true });
const errors = [];
dom.window.addEventListener('error', (e) => errors.push(e.error || e.message));
process.on('unhandledRejection', (e) => errors.push(e));
for (const k of ['window', 'document', 'Node', 'HTMLElement', 'Event', 'CustomEvent', 'KeyboardEvent', 'localStorage', 'navigator', 'DOMParser']) {
  Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true });
}
globalThis.scrollTo = () => {};
dom.window.scrollTo = () => {};
dom.window.HTMLElement.prototype.scrollIntoView = () => {};

const mock = createChrome();
const searches = [];
mock.chrome.search = { query: (q) => searches.push(q) };
globalThis.chrome = mock.chrome;

await import('../background.js');
await mock.fire.installed('install');
await tick();
assert.equal(mock.tabs.length, 1, 'install opens a New Tab for onboarding');
assert.ok(mock.store.planner, 'planner initialised');

await import('../sidepanel/app.js');
await import('../newtab/newtab.js');
await tick(80);
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const byText = (sel, text) => $$(sel).find((b) => b.textContent.trim() === text);
const key = (k, target = document.body) => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true }));

// ---- onboarding ----
assert.equal($('#onboarding').hidden, false, 'onboarding shows on first run');
assert.equal($('.ob-card h2').textContent, 'What brings you to Oris?');
key('s'); await tick();
assert.equal($('#shell').hidden, true, 'hotkeys are off while onboarding is open');
byText('.ob-option', 'Learning for exams or courses').click(); await tick();
byText('.ob-option', 'Against a deadline').click(); await tick();
byText('.ob-option', 'About 50 minutes').click(); await tick();
assert.equal($('.ob-card h2').textContent, 'Oris is ready');
assert.equal($$('.ob-summary li').length, 4);
byText('.ob-card button', 'Show me around').click(); await tick(60);
assert.equal(mock.store.settings.onboarded, true);
assert.equal(mock.store.settings.focusMin, 50);
assert.equal(mock.store.settings.blockMode, 'session');
assert.deepEqual(mock.store.settings.profile, { goal: 'learn', style: 'deadline', level: 'intermediate' });
assert.equal($('.ob-tip h2').textContent, 'Your one focus');
assert.ok($('#nt-daily').classList.contains('tour-target'));
byText('.ob-tip button', 'Next').click(); await tick();
byText('.ob-tip button', 'Next').click(); await tick();
assert.equal($('.ob-tip h2').textContent, 'Study, Research, Earn');
byText('.ob-tip button', 'Done').click(); await tick();
assert.equal($('#onboarding').hidden, true);
assert.equal($$('.tour-target').length, 0);

// ---- focus hint: address bar has the keyboard until the page is clicked ----
document.hasFocus = () => false;
await tick(1100);
assert.equal($('#nt-focus-hint').hidden, false, 'hint shown while the page lacks focus');
document.hasFocus = () => true;
window.dispatchEvent(new dom.window.Event('focus'));
assert.equal($('#nt-focus-hint').hidden, true);
assert.equal($('#nt-daily').closest('label'), null, 'clicking near the daily line cannot focus it');

// ---- idle screen ----
assert.ok($('#nt-time').textContent.length >= 4, 'time shown');
assert.match($('#nt-date').textContent, /\d/);
assert.equal($('#nt-status').textContent, 'No focus time yet today.');
assert.equal($('#nt-actions button').textContent, 'Start 50-minute focus', 'uses the onboarding length');
const daily = $('#nt-daily');
daily.value = 'Finish DBMS unit 3';
daily.dispatchEvent(new dom.window.Event('change'));
await tick(60);
assert.equal(mock.store.planner.daily.text, 'Finish DBMS unit 3');

// Space starts focus with the daily focus as the task
document.activeElement.blur && document.activeElement.blur();
key(' '); await tick(80);
assert.equal(mock.store.timer.status, 'running');
assert.equal(mock.store.timer.task, 'Finish DBMS unit 3');
assert.equal(mock.rules.length, 1, 'blocking on');
assert.match($('#nt-status').textContent, /^Focus: Finish DBMS unit 3, 50:00 left$/);
assert.equal($('#horizon').dataset.mode, 'focus');
assert.equal($('#nt-actions button').textContent, 'Pause');

// quick note with N
key('n'); await tick();
assert.equal($('#nt-note').hidden, false);
const note = $('#nt-note-input');
note.value = 'Lossless join needs a common key';
key('Enter', note); await tick(80);
assert.equal(mock.store.planner.notes.length, 1);
assert.equal(mock.store.planner.notes[0].session, String(mock.store.timer.focusStartedAt), 'note tied to this session');
assert.equal($('#nt-note').hidden, true);

// search uses the default engine
$('#search-input').value = 'bcnf example';
$('#search').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
assert.deepEqual(searches, [{ text: 'bcnf example', disposition: 'CURRENT_TAB' }]);

// ---- burst into Study, then back with Escape ----
document.activeElement.blur && document.activeElement.blur();
key('s'); await tick(120);
assert.equal($('#shell').hidden, false);
assert.equal($('#idle').hidden, true);
assert.ok($('.daily-input'), 'side panel Focus view mounted full page');
assert.equal($('.daily-input').value, 'Finish DBMS unit 3', 'daily focus shared with the panel view');
assert.equal($$('.note-list li').length, 1, 'session note visible in the Focus view');
// add a task from the full-page Focus view
const taskInput = $('.tasks input[type="text"]');
taskInput.value = 'Solve PYQs';
taskInput.dispatchEvent(new dom.window.Event('input'));
$('.tasks form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
await tick(80);
assert.equal(mock.store.planner.tasks[0].title, 'Solve PYQs');
document.activeElement.blur && document.activeElement.blur();
key('Escape'); await tick(80);
assert.equal($('#idle').hidden, false);
assert.equal($('#shell').hidden, true);
byText('#nt-modes button', 'ResearchR').click(); await tick(120);
assert.equal($('#subnav').textContent, 'SourcesAskSessionsBibliography');
$('#btn-home').click(); await tick(80);

// ---- celebration when the session completes ----
const now = Date.now();
await chrome.storage.local.set({ timer: { ...mock.store.timer, endsAt: now - 1 } });
await mock.fire.alarm('oris-phase-end');
await tick(120);
assert.equal(mock.store.timer.phase, 'short');
assert.ok($('.idle-main .celebrate'), 'celebration shown on the idle screen');
assert.match($('.celebrate-label').textContent, /Session complete\. 1 today\./);
assert.equal(mock.rules.length, 1, 'Focus + breaks keeps blocking during the break');

// ---- dock ----
byText('.dock-btn', 'Calculator').click(); await tick();
const calc = $('.calc-in');
calc.value = '2400*18%';
calc.dispatchEvent(new dom.window.Event('input'));
assert.equal($('.calc-out').textContent, '= 432');
key('Enter', calc); await tick();
assert.equal($('.calc-hist li').textContent, '2400*18% = 432');
byText('.dock-btn', 'Stopwatch').click(); await tick();
byText('.dock-pop button', 'Start').click(); await tick(60);
assert.equal(mock.store['ui:stopwatch'].running, true);
assert.ok($('.dock-pop'), 'popover stays open after clicking inside it');
byText('.dock-pop button', 'Pause').click(); await tick(60);
assert.equal(mock.store['ui:stopwatch'].running, false);
$('.dock-btn[aria-label="Edit dock"]').click(); await tick();
const [nameIn, urlIn] = $$('.dock-add input');
nameIn.value = 'NPTEL'; nameIn.dispatchEvent(new dom.window.Event('input'));
urlIn.value = 'nptel.ac.in'; urlIn.dispatchEvent(new dom.window.Event('input'));
$('.dock-add').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
await tick(80);
assert.equal(mock.store.planner.dock.links[0].url, 'https://nptel.ac.in/');
assert.ok($$('a.dock-btn').some((a) => a.textContent.includes('NPTEL')), 'pinned link in the dock');
document.body.click(); await tick();
assert.equal($('.dock-pop'), null, 'click outside closes the popover');

assert.equal(/\bnull\b/.test(document.body.textContent), false, 'no stray "null" text on the page');
assert.deepEqual(errors, [], 'no runtime errors');
console.log('new tab: onboarding, idle, hotkeys, burst, notes, celebration, dock: all assertions passed');
process.exit(0);

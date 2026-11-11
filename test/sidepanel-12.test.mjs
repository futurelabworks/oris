// Side panel 1.2: tasks tied to sessions, notes, quick-note shortcut, backup restore, Focus + breaks.
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

const mock = createChrome();
globalThis.chrome = mock.chrome;
mock.commandList[2].shortcut = ''; // quick-note key taken by another extension
let now = Date.now();
const RealDate = Date;
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } };

await import('../background.js');
await mock.fire.installed();
await tick();
await import('../sidepanel/app.js');
await tick(60);
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const byText = (sel, text) => $$(sel).find((b) => b.textContent.trim() === text);

// shortcut notice: one key missing
assert.match($('.notice').textContent, /A shortcut isn’t set in Chrome: write a quick note\./);
byText('.notice button', 'Set shortcuts').click();
await tick();
assert.equal(mock.tabs.at(-1).url, 'chrome://extensions/shortcuts');
byText('.notice button', 'Dismiss').click();
await tick();
assert.equal($('.notice').hidden, true);

// add two tasks
for (const t of ['Revise normalization', 'Solve PYQs']) {
  const input = $('.tasks input[type="text"]');
  input.value = t;
  input.dispatchEvent(new dom.window.Event('input'));
  $('.tasks form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await tick(60);
  document.activeElement.blur();
  await tick();
}
assert.equal(mock.store.planner.tasks.length, 2);
assert.equal($$('.task').length, 2);
assert.equal($$('.task-picker .chip').length, 2, 'tasks offered under the timer');

// pick the second task, start, complete -> task gets the session
byText('.task-picker .chip', 'Solve PYQs').click();
await tick();
assert.equal($('.task-input').value, 'Solve PYQs');
byText('.controls button', 'Start focus').click();
await tick(80);
const taskId = mock.store.planner.tasks[1].id;
assert.equal(mock.store.timer.taskId, taskId);
assert.ok($('.task.current'), 'current task highlighted');
assert.equal($('.task-picker').hidden, true, 'picker hidden while running');
// note during the session
const note = $('.notes-panel textarea');
note.value = 'Check 3NF vs BCNF examples';
note.dispatchEvent(new dom.window.Event('input'));
note.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
await tick(80);
assert.equal(mock.store.planner.notes[0].task, 'Solve PYQs');
assert.equal($('.notes-panel h2').textContent, 'Notes for this session');
note.blur();
now += 25 * 60000;
await mock.fire.alarm('oris-phase-end');
await tick(120);
const t = mock.store.planner.tasks.find((x) => x.id === taskId);
assert.equal(t.sessions, 1, 'completed session logged on the task');
assert.equal(t.focusMs, 25 * 60000);
assert.ok($('.timer-card .celebrate'), 'celebration in the timer card');
assert.match($('.task-time').textContent, /25m/);
// tick a task off
$$('.task input[type="checkbox"]')[0].click();
await tick(60);
assert.equal(mock.store.planner.tasks[0].done, true);

// daily focus line
const daily = $('.daily-input');
daily.value = 'Finish DBMS';
daily.dispatchEvent(new dom.window.Event('change'));
await tick(60);
assert.equal(mock.store.planner.daily.text, 'Finish DBMS');

// ---- quick-note shortcut opens Focus with the note box focused ----
byText('.modes button', 'Research').click();
await tick(60);
await mock.fire.command('quick-note', { id: 1, windowId: 1 });
await tick(120);
assert.ok($('.notes-panel'), 'back on the Focus view');
assert.equal(document.activeElement, $('.notes-panel textarea'), 'note box focused');

// ---- Focus + breaks in the blocker ----
byText('#subnav button', 'Blocker').click();
await tick();
byText('.segmented button', 'Focus + breaks').click();
await tick(60);
assert.equal(mock.store.settings.blockMode, 'session');
assert.equal(mock.rules.length, 1, 'still in the break -> blocking now');
assert.match($('.panel .hint').textContent, /through focus and breaks/);

// ---- restore a backup ----
$('#btn-settings').click();
await tick();
assert.equal($$('.shortcut-list li').length, 3);
assert.equal($$('.shortcut-missing').length, 1, 'missing shortcut flagged in Settings');
assert.ok($$('.shortcut-list kbd').some((k) => k.textContent === 'Alt+Shift+O'));
byText('.segmented button', 'Low').click();
await tick();
assert.equal(mock.store.settings.animation, 'low');
const file = new dom.window.File([JSON.stringify({ app: 'oris', exportedAt: '2026-10-01T10:00:00Z', data: {
  settings: { focusMin: 40, blockMode: 'focus' },
  planner: { tasks: [{ id: 'z', title: 'From backup', done: false, createdAt: 1 }] },
  stats: { days: { '2026-09-30': { focusMs: 600000, sessions: 1 } } },
} })], 'oris-backup.json', { type: 'application/json' });
const input = $('input[type="file"]');
Object.defineProperty(input, 'files', { value: [file], configurable: true });
input.dispatchEvent(new dom.window.Event('change'));
await tick(80);
assert.match($('.restore').textContent, /0 sources, 0 syllabi, 1 tasks, 1 days of focus stats/);
byText('.restore button', 'Replace my data').click();
await tick(80);
assert.equal(mock.store.settings.focusMin, 40);
assert.equal(mock.store.planner.tasks[0].title, 'From backup');
assert.equal(mock.store.timer.phase, 'short', 'running timer untouched by restore');
assert.equal($('.restore').hidden, true);

assert.equal(/\bnull\b/.test(document.body.textContent), false, 'no stray "null" text on the page');
assert.deepEqual(errors, [], 'no runtime errors');
console.log('side panel 1.2: tasks, notes, quick note, blocking level, restore: all assertions passed');
process.exit(0);

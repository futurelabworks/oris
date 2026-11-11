// 3.0: New Tab first run leads straight into the study setup.
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

await import('../sidepanel/app.js');
await import('../newtab/newtab.js');
await tick(80);
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const byText = (sel, text) => $$(sel).find((b) => b.textContent.trim() === text);
const key = (k, target = document.body) => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true }));

byText('.ob-option', 'Learning for exams or courses').click(); await tick();
byText('.ob-option', 'In fixed time blocks').click(); await tick();
byText('.ob-option', 'About 25 minutes').click(); await tick();
assert.equal($('.ob-card h2').textContent, 'Oris is ready');
assert.match($('.ob-next').textContent, /Next: your study plan/);
assert.ok(byText('.ob-card button', 'Show me around'), 'old buttons still there');
assert.ok(byText('.ob-card button', 'Start using Oris'));
byText('.ob-card button', 'Set up my study plan').click();
await tick(800);
assert.equal(mock.store.settings.onboarded, true, 'timer answers saved');
assert.equal(mock.store.settings.focusMin, 25);
assert.equal($('#onboarding').hidden, true);
assert.equal($('#shell').hidden, false, 'full-screen app opened');
assert.match($('.setup-head').textContent, /Step 1 of 6/);
assert.ok([...document.querySelectorAll('.field span')].some((s) => s.textContent === 'Your name'), 'asks for the name first');
assert.deepEqual(errors, [], 'no runtime errors');
console.log('new tab 3.0: first run → study setup: all assertions passed');
process.exit(0);

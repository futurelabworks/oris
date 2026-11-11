// 2.2 Exam prep end to end in the side panel, plus checks that the old syllabus flow is untouched.
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
for (const k of ['window', 'document', 'Node', 'HTMLElement', 'Event', 'CustomEvent', 'KeyboardEvent', 'localStorage', 'navigator', 'DOMParser', 'File']) {
  Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true });
}
globalThis.scrollTo = () => {};
dom.window.scrollTo = () => {};
dom.window.HTMLElement.prototype.scrollIntoView = () => {};

const aiCalls = [];
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.includes('oris-ai')) {
    const body = JSON.parse(opts.body);
    aiCalls.push(body);
    if (body.task === 'practice') {
      const mcq = body.messages[0].content.includes('multiple-choice');
      const questions = mcq
        ? [{ q: 'Which property ensures all-or-nothing?', options: ['Atomicity', 'Consistency', 'Isolation', 'Durability'], answer: 'A', explain: 'Atomicity.', level: 'easy' }]
        : [{ q: 'Explain the ACID properties with examples.', answer: '- Atomicity\n- Consistency\n- Isolation\n- Durability', level: 'medium', marks: 10 }];
      return new Response(JSON.stringify({ content: JSON.stringify({ questions }) }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: 'Oris AI is busy. Try again in a minute.' }), { status: 429 });
  }
  return new Response('nope', { status: 404 });
};

const mock = createChrome();
globalThis.chrome = mock.chrome;
await import('../background.js');
await mock.fire.installed();
await tick();
await chrome.storage.local.set({ settings: { ...mock.store.settings, cloudAI: false } }); // rules first
await import('../sidepanel/app.js');
await tick(60);
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const byText = (sel, text) => $$(sel).find((b) => b.textContent.trim() === text);
const type = (input, value) => { input.value = value; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
const pick = (select, value) => { select.value = value; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); };
const syl = () => mock.store.syllabi[0];
const tab = (name) => $$('.syl-tabs button').find((b) => b.textContent.startsWith(name));

// ---- old flow: add a syllabus exactly like before ----
byText('#subnav button', 'Syllabus').click();
await tick();
byText('button', 'Add syllabus').click();
await tick();
type($('.add-form input[type="text"]'), 'DBMS');
type($('.add-form textarea'), 'UNIT 1: Transactions\nACID properties\nSerializability\nDeadlock\nUNIT 2: Storage\nB+ tree indexing\nHashing');
$('.add-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
await tick(80);
assert.equal(syl().units.length, 2);
assert.equal(syl().units[0].topics.length, 3);
assert.ok($('.topic-row a.btn').href.startsWith('https://www.youtube.com/results?search_query='), 'YouTube link still first in the row');
assert.equal($$('.syl-tabs button').map((b) => b.textContent).join('|'), 'Topics|Exam prep');
assert.ok(byText('.topic-row button', 'Exam'), 'Exam button on each topic');

// ---- Exam prep: paste a paper (rules) ----
tab('Exam prep').click();
await tick();
assert.match(document.body.textContent, /Upload previous-year question papers/);
assert.ok($('.section-head a.linkish').href.startsWith('https://www.google.com/search?q=DBMS%20previous%20year'), 'Find papers online');
$('.paste-paper').open = true;
type($('.paste-paper input[placeholder="2024"]'), '2023');
type($('.paste-paper textarea'), `Q1. (a) Explain ACID properties of a transaction. [5]
(b) What is conflict serializability? Explain with an example. [5]
Q2. Explain B+ tree indexing with insertion example. (10)
Q3. Discuss the history of the Mughal empire in detail. (10)`);
byText('button', 'Read paper').click();
await tick(120);
assert.equal(syl().papers.length, 1);
assert.equal(syl().papers[0].year, '2023');
assert.equal(syl().pyqs.length, 4);
assert.equal(syl().pyqs.filter((q) => q.topicId).length, 3);
assert.match(document.body.textContent, /Most asked topics/);
assert.match(document.body.textContent, /Study these first/);
assert.match(document.body.textContent, /Not matched \(1\)/);

// ---- upload a second paper as a file ----
const file = new File([`Q1. Explain deadlock prevention and avoidance. [10]\nQ2. Explain ACID properties. [5]\nQ3. Explain extendible hashing. [5]`], 'dbms-may-2024.txt', { type: 'text/plain' });
const input = $('.small-drop input[type="file"]');
Object.defineProperty(input, 'files', { value: [file], configurable: true });
input.dispatchEvent(new dom.window.Event('change'));
await tick(150);
assert.equal(syl().papers.length, 2);
assert.equal(syl().papers[1].year, '2024', 'year from file name');
const acid = syl().units[0].topics[0];
assert.equal(syl().pyqs.filter((q) => q.topicId === acid.id).length, 2);
assert.match($('.asked-list li .asked-title').textContent, /ACID properties/, 'most asked first');
assert.equal($('.asked-list li .asked-num').textContent, '2/2');

// reassign the unmatched question
const stray = syl().pyqs.find((q) => !q.topicId);
const sel = $$('.pyq-move').find((s) => s.closest('section').textContent.includes('Not matched'));
pick(sel, syl().units[0].topics[2].id);
await tick(60);
assert.equal(syl().pyqs.find((q) => q.id === stray.id).topicId, syl().units[0].topics[2].id);
assert.equal(syl().pyqs.find((q) => q.id === stray.id).how, 'manual');
assert.doesNotMatch(document.body.textContent, /Not matched \(/);

// focus from priority
byText('.prio-list button', 'Focus').click();
await tick(60);
assert.equal(mock.store.timer.status, 'running');
assert.match(mock.store.timer.task, /^DBMS: /);
await chrome.runtime.sendMessage({ type: 'timer:stop' });

// ---- Topics tab: chips + topic exam panel ----
tab('Topics').click();
await tick();
assert.equal($('.chip-asked').textContent, 'Asked 2/2');
assert.ok($('.chip-asked').classList.contains('hot'));
byText('.topic-row button', 'Exam (2)').click();
await tick();
assert.match($('.exam-panel').textContent, /Past questions \(2\)/);
assert.ok($('.exam-panel a.linkish').href.includes('google.com/search'), 'Find PYQs online');
assert.ok(byText('.exam-panel button', 'Practice questions').disabled, 'practice needs AI');
assert.match($('.exam-panel').textContent, /Turn on Oris AI/);

// ---- practice with AI (competitive -> MCQ) ----
await chrome.storage.local.set({ settings: { ...mock.store.settings, cloudAI: true } });
await tick(60);
byText('.exam-panel button', 'Practice questions').click();
await tick(120);
assert.equal(aiCalls.at(-1).task, 'practice');
assert.equal(syl().units[0].topics[0].practice.length, 1);
assert.ok(!syl().units[0].topics[0].practice[0].options, 'university: written question');
byText('.exam-panel button', 'Show answer').click();
await tick();
assert.match($('.answer-outline').textContent, /Atomicity/);
tab('Exam prep').click();
await tick();
pick($('.exam-type select'), 'competitive');
await tick(60);
assert.equal(syl().examType, 'competitive');
tab('Topics').click();
await tick();
byText('.exam-panel button', 'More questions').click();
await tick(120);
const mcq = syl().units[0].topics[0].practice.find((p) => p.options);
assert.equal(mcq.answer, 'Atomicity');

// ---- mock test ----
tab('Exam prep').click();
await tick();
const selects = $$('.panel select').filter((s) => s.closest('section').querySelector('h2')?.textContent === 'Mock test');
pick(selects[1], 'all');
await tick();
pick(selects.find((s) => s.closest('label').textContent.startsWith('Number')) || $$('.panel select').find((s) => s.closest('label')?.textContent.startsWith('Number')), '5');
await tick();
assert.match(document.body.textContent, /\d+ questions? available/);
byText('button', 'Start mock test').click();
await tick(80);
assert.ok(syl().mock, 'mock saved so it survives closing the panel');
assert.equal(syl().mock.items.length, 5);
assert.ok($('.mock-clock'));
assert.match($('.syl-tabs').textContent, /test running/);
assert.equal(/\bnull\b|\bundefined\b/.test(document.body.textContent), false, 'no stray null while the test runs');
const radio = $$('.mcq-choices input').find((r) => r.value === 'Atomicity');
if (radio) { radio.checked = true; radio.dispatchEvent(new dom.window.Event('change')); }
byText('button', 'Finish and mark').click();
await tick();
assert.match(document.body.textContent, /Mark your answers/);
assert.ok(byText('button', 'Mark all 5 questions to save') || byText('button', 'Save result'));
for (const seg of $$('.mark-box .segmented')) seg.querySelectorAll('button')[2].click(); // Missed
await tick();
byText('button', 'Save result').click();
await tick(80);
assert.equal(syl().mock, undefined);
assert.equal(syl().mocks.length, 1);
assert.equal(syl().mocks[0].total, 5);
assert.ok(syl().units.some((u) => u.topics.some((t) => t.revise)), 'missed topics flagged');
assert.match(document.body.textContent, /Recent results/);
tab('Topics').click();
await tick();
assert.ok($('.chip-revise'), 'Revise chip in topics');

// ---- remove a paper (two taps) ----
tab('Exam prep').click();
await tick();
const n = syl().pyqs.length;
$('.paper-list .icon-btn').click();
await tick();
assert.equal(syl().papers.length, 2, 'first tap only arms');
byText('.paper-list button', 'Remove?').click();
await tick(60);
assert.equal(syl().papers.length, 1);
assert.ok(syl().pyqs.length < n);

// ---- list card + delete still work ----
byText('button', '‹ All syllabi').click();
await tick();
assert.match($('.syl-card').textContent, /1 past paper/);
$('.syl-card').click();
await tick();
assert.equal($('.syl-tabs button.active').textContent, 'Topics', 'opens on Topics');
byText('.section-head button', 'Delete').click();
await tick();
byText('.section-head button', 'Tap again to delete').click();
await tick();
assert.equal(mock.store.syllabi.length, 0);

assert.equal(/\bnull\b|\bundefined\b|NaN/.test(document.body.textContent), false, 'no stray null/undefined/NaN');
assert.deepEqual(errors, [], 'no runtime errors');
console.log('exam prep UI: papers, upload, most asked, priority, reassign, practice, MCQ, mock test, revise: all assertions passed');
process.exit(0);

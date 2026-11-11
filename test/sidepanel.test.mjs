// Renders the real side panel in jsdom (with the real background.js behind the chrome mock)
// and clicks through every view to catch runtime errors.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { createChrome } from './chrome-mock.mjs';

const html = fs.readFileSync(new URL('../sidepanel/sidepanel.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/sidepanel/sidepanel.html', pretendToBeVisual: true });
const errors = [];
dom.window.addEventListener('error', (e) => errors.push(e.error || e.message));
process.on('unhandledRejection', (e) => errors.push(e));

for (const k of ['window', 'document', 'Node', 'HTMLElement', 'Event', 'CustomEvent', 'localStorage', 'navigator']) {
  Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true });
}
globalThis.scrollTo = () => {};
dom.window.scrollTo = () => {};
globalThis.structuredClone ??= (v) => JSON.parse(JSON.stringify(v));

const mock = createChrome();
globalThis.chrome = mock.chrome;

// Fake YouTube API
const fetchLog = [];
globalThis.fetch = async (url) => {
  fetchLog.push(String(url));
  const u = new URL(url);
  if (u.pathname.endsWith('/search')) {
    return new Response(JSON.stringify({ items: [{ id: { videoId: 'aaa111' } }, { id: { videoId: 'bbb222' } }, { id: { videoId: 'short1' } }] }), { status: 200 });
  }
  if (u.pathname.endsWith('/videos')) {
    const v = (id, dur, views, title) => ({ id, snippet: { title, channelTitle: 'Gate Smashers', liveBroadcastContent: 'none', thumbnails: { medium: { url: 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg' } } }, contentDetails: { duration: dur }, statistics: { viewCount: String(views), likeCount: String(views / 30) } });
    return new Response(JSON.stringify({ items: [v('aaa111', 'PT12M30S', 900000, 'Normalization in DBMS'), v('bbb222', 'PT1H5M', 50000, 'BCNF full lecture'), v('short1', 'PT45S', 9e6, '#shorts')] }), { status: 200 });
  }
  return new Response('{}', { status: 404 });
};

await import('../background.js');
await mock.fire.installed();
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
await tick();

await import('../sidepanel/app.js');
await tick();
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const byText = (sel, text) => $$(sel).find((b) => b.textContent.trim() === text);

// Focus view
assert.equal($('.clock').textContent, '25:00');
document.querySelector('.task-input').value = 'Physics numericals';
byText('.controls button', 'Start focus').click();
await tick();
assert.equal(mock.store.timer.status, 'running');
assert.ok(byText('.controls button', 'Pause'), 'pause shown when running');
assert.equal(mock.rules.length, 1);
byText('.controls button', 'Pause').click();
await tick();
assert.ok(byText('.controls button', 'Resume'));
byText('.controls button', 'Stop').click();
await tick();
assert.equal(mock.store.timer.status, 'idle');

byText('.chip', '50 / 10').click();
await tick();
assert.equal(mock.store.settings.focusMin, 50);
assert.equal($('.clock').textContent, '50:00');
byText('.chip', 'Custom').click();
await tick();
assert.ok(!$('.custom-len').hidden);

// Blocker view
byText('#subnav button', 'Blocker').click();
await tick();
const input = $('.add-row input');
input.value = 'https://www.YouTube.com/shorts/abc';
input.dispatchEvent(new dom.window.Event('input'));
$('.add-row').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
await tick();
assert.ok(mock.store.settings.blocklist.includes('youtube.com'), 'domain normalised and added');
byText('.chip', '+ Shopping').click();
await tick();
assert.ok(mock.store.settings.blocklist.includes('flipkart.com'));
byText('.segmented button', 'Always').click();
await tick();
assert.equal(mock.store.settings.blockMode, 'always');
assert.equal(mock.rules.length, 1, 'always mode adds rule immediately');
const ytShorts = $$('.toggle').find((l) => l.textContent.includes('Hide Shorts')).querySelector('input');
ytShorts.click();
await tick();
assert.equal(mock.store.settings.distractions.ytShorts, false);
$$('.domain-list button').find((b) => b.getAttribute('aria-label') === 'Remove youtube.com').click();
await tick();
assert.ok(!mock.store.settings.blocklist.includes('youtube.com'));

// Syllabus view: paste text, parse with rules, find videos
byText('#subnav button', 'Syllabus').click();
await tick();
byText('button', 'Add syllabus').click();
await tick();
const name = $('.add-form input[type="text"]');
name.value = 'DBMS';
name.dispatchEvent(new dom.window.Event('input'));
const ta = $('.add-form textarea');
ta.value = 'UNIT 1: Introduction\nDatabase users, data models\nUNIT 2: Normalization\nFunctional dependencies; BCNF';
ta.dispatchEvent(new dom.window.Event('input'));
$('.add-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
await tick(80);
assert.equal(mock.store.syllabi.length, 1);
assert.equal(mock.store.syllabi[0].units.length, 2);
assert.equal(mock.store.syllabi[0].name, 'DBMS');
assert.ok($$('.topic').length >= 2, 'topics rendered for open unit');
assert.ok($('.topic-row a.btn').href.startsWith('https://www.youtube.com/results?search_query='), 'no key -> search link');

// Add YouTube key, then find videos
await chrome.storage.local.set({ settings: { ...mock.store.settings, youtubeKey: 'AIzaTEST' } });
await tick();
byText('.topic-row button', 'Find videos').click();
await tick(80);
const topic = mock.store.syllabi[0].units[0].topics[0];
assert.equal(topic.videos.length, 2, 'shorts filtered out');
assert.ok($$('.video').length === 2, 'videos rendered');
assert.ok(fetchLog.some((u) => u.includes('q=Database+users+DBMS') || u.includes('q=Database%20users%20DBMS')), 'subject added to query');
$('.video .watched-box input').click();
await tick();
assert.equal(mock.store.syllabi[0].units[0].topics[0].videos.filter((v) => v.watched).length, 1);
$('.topic-check input').click();
await tick();
assert.equal(mock.store.syllabi[0].units[0].topics[0].done, true);

// Find all (with confirm)
byText('.syl-head button', `Find videos for all 3 topics`).click();
await tick();
assert.ok($('.batch.confirm'));
byText('.batch button', 'Find videos').click();
await tick(200);
assert.ok(mock.store.syllabi[0].units.every((u) => u.topics.every((t) => t.videos)), 'all topics fetched');

// Back to list, then delete
byText('button', '‹ All syllabi').click();
await tick();
assert.ok($('.syl-card').textContent.includes('1 of 4 topics done'));
$('.syl-card').click();
await tick();
byText('.section-head button', 'Delete').click();
await tick();
byText('.section-head button', 'Tap again to delete').click();
await tick();
assert.equal(mock.store.syllabi.length, 0);

// Settings + soon views
$('#btn-settings').click();
await tick();
assert.ok($('.page-title').textContent === 'Settings');
assert.equal($$('#subnav')[0].hidden, true);
byText('.modes button', 'Earn').click();
await tick();
assert.equal($('#subnav').textContent, 'OverviewWorkJobsSkillsRewards', 'Earn mode has its tools');
byText('.modes button', 'Study').click();
await tick();
assert.ok(!$('#subnav').hidden);

assert.deepEqual(errors, [], 'no runtime errors');
console.log('side panel: all assertions passed');
process.exit(0);

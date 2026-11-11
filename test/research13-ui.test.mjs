// Research 1.3 end to end: Research this page, DOI, tags, summary length, Ask, Markdown export.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { createChrome } from './chrome-mock.mjs';
import { pageExtractor } from '../lib/extract.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const paras = (topic, n) => Array.from({ length: n }, (_, i) => `<p>Section ${i}: ${topic} The monsoon onset over Kerala usually happens in the first week of June, and scientists measure it with rainfall and wind thresholds across fourteen stations.</p>`).join('');
const articleHtml = `<html><head><title>Monsoon onset study | Journal of Hydrology</title>
<meta name="citation_title" content="Shifts in monsoon onset over Kerala"><meta name="citation_author" content="Priya Nair">
<meta name="citation_doi" content="10.1016/j.jhydrol.2021.126421"><meta name="citation_journal_title" content="Journal of Hydrology">
<meta name="citation_publication_date" content="2021-05-03"></head><body><article>${paras('Onset dates have moved later by about a week since 1980.', 8)}</article></body></html>`;
const article = new JSDOM(articleHtml, { url: 'https://www.sciencedirect.com/science/article/pii/S0022', runScripts: 'outside-only' });

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
const downloads = [];
dom.window.HTMLAnchorElement.prototype.click = function () { if (this.download) downloads.push({ name: this.download, href: this.href }); };
const blobs = new Map();
globalThis.URL.createObjectURL = (b) => { const id = 'blob:' + blobs.size; blobs.set(id, b); return id; };
globalThis.URL.revokeObjectURL = () => {};

// Network: Groq for summaries and Ask; one old page fetched for indexing.
const groqCalls = [];
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.includes('api.groq.com')) {
    const body = JSON.parse(opts.body);
    groqCalls.push(body);
    const user = body.messages[1].content;
    const content = user.includes('Question:')
      ? JSON.stringify({ answer: 'Onset now comes about a week later than in 1980 [1]. It is measured with rainfall and wind thresholds [2].', found: true })
      : JSON.stringify({ summary: 'Monsoon onset over Kerala is shifting later.', points: ['About a week later since 1980'] });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }
  if (url === 'https://old.example.org/el-nino') {
    return new Response(`<html><head><title>El Nino explained</title></head><body><article>${'<p>El Nino years usually bring weaker monsoon rainfall to India because warm Pacific waters shift the rising air away from the subcontinent.</p>'.repeat(4)}</article></body></html>`, { status: 200 });
  }
  return new Response('not found', { status: 404 });
};

const mock = createChrome();
globalThis.chrome = mock.chrome;
mock.tabs.push({ id: 7, windowId: 1, active: true, url: article.window.location.href, title: 'Monsoon onset study | Journal of Hydrology' });
mock.setScriptHandler(({ target, func, args }) => {
  if (target.tabId !== 7) return new Error('Cannot access contents of the page');
  if (func === pageExtractor || func.name === 'pageExtractor') return pageExtractor(args[0], article.window.document);
  return undefined;
});

await import('../background.js');
await mock.fire.installed();
await tick();
await import('../sidepanel/app.js');
await tick(60);
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const byText = (sel, text) => $$(sel).find((b) => b.textContent.trim() === text);

byText('.modes button', 'Research').click();
await tick(80);
assert.equal($('#subnav').textContent, 'SourcesAskSessionsBibliography');

// ---- Research this page, no Groq key: key sentences, TL;DR length ----
byText('.small-seg button', 'TL;DR').click();
await tick();
assert.equal(mock.store.settings.summaryLength, 'short');
byText('.current button', 'Research this page').click();
await tick(200);
let src = mock.store.research.sources[0];
assert.equal(src.title, 'Shifts in monsoon onset over Kerala');
assert.equal(src.doi, '10.1016/j.jhydrol.2021.126421', 'DOI read from the page');
assert.equal(src.hasText, true);
assert.ok(mock.store['rtext:' + src.id].includes('Onset dates have moved later'), 'page text kept for Ask');
assert.equal(src.summary.points.length, 2, 'TL;DR = 2 key sentences without AI');
assert.equal(src.summary.length, 'short');
assert.match($('.cite-ready .citation').textContent, /^Nair, P\. \(2021, May 3\)\. Shifts in monsoon onset over Kerala\. Journal of Hydrology\. https:\/\/doi\.org\/10\.1016\/j\.jhydrol\.2021\.126421$/, 'citation uses the DOI');
assert.ok(byText('.cite-ready button', 'Copy citation'));

// ---- tags ----
$('.source-card').click();
await tick();
assert.ok($('.doi-link').href.endsWith('10.1016/j.jhydrol.2021.126421'));
const tagIn = $('.tag-input');
tagIn.focus();
tagIn.value = 'Kerala, onset';
tagIn.dispatchEvent(new dom.window.Event('input'));
tagIn.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
await tick(80);
assert.deepEqual(mock.store.research.sources[0].tags, ['kerala', 'onset']);
assert.equal($$('.tag-editor .tag').length, 2, 'tags shown right away');
assert.equal(document.activeElement, $('.tag-input'), 'cursor stays in the tag box');
$('.tag-x').click();
await tick(60);
assert.deepEqual(mock.store.research.sources[0].tags, ['onset']);
// Chicago
byText('.segmented button', 'Chicago').click();
await tick();
assert.match($('.citation').textContent, /^Nair, Priya\. “Shifts in monsoon onset over Kerala\.” Journal of Hydrology\. May 3, 2021\. https:\/\/doi\.org\//);
byText('button', '‹ Sources').click();
await tick();
assert.equal(byText('.tag-filter .chip', '#onset').textContent, '#onset');

// an older source with no stored text, tagged differently
await chrome.runtime.sendMessage({ type: 'research:op', op: 'saveSource', args: { url: 'https://old.example.org/el-nino', meta: { title: 'El Nino explained', siteName: 'Old Example' } } });
await tick(60);
const old = mock.store.research.sources.find((s) => s.title === 'El Nino explained');
await chrome.runtime.sendMessage({ type: 'research:op', op: 'updateSource', args: { id: old.id, patch: { tags: ['enso'] } } });
await tick(60);
byText('.tag-filter .chip', '#enso').click();
await tick();
assert.equal($$('.source-card').length, 1);
assert.match($('.source-card').textContent, /El Nino explained/);
byText('.tag-filter .chip', 'All').click();
await tick();
assert.equal($$('.source-card').length, 2);

// ---- Ask without a key: best passages ----
byText('#subnav button', 'Ask').click();
await tick();
assert.match($('.index-note').textContent, /1 source was saved before Ask existed/);
const q = $('.ask-form textarea');
q.value = 'When does the monsoon onset happen over Kerala?';
q.dispatchEvent(new dom.window.Event('input'));
$('.ask-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
await tick(120);
assert.equal($('.passages-head').textContent, 'Best matching passages');
assert.match($$('.passage')[0].textContent, /Shifts in monsoon onset over Kerala/);
assert.equal(groqCalls.length, 0, 'no AI call without a key');

// read the old page so Ask can search it
byText('.index-note button', 'Read that page').click();
await tick(200);
assert.equal(mock.store.research.sources.find((s) => s.id === old.id).hasText, true);
assert.equal($('.index-note'), null);

// ---- Ask with a key: written answer with citations ----
await chrome.storage.local.set({ settings: { ...mock.store.settings, groqKey: 'gsk_test' } });
await tick(60);
const q2 = $('.ask-form textarea');
q2.value = 'How has the monsoon onset changed and how is it measured?';
q2.dispatchEvent(new dom.window.Event('input'));
$('.ask-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
await tick(150);
assert.match($('.answer').textContent, /^Onset now comes about a week later than in 1980 1\. It is measured/);
assert.equal($$('.answer .cite-chip').length, 2);
assert.equal($('.passages-head').textContent, 'Passages used');
const askCall = groqCalls.at(-1);
assert.match(askCall.messages[0].content, /ONLY the numbered passages/);
assert.match(askCall.messages[1].content, /\[1\] From "Shifts in monsoon onset over Kerala"/);

// ---- Markdown export ----
byText('#subnav button', 'Bibliography').click();
await tick();
assert.equal($('.bib h3').textContent, 'Bibliography', 'Chicago heading');
byText('button', 'Export project (.md)').click();
await tick();
const md = downloads.at(-1);
assert.equal(md.name, 'my-research.md');
const mdText = await blobs.get(md.href).text();
assert.match(mdText, /^# My research\n/);
assert.match(mdText, /\*\*DOI:\*\* \[10\.1016/);
assert.match(mdText, /\*\*Tags:\*\* #onset/);
assert.match(mdText, /## Bibliography \(Chicago\)/);

// ---- deleting a source deletes its stored text ----
const keyOld = 'rtext:' + old.id;
assert.ok(mock.store[keyOld]);
await chrome.runtime.sendMessage({ type: 'research:op', op: 'deleteSource', args: { id: old.id } });
await tick(60);
assert.equal(mock.store[keyOld], undefined, 'page text removed with its source');

assert.equal(/\bnull\b|\bundefined\b/.test(document.body.textContent), false, 'no stray null/undefined text');
assert.deepEqual(errors, [], 'no runtime errors');
console.log('research 1.3 UI: Research this page, DOI, tags, Chicago, Ask, Markdown export: all assertions passed');
process.exit(0);

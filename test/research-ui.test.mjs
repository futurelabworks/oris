// Research mode end to end: real background.js + real side panel in jsdom, with a fake web page
// behind chrome.scripting, then the highlighter wired through the context menu.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { createChrome } from './chrome-mock.mjs';
import { pageExtractor } from '../lib/extract.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

// ----- the "web page" open in the active tab -----
const articleHtml = `<html><head><title>Monsoon patterns are shifting | The Hindu</title>
<meta property="og:title" content="Monsoon patterns are shifting">
<meta property="og:site_name" content="The Hindu">
<meta name="author" content="Ravi Kumar Sharma">
<meta property="article:published_time" content="2023-07-15T08:00:00+05:30">
</head><body><nav>Home News Sport</nav><article><h1>Monsoon patterns are shifting</h1>
${Array.from({ length: 8 }, (_, i) => `<p>Scientists say monsoon rainfall over India has become more erratic in recent decades, with longer dry spells and heavier bursts of rain in region ${i}. Farmers in Kerala and Assam report sowing delays as a result.</p>`).join('')}
</article><footer>Copyright</footer></body></html>`;
const article = new JSDOM(articleHtml, { url: 'https://www.thehindu.com/sci-tech/monsoon.ece', runScripts: 'outside-only' });
article.window.CSS = { escape: (s) => s };
const hlCode = fs.readFileSync(new URL('../content/highlighter.js', import.meta.url), 'utf8');

// ----- side panel DOM -----
const html = fs.readFileSync(new URL('../sidepanel/sidepanel.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/sidepanel/sidepanel.html', pretendToBeVisual: true });
const errors = [];
dom.window.addEventListener('error', (e) => errors.push(e.error || e.message));
process.on('unhandledRejection', (e) => errors.push(e));
for (const k of ['window', 'document', 'Node', 'HTMLElement', 'Event', 'CustomEvent', 'localStorage', 'navigator', 'DOMParser']) {
  Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true });
}
globalThis.scrollTo = () => {};
dom.window.scrollTo = () => {};
let clipboard = null;
Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: async (t) => { clipboard = t; }, write: async () => { throw new Error('no rich'); } }, configurable: true });
const downloads = [];
dom.window.HTMLAnchorElement.prototype.click = function () { if (this.download) downloads.push(this.download); };
globalThis.URL.createObjectURL = () => 'blob:x';
globalThis.URL.revokeObjectURL = () => {};

const mock = createChrome();
globalThis.chrome = mock.chrome;
mock.tabs.push(
  { id: 7, windowId: 1, active: true, url: 'https://www.thehindu.com/sci-tech/monsoon.ece?utm_source=tw', title: 'Monsoon patterns are shifting | The Hindu' },
  { id: 8, windowId: 1, active: false, url: 'https://en.wikipedia.org/wiki/Monsoon', title: 'Monsoon - Wikipedia' },
  { id: 9, windowId: 1, active: false, url: 'chrome://extensions/', title: 'Extensions' },
);
// chrome.scripting.executeScript runs against the fake article.
mock.setScriptHandler(({ target, func, files, args }) => {
  if (target.tabId !== 7) return new Error('Cannot access contents of the page');
  if (files) { article.window.eval(hlCode); return undefined; }
  if (func === pageExtractor || func.name === 'pageExtractor') return pageExtractor(args[0], article.window.document);
  // Other injected functions use window.__orisHL: run them inside the article window.
  article.window.__args = args;
  return article.window.eval(`(${func.toString()})(...window.__args)`);
});
article.window.chrome = { storage: { local: { get: (k) => mock.chrome.storage.local.get(k) }, onChanged: { addListener: (fn) => mock.chrome.storage.onChanged.addListener(fn) } } };

await import('../background.js');
await mock.fire.installed();
await tick();
assert.ok(mock.menus.some((m) => m.id === 'oris-highlight'), 'context menu created');
assert.ok(mock.store.research.projects.length === 1, 'research initialised');

await import('../sidepanel/app.js');
await tick();
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const byText = (sel, text) => $$(sel).find((b) => b.textContent.trim() === text);

// ----- Sources: current page card -----
byText('.modes button', 'Research').click();
await tick(80);
assert.equal($('#subnav').textContent, 'SourcesAskSessionsBibliography');
assert.equal($('.current-title').textContent, 'Monsoon patterns are shifting | The Hindu');
byText('.current button', 'Summarise').click();
await tick(120);
assert.ok($('.summary'), 'summary shown before saving');
assert.match($('.summary-label').textContent, /Key sentences/);
byText('.current button', 'Save only').click();
await tick(120);
let src = mock.store.research.sources[0];
assert.equal(src.title, 'Monsoon patterns are shifting');
assert.deepEqual(src.authors, ['Ravi Kumar Sharma']);
assert.equal(src.siteName, 'The Hindu');
assert.equal(src.published, '2023-07-15T08:00:00+05:30');
assert.ok(src.summary && src.summary.points.length >= 3, 'pending summary kept when saving');
assert.ok($('.saved-pill'), 'saved badge');
assert.equal($$('.source-card').length, 1);

// ----- Highlight via context menu (background + highlighter) -----
const p = article.window.document.querySelector('article p');
const range = article.window.document.createRange();
range.setStart(p.firstChild, 0);
range.setEnd(p.firstChild, 'Scientists say monsoon rainfall'.length);
article.window.getSelection().addRange(range);
await mock.fire.menu({ menuItemId: 'oris-highlight' }, mock.tabs[0]);
await tick(120);
src = mock.store.research.sources[0];
assert.equal(mock.store.research.sources.length, 1, 'highlight joined the saved source (utm stripped)');
assert.equal(src.highlights.length, 1);
assert.equal(src.highlights[0].text, 'Scientists say monsoon rainfall');
assert.equal(article.window.document.querySelectorAll('oris-hl').length, 1, 'painted on page');

// ----- Source detail -----
$('.source-card').click();
await tick();
assert.equal($('.source-head h2').textContent, 'Monsoon patterns are shifting');
assert.equal($$('.hl').length, 1);
// recolour from the panel -> page mark recolours through storage sync
$$('.swatch').find((b) => b.dataset.color === 'blue').click();
await tick(80);
assert.equal(mock.store.research.sources[0].highlights[0].color, 'blue');
assert.equal(article.window.document.querySelector('oris-hl').dataset.color, 'blue', 'page synced');
// show on page
byText('.hl button', 'Show on page').click();
await tick(80);
// note (debounced)
const note = $('.hl-note');
note.focus();
note.value = 'Use in intro';
note.dispatchEvent(new dom.window.Event('input'));
await tick(700);
assert.equal(mock.store.research.sources[0].highlights[0].note, 'Use in intro');
note.blur();
await tick();

// citation + style switch
assert.equal($('.citation').textContent, 'Sharma, R. K. (2023, July 15). Monsoon patterns are shifting. The Hindu. https://www.thehindu.com/sci-tech/monsoon.ece?utm_source=tw');
byText('.segmented button', 'MLA 9').click();
await tick();
assert.equal(mock.store.settings.citeStyle, 'mla');
assert.match($('.citation').textContent, /^Sharma, Ravi Kumar\. “Monsoon patterns are shifting\.” The Hindu, 15 July 2023/);
byText('button', 'Copy citation').click();
await tick();
assert.match(clipboard, /^Sharma, Ravi Kumar/);
// edit details
byText('button', 'Edit details').click();
await tick();
const form = $('.cite-form');
form.querySelector('textarea').value = 'Ravi Kumar Sharma\nAnita Rao';
form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
await tick(80);
assert.deepEqual(mock.store.research.sources[0].authors, ['Ravi Kumar Sharma', 'Anita Rao']);

// delete highlight -> unpainted on page
$('.hl .icon-btn').click();
await tick(80);
assert.equal(mock.store.research.sources[0].highlights.length, 0);
assert.equal(article.window.document.querySelectorAll('oris-hl').length, 0, 'page unpainted');

// ----- Projects -----
byText('button', '‹ Sources').click();
await tick();
byText('.project-bar button', 'New').click();
await tick();
$('.project-form input').value = 'Thesis';
$('.project-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
await tick(80);
assert.equal(mock.store.research.projects.length, 2);
assert.equal($$('.source-card').length, 0, 'new project starts empty');
assert.ok(byText('.current button', 'Research this page'), 'page not saved in this project');
$('.project-select').value = mock.store.research.projects[0].id;
$('.project-select').dispatchEvent(new dom.window.Event('change'));
await tick(80);
assert.equal($$('.source-card').length, 1);

// ----- Sessions -----
byText('#subnav button', 'Sessions').click();
await tick();
$('.panel form, form.panel').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
await tick(80);
const sess = mock.store.research.sessions[0];
assert.equal(sess.tabs.length, 2, 'chrome:// tab skipped');
byText('.session button', 'Open in new window').click();
await tick();
assert.deepEqual(mock.windowsCreated[0].url, ['https://www.thehindu.com/sci-tech/monsoon.ece?utm_source=tw', 'https://en.wikipedia.org/wiki/Monsoon']);

// ----- Bibliography -----
byText('#subnav button', 'Bibliography').click();
await tick();
assert.equal($('.bib h3').textContent, 'Works Cited');
byText('button', 'Copy all').click();
await tick();
assert.match(clipboard, /^Works Cited\n\nSharma, Ravi Kumar, and Anita Rao\./);
byText('button', 'Download .bib').click();
assert.deepEqual(downloads, ['my-research.bib']);

// ----- Restricted page: friendly message, no crash -----
mock.tabs[0].active = false;
mock.tabs[2].active = true;
await mock.fire.tabActivated({ tabId: 9 });
byText('#subnav button', 'Sources').click();
await tick(80);
assert.ok($('.current.muted'), 'non-web tab shows hint');

// ----- Restore highlights on page load -----
mock.tabs[0].active = true; mock.tabs[2].active = false;
// add a highlight directly, then simulate a fresh load
await chrome.runtime.sendMessage({ type: 'research:op', op: 'addHighlight', args: { url: mock.tabs[0].url, highlight: { text: 'Farmers in Kerala and Assam', prefix: 'rain in region 0. ', suffix: ' report', color: 'green' } } });
article.window.document.querySelectorAll('oris-hl').forEach((m) => m.replaceWith(...m.childNodes));
await mock.fire.tabUpdated(7, { status: 'complete' }, mock.tabs[0]);
await tick(120);
const painted = article.window.document.querySelector('oris-hl[data-color="green"]');
assert.ok(painted, 'restored on load');
assert.equal(painted.closest('p'), article.window.document.querySelectorAll('article p')[0], 'restored in the right paragraph');

assert.deepEqual(errors, [], 'no runtime errors');
console.log('research UI + highlighter flow: all assertions passed');
process.exit(0);

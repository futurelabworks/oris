// Highlighter: capture a selection, then repaint it on a fresh copy of the page.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const code = fs.readFileSync(new URL('../content/highlighter.js', import.meta.url), 'utf8');
const html = `<html><body><article>
  <h1>Monsoon   report</h1>
  <p>The monsoon <b>arrived early</b> this year in Kerala. Rainfall was heavy.</p>
  <p>Rainfall was heavy again in Assam, and rivers rose quickly.</p>
  <script>var x = "Rainfall was heavy";</script>
</article></body></html>`;

function page() {
  const dom = new JSDOM(html, { url: 'https://example.com/news', runScripts: 'outside-only' });
  dom.window.CSS = { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&') };
  const store = {};
  dom.window.chrome = { storage: { local: { get: async () => store }, onChanged: { addListener() {} } } };
  dom.window.eval(code);
  dom.window.eval(code); // second injection must be a no-op
  return dom;
}

// 1. Capture a selection that crosses an element boundary.
const a = page();
const doc = a.window.document;
const p1 = doc.querySelectorAll('p')[0];
const range = doc.createRange();
range.setStart(p1.firstChild, 4);               // "monsoon ..."
range.setEnd(p1.querySelector('b').firstChild, 7); // "...arrived"
a.window.getSelection().addRange(range);
const cap = a.window.__orisHL.capture('green', 'h1');
assert.equal(cap.text, 'monsoon arrived');
assert.equal(cap.prefix.trim().endsWith('report The'), true, cap.prefix);
const marks = doc.querySelectorAll('oris-hl[data-oris-id="h1"]');
assert.equal(marks.length, 2, 'one mark per text node');
assert.equal([...marks].map((m) => m.textContent).join(''), 'monsoon arrived');
assert.equal(p1.textContent, 'The monsoon arrived early this year in Kerala. Rainfall was heavy.', 'text unchanged');

// Empty selection -> friendly error
a.window.getSelection().removeAllRanges();
assert.match(a.window.__orisHL.capture('yellow', 'x').error, /Select some text/);

// 2. Second paragraph's repeated phrase: capture it and make sure restore picks the right one.
const p2 = doc.querySelectorAll('p')[1];
const r2 = doc.createRange();
r2.setStart(p2.firstChild, 0);
r2.setEnd(p2.firstChild, 'Rainfall was heavy'.length);
a.window.getSelection().addRange(r2);
const cap2 = a.window.__orisHL.capture('yellow', 'h2');
assert.equal(cap2.text, 'Rainfall was heavy');

// 3. Fresh page: repaint both from stored data.
const b = page();
const res = b.window.__orisHL.sync([
  { id: 'h1', color: 'green', ...cap },
  { id: 'h2', color: 'yellow', ...cap2 },
  { id: 'gone', color: 'blue', text: 'text that is not on the page', prefix: '', suffix: '' },
]);
assert.equal(res.painted, 2);
assert.equal(res.missing, 1);
const bdoc = b.window.document;
const h2 = bdoc.querySelector('oris-hl[data-oris-id="h2"]');
assert.equal(h2.closest('p'), bdoc.querySelectorAll('p')[1], 'prefix/suffix chose the 2nd paragraph, not the 1st');
assert.equal(bdoc.querySelector('script').textContent.includes('oris-hl'), false, 'script text never touched');

// 4. Sync again with a recolour and a deletion.
b.window.__orisHL.sync([{ id: 'h1', color: 'pink', ...cap }]);
assert.equal(bdoc.querySelector('oris-hl[data-oris-id="h1"]').dataset.color, 'pink');
assert.equal(bdoc.querySelector('oris-hl[data-oris-id="h2"]'), null, 'deleted highlight unwrapped');
assert.equal(bdoc.querySelectorAll('p')[1].textContent, 'Rainfall was heavy again in Assam, and rivers rose quickly.');
assert.equal(bdoc.querySelectorAll('p')[1].childNodes.length, 1, 'text nodes merged back');

console.log('highlighter: all assertions passed');

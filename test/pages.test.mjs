// Content script + blocked page in jsdom.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { createChrome } from './chrome-mock.mjs';
import { mergeSettings } from '../lib/defaults.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

// ---- distraction content script on a YouTube watch page ----
{
  const dom = new JSDOM('<html><head></head><body><ytd-watch-flexy><div id="secondary"><div id="related">recs</div></div></ytd-watch-flexy></body></html>',
    { url: 'https://www.youtube.com/watch?v=abc', runScripts: 'outside-only', pretendToBeVisual: true });
  const mock = createChrome();
  await mock.chrome.storage.local.set({ settings: mergeSettings(null), timer: { phase: 'focus', status: 'idle' } });
  dom.window.chrome = mock.chrome;
  dom.window.eval(fs.readFileSync(new URL('../content/distraction.js', import.meta.url), 'utf8'));
  await tick();
  const style = dom.window.document.getElementById('oris-distraction-blocker');
  assert.ok(style, 'style injected');
  assert.ok(style.textContent.includes('#related'), 'sidebar rule on');
  assert.ok(style.textContent.includes('/shorts/'), 'shorts rule on');
  assert.ok(!style.textContent.includes('#comments'), 'comments rule off by default');
  assert.equal(dom.window.getComputedStyle(dom.window.document.getElementById('related')).display, 'none', 'recommendations hidden');
  assert.equal(dom.window.document.documentElement.getAttribute('data-oris-path'), '/watch');

  // Switch to "during focus" while idle -> rules removed live
  await mock.chrome.storage.local.set({ settings: mergeSettings({ distractMode: 'focus' }) });
  await tick();
  assert.equal(style.textContent, '', 'no rules outside focus');
  await mock.chrome.storage.local.set({ timer: { phase: 'focus', status: 'running' } });
  await tick();
  assert.ok(style.textContent.includes('#related'), 'rules back during focus');
  dom.window.close();
}

// ---- blocked page ----
{
  const html = fs.readFileSync(new URL('../blocked/blocked.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/blocked/blocked.html#https://www.instagram.com/reels/?x=1' });
  for (const k of ['window', 'document', 'Node', 'location']) Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true });
  const mock = createChrome();
  globalThis.chrome = mock.chrome;
  const now = Date.now();
  await mock.chrome.storage.local.set({
    settings: mergeSettings(null),
    timer: { phase: 'focus', status: 'running', durationMs: 25 * 60000, endsAt: now + 12 * 60000, task: 'Organic chemistry' },
  });
  await import('../blocked/blocked.js');
  await tick();
  const $ = (id) => document.getElementById(id);
  assert.equal($('domain').textContent, 'instagram.com');
  assert.match($('detail').textContent, /^12:00 left in your session\.$/);
  assert.match($('task').textContent, /Organic chemistry/);
  assert.equal($('btn-continue').hidden, true);
  // Session ends -> continue link appears
  await mock.chrome.storage.local.set({ timer: { phase: 'short', status: 'running', durationMs: 5 * 60000, endsAt: now + 5 * 60000 } });
  await tick();
  assert.equal($('headline').textContent, 'Your focus session is over.');
  assert.equal($('btn-continue').hidden, false);
  assert.equal($('btn-continue').href, 'https://www.instagram.com/reels/?x=1');
}

console.log('content script + blocked page: all assertions passed');
process.exit(0);

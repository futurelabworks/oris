import { KEYS, mergeSettings, mergeTimer, formatClock, remainingOf } from '../lib/defaults.js';
import { isUrlBlocked } from '../lib/rules.js';

const $ = (id) => document.getElementById(id);
const ARC_LEN = Math.PI * 140;

// Original URL comes after '#'. Only http(s) is ever offered as a link.
const original = (() => {
  const raw = location.hash.slice(1);
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch { return null; }
})();

$('domain').textContent = original ? original.hostname.replace(/^www\./, '') : 'Blocked site';

let settings = mergeSettings(null);
let timer = mergeTimer(null);

function render() {
  const stillBlocked = original ? isUrlBlocked(original.href, settings, timer) : true;
  const remaining = remainingOf(timer);
  const inFocus = timer.phase === 'focus' && remaining != null;

  const arc = $('arc');
  arc.style.strokeDasharray = ARC_LEN;
  let progress = 0;
  if (inFocus && timer.durationMs) progress = 1 - remaining / timer.durationMs;
  if (!stillBlocked) progress = 1;
  arc.style.strokeDashoffset = ARC_LEN * (1 - progress);
  const angle = Math.PI * (1 - progress);
  $('sun').setAttribute('cx', (160 + 140 * Math.cos(angle)).toFixed(1));
  $('sun').setAttribute('cy', (160 - 140 * Math.sin(angle)).toFixed(1));

  const detail = $('detail');
  detail.replaceChildren();
  if (!stillBlocked) {
    $('headline').textContent = 'Your focus session is over.';
    detail.textContent = 'This site is no longer blocked.';
  } else if (inFocus) {
    $('headline').textContent = 'This site is blocked while you focus.';
    const strong = document.createElement('strong');
    strong.textContent = formatClock(remaining);
    detail.append(strong, timer.status === 'paused' ? ' left in your session (paused).' : ' left in your session.');
  } else if (remaining != null && settings.blockMode !== 'always') {
    // "Focus + breaks" level: still blocked during the break.
    $('headline').textContent = 'This site stays blocked during your break.';
    const strong = document.createElement('strong');
    strong.textContent = formatClock(remaining);
    detail.append(strong, ' left in your break. Stretch, drink water, look away from the screen.');
  } else if (settings.blockMode === 'always') {
    $('headline').textContent = 'This site is on your block list.';
    detail.textContent = 'You chose to block it all the time. You can change this in Oris → Blocker.';
  } else {
    $('headline').textContent = 'This site is blocked.';
    detail.textContent = '';
  }

  const task = $('task');
  if (stillBlocked && inFocus && timer.task) {
    task.hidden = false;
    task.replaceChildren('Back to ', Object.assign(document.createElement('span'), { textContent: timer.task }), '.');
  } else {
    task.hidden = true;
  }

  const cont = $('btn-continue');
  cont.hidden = stillBlocked || !original;
  if (original) cont.href = original.href;
  $('btn-close').classList.toggle('primary', stillBlocked);
  cont.classList.toggle('primary', !stillBlocked);
}

async function load() {
  const r = await chrome.storage.local.get([KEYS.settings, KEYS.timer]);
  settings = mergeSettings(r[KEYS.settings]);
  timer = mergeTimer(r[KEYS.timer]);
  render();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[KEYS.settings]) settings = mergeSettings(changes[KEYS.settings].newValue);
  if (changes[KEYS.timer]) timer = mergeTimer(changes[KEYS.timer].newValue);
  render();
});

$('btn-close').addEventListener('click', async () => {
  const tab = await chrome.tabs.getCurrent();
  if (tab) chrome.tabs.remove(tab.id);
});

// sidePanel.open() must run synchronously inside the click, so look the window up in advance.
let windowId = null;
chrome.tabs.getCurrent().then((tab) => { windowId = tab && tab.windowId; });
$('btn-panel').addEventListener('click', () => {
  if (windowId == null) return;
  chrome.sidePanel.open({ windowId }).catch(() => {});
});

setInterval(render, 1000);
load();

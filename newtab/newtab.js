// New Tab page: the Idle home screen, the burst transition into a mode, hotkeys,
// onboarding and the guided tour. The modes themselves are the side panel app (app.js),
// mounted in #shell on this page.
import { KEYS, mergeSettings, mergeTimer, formatClock, formatDuration, remainingOf, todayKey, computeStreak, PHASE_LABEL } from '../lib/defaults.js';
import { PLANNER_KEY, mergePlanner, dailyFocus } from '../lib/planner.js';
import { motionLevel, play } from '../lib/motion.js';
import { celebrate } from '../sidepanel/celebrate.js';
import { mountDock } from './dock.js';
import { runOnboarding } from './onboarding.js';

const $ = (id) => document.getElementById(id);
const R = 260;
const ARC_LEN = Math.PI * R;

const state = {
  settings: mergeSettings(null),
  timer: mergeTimer(null),
  stats: { days: {} },
  planner: mergePlanner(null),
};
let view = 'idle'; // 'idle' | 'shell'
let busy = false; // a transition is playing
let dock = null;

// ---------- helpers ----------
function toast(message, kind = '') {
  const t = $('toast');
  t.textContent = message;
  t.className = `toast show ${kind}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.className = 'toast'; }, kind === 'error' ? 5000 : 2600);
}

async function sendTimer(type, extra = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...extra });
  if (!res || !res.ok) toast((res && res.error) || 'Something went wrong. Try again.', 'error');
}

async function plannerOp(op, args) {
  const res = await chrome.runtime.sendMessage({ type: 'planner:op', op, args });
  if (!res || !res.ok) { toast((res && res.error) || 'Something went wrong. Try again.', 'error'); return null; }
  return res.result;
}

const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

// ---------- idle screen ----------
function renderClock() {
  const now = new Date();
  const time = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const m = /^(.*?)\s*([ap]\.?m\.?)$/i.exec(time);
  const timeEl = $('nt-time');
  if (m) timeEl.replaceChildren(m[1], Object.assign(document.createElement('span'), { className: 'ampm', textContent: m[2].toLowerCase() }));
  else timeEl.textContent = time;
  $('nt-date').textContent = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  // The arc is the day (sunrise 6:00 to sunset 18:00), or the session while the timer runs.
  const t = state.timer;
  const remaining = remainingOf(t);
  let progress;
  const horizon = $('horizon');
  if (remaining != null && t.durationMs) {
    progress = 1 - remaining / t.durationMs;
    horizon.dataset.mode = t.phase === 'focus' ? 'focus' : 'break';
  } else {
    const h = now.getHours() + now.getMinutes() / 60;
    progress = Math.min(1, Math.max(0, (h - 6) / 12));
    horizon.dataset.mode = h < 6 || h >= 18 ? 'night' : 'day';
  }
  $('hz-fill').style.strokeDasharray = ARC_LEN;
  $('hz-fill').style.strokeDashoffset = ARC_LEN * (1 - progress);
  const a = Math.PI * (1 - progress);
  $('hz-sun').setAttribute('cx', (300 + R * Math.cos(a)).toFixed(1));
  $('hz-sun').setAttribute('cy', (290 - R * Math.sin(a)).toFixed(1));

  const status = $('nt-status');
  if (remaining != null) {
    const what = t.phase === 'focus' ? (t.task ? `${PHASE_LABEL.focus}: ${t.task}` : PHASE_LABEL.focus) : PHASE_LABEL[t.phase];
    status.textContent = `${what}, ${formatClock(remaining)} left${t.status === 'paused' ? ' (paused)' : ''}`;
    status.dataset.live = 'true';
  } else {
    const d = (state.stats.days || {})[todayKey()] || { focusMs: 0, sessions: 0 };
    const streak = computeStreak(state.stats);
    status.dataset.live = 'false';
    status.textContent = d.sessions || d.focusMs
      ? `${formatDuration(d.focusMs)} focused today${streak > 1 ? `, ${streak}-day streak` : ''}`
      : streak ? `${streak}-day streak. Keep it going today.` : 'No focus time yet today.';
  }
}

function renderActions() {
  const t = state.timer;
  const box = $('nt-actions');
  const btn = (label, onclick, cls = '') => {
    const b = document.createElement('button');
    b.className = `btn lg ${cls}`;
    b.textContent = label;
    b.addEventListener('click', onclick);
    return b;
  };
  const daily = dailyFocus(state.planner);
  const startFocus = () => sendTimer('timer:start', { phase: t.phase, task: t.phase === 'focus' ? (t.task || daily) : undefined });
  if (t.status === 'running') box.replaceChildren(btn('Pause', () => sendTimer('timer:pause'), 'primary'));
  else if (t.status === 'paused') box.replaceChildren(btn('Resume', () => sendTimer('timer:resume'), 'primary'), btn('Stop', () => sendTimer('timer:stop')));
  else if (t.phase === 'focus') box.replaceChildren(btn(`Start ${state.settings.focusMin}-minute focus`, startFocus, 'primary'));
  else box.replaceChildren(btn(`Start ${PHASE_LABEL[t.phase].toLowerCase()}`, startFocus, 'primary'), btn('Skip break', () => sendTimer('timer:skip'), 'ghost'));
}

function toggleTimer() {
  const t = state.timer;
  if (t.status === 'running') sendTimer('timer:pause');
  else if (t.status === 'paused') sendTimer('timer:resume');
  else sendTimer('timer:start', { phase: t.phase, task: t.phase === 'focus' ? (t.task || dailyFocus(state.planner)) : undefined });
}

function renderDaily() {
  const input = $('nt-daily');
  if (document.activeElement !== input) input.value = dailyFocus(state.planner);
}

$('nt-daily').addEventListener('change', (e) => {
  if (e.target.value.trim() !== dailyFocus(state.planner)) plannerOp('setDaily', { text: e.target.value });
});
$('nt-daily').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') e.target.blur(); });

// Search with the person's default search engine (chrome.search respects their choice).
$('search').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('search-input').value.trim();
  if (!text) return;
  if (chrome.search && chrome.search.query) chrome.search.query({ text, disposition: 'CURRENT_TAB' });
  else location.href = 'https://www.google.com/search?q=' + encodeURIComponent(text);
});

// ---------- quick note ----------
function openNote() {
  const form = $('nt-note');
  form.hidden = false;
  $('nt-note-input').focus();
}
function closeNote() {
  $('nt-note').hidden = true;
  $('nt-note-input').value = '';
}
$('nt-note-input').addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') { e.preventDefault(); closeNote(); return; }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const text = e.target.value.trim();
    if (!text) return;
    const t = state.timer;
    const ok = await plannerOp('addNote', { text, session: t.status !== 'idle' && t.focusStartedAt ? String(t.focusStartedAt) : null, task: t.task });
    if (ok) { closeNote(); toast('Note saved. Find it in Study → Focus.'); }
  }
});

// ---------- transitions ----------
async function openMode(mode) {
  if (busy) return;
  busy = true;
  const level = motionLevel(state.settings);
  const idle = $('idle');
  const shell = $('shell');
  window.dispatchEvent(new CustomEvent('oris:open-mode', { detail: mode }));

  if (level === 'full') {
    const burst = $('burst');
    burst.hidden = false;
    const arcs = [...burst.querySelectorAll('.burst-arc')];
    play($('idle-main'), [{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }], { duration: 320, easing: 'cubic-bezier(.4,0,.2,1)' }, level);
    play(idle, [{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: 'ease-in' }, level);
    await Promise.all(arcs.map((p, i) => play(p, [
      { transform: 'rotate(0deg) scale(0.5)', opacity: 0 },
      { transform: `rotate(${30 + i * 8}deg) scale(1)`, opacity: 1, offset: 0.4 },
      { transform: `rotate(${70 + i * 10}deg) scale(4.2)`, opacity: 0 },
    ], { duration: 680, easing: 'cubic-bezier(.2,.7,.2,1)', delay: i * 30 }, level)));
    burst.hidden = true;
    idle.hidden = true;
    shell.hidden = false;
    await play(shell, [{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'ease-out' }, level);
  } else if (level === 'low') {
    await play(idle, [{ opacity: 1 }, { opacity: 0 }], { duration: 160 }, level);
    idle.hidden = true;
    shell.hidden = false;
    await play(shell, [{ opacity: 0 }, { opacity: 1 }], { duration: 160 }, level);
  } else {
    idle.hidden = true;
    shell.hidden = false;
  }
  // Clear finished animations so later layout isn't pinned by fill: both.
  [idle, shell, $('idle-main')].forEach((el) => el.getAnimations && el.getAnimations().forEach((a) => a.cancel()));
  view = 'shell';
  busy = false;
  const first = shell.querySelector('#subnav button, .modes [aria-selected="true"]');
  if (first) first.focus({ preventScroll: true });
}

async function goHome() {
  if (busy || view === 'idle') return;
  busy = true;
  const level = motionLevel(state.settings);
  const idle = $('idle');
  const shell = $('shell');
  await play(shell, [{ opacity: 1 }, { opacity: 0 }], { duration: level === 'full' ? 180 : 120 }, level);
  shell.hidden = true;
  idle.hidden = false;
  await play($('idle-main'), [{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: level === 'full' ? 260 : 120 }, level);
  [idle, shell, $('idle-main')].forEach((el) => el.getAnimations && el.getAnimations().forEach((a) => a.cancel()));
  view = 'idle';
  busy = false;
  window.scrollTo(0, 0);
}

document.querySelectorAll('#nt-modes button').forEach((b) => b.addEventListener('click', () => openMode(b.dataset.mode)));
$('btn-home').addEventListener('click', goHome);

// ---------- hotkeys ----------
// Chrome always gives a new tab's address bar the keyboard first, so the keys only reach this
// page after a click. Say so while the page doesn't have focus.
function renderFocusHint() {
  const hint = $('nt-focus-hint');
  hint.hidden = view !== 'idle' || document.hasFocus();
}
window.addEventListener('focus', renderFocusHint);
window.addEventListener('blur', renderFocusHint);
setInterval(renderFocusHint, 1000);

const isControl = (el) => el && el.closest && el.closest('button, a, [role="button"], summary');

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (!$('onboarding').hidden) return;
  if (e.key === 'Escape' && view === 'shell' && !isTyping(document.activeElement)) { e.preventDefault(); goHome(); return; }
  if (view !== 'idle' || isTyping(document.activeElement)) return;
  const k = e.key.toLowerCase();
  if (k === 's') { e.preventDefault(); openMode('study'); }
  else if (k === 'r') { e.preventDefault(); openMode('research'); }
  else if (k === 'e') { e.preventDefault(); openMode('earn'); }
  else if (k === 'n') { e.preventDefault(); openNote(); }
  else if (k === '/') { e.preventDefault(); $('search-input').focus(); }
  else if (e.key === ' ' && !isControl(document.activeElement)) { e.preventDefault(); toggleTimer(); }
}, true);

// ---------- data ----------
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[KEYS.settings]) {
    state.settings = mergeSettings(changes[KEYS.settings].newValue);
    renderActions();
    // "Run setup again" from Settings while this page is open.
    if (!state.settings.onboarded && $('onboarding').hidden) startOnboarding();
  }
  if (changes[KEYS.timer]) { state.timer = mergeTimer(changes[KEYS.timer].newValue); renderActions(); renderClock(); }
  if (changes[KEYS.stats]) { state.stats = changes[KEYS.stats].newValue || { days: {} }; renderClock(); }
  if (changes[PLANNER_KEY]) { state.planner = mergePlanner(changes[PLANNER_KEY].newValue); renderDaily(); renderActions(); if (dock) dock.render(); }
});

window.addEventListener('oris:session-complete', () => {
  if (view !== 'idle') return;
  const d = (state.stats.days || {})[todayKey()];
  celebrate($('idle-main'), state.settings, { sessions: d ? d.sessions : 0 });
});

function startOnboarding() {
  runOnboarding({
    root: $('onboarding'), state, toast, onDone: () => $('nt-daily').focus(),
    // Straight into the study setup, full screen in the New Tab.
    onStudySetup: async () => {
      await openMode('study');
      window.dispatchEvent(new CustomEvent('oris:open-view', { detail: { name: 'setup', params: { step: 0 } } }));
    },
  });
}

(async () => {
  const r = await chrome.storage.local.get([KEYS.settings, KEYS.timer, KEYS.stats, PLANNER_KEY]);
  state.settings = mergeSettings(r[KEYS.settings]);
  state.timer = mergeTimer(r[KEYS.timer]);
  state.stats = r[KEYS.stats] || { days: {} };
  state.planner = mergePlanner(r[PLANNER_KEY]);
  renderClock();
  renderActions();
  renderDaily();
  renderFocusHint();
  dock = mountDock({ root: $('dock'), toast, plannerOp, getPlanner: () => state.planner });
  setInterval(renderClock, 1000);
  if (!state.settings.onboarded) startOnboarding();
})();

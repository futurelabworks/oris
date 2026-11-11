import { KEYS, mergeSettings, mergeTimer } from '../lib/defaults.js';
import { RESEARCH_KEY, mergeResearch } from '../lib/research.js';
import { PLANNER_KEY, mergePlanner } from '../lib/planner.js';
import { EARN_KEY, mergeEarn } from '../lib/earn.js';
import { newBadges } from '../lib/rewards.js';
import { STUDY_KEY, mergeStudy, logEvent } from '../lib/study.js';
import * as planView from './plan.js';
import * as setupView from './setup.js';
import * as earnOverview from './earn-overview.js';
import * as earnWork from './earn-work.js';
import * as earnJobs from './earn-jobs.js';
import * as earnSkills from './earn-skills.js';
import * as earnRewards from './earn-rewards.js';
import * as focusView from './focus.js';
import * as blockerView from './blocker.js';
import * as syllabusView from './syllabus.js';
import * as settingsView from './settings.js';
import * as soonView from './soon.js';
import * as sourcesView from './research-sources.js';
import * as sessionsView from './research-sessions.js';
import * as bibView from './research-bib.js';
import * as askView from './research-ask.js';

const views = {
  plan: planView, setup: setupView, focus: focusView, blocker: blockerView, syllabus: syllabusView,
  sources: sourcesView, ask: askView, sessions: sessionsView, bibliography: bibView,
  overview: earnOverview, work: earnWork, jobs: earnJobs, skills: earnSkills, rewards: earnRewards,
  settings: settingsView, soon: soonView,
};

// Each mode has its own row of tools. A mode without tools shows the "coming soon" view.
const MODES = {
  study: [['plan', 'Plan'], ['focus', 'Focus'], ['blocker', 'Blocker'], ['syllabus', 'Syllabus']],
  research: [['sources', 'Sources'], ['ask', 'Ask'], ['sessions', 'Sessions'], ['bibliography', 'Bibliography']],
  earn: [['overview', 'Overview'], ['work', 'Work'], ['jobs', 'Jobs'], ['skills', 'Skills'], ['rewards', 'Rewards']],
};
const modeOf = (view) => Object.keys(MODES).find((m) => MODES[m].some(([v]) => v === view)) || null;

// ---------- tiny DOM helper ----------
// el('button', { class: 'btn', onclick: fn }, 'Text', childNode)
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) node.append(c);
  return node;
}

// ---------- shared state ----------
const state = {
  settings: mergeSettings(null),
  timer: mergeTimer(null),
  stats: { days: {} },
  syllabi: [],
  research: mergeResearch(null),
  planner: mergePlanner(null),
  earn: mergeEarn(null),
  study: mergeStudy(null),
};

// The same app runs in the side panel and inside the New Tab page.
const surface = document.body.dataset.surface || 'panel';

let toastTimer;
function toast(message, kind = '') {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, kind === 'error' ? 6000 : 3000);
}

async function saveSettings(patch) {
  state.settings = mergeSettings({ ...state.settings, ...patch });
  await chrome.storage.local.set({ [KEYS.settings]: state.settings });
}

async function saveSyllabi(list) {
  state.syllabi = list;
  await chrome.storage.local.set({ [KEYS.syllabi]: list });
}

// Change the study profile/plan inputs. `fn` edits a fresh copy; `log` records what the student did.
async function saveStudy(fn, log) {
  const r = await chrome.storage.local.get(STUDY_KEY);
  const next = mergeStudy(JSON.parse(JSON.stringify(mergeStudy(r[STUDY_KEY]))));
  const out = fn(next) || next;
  if (log) logEvent(out, log.kind, log.data);
  state.study = mergeStudy(out);
  await chrome.storage.local.set({ [STUDY_KEY]: state.study });
  return state.study;
}

async function send(msg) {
  const res = await chrome.runtime.sendMessage(msg);
  if (!res || !res.ok) {
    toast((res && res.error) || 'Something went wrong. Try again.', 'error');
    return null;
  }
  state.timer = mergeTimer(res.timer);
  if (current && current.update) current.update({ timer: true });
  return res.timer;
}

// Research changes go through the service worker so they never clash with the highlighter.
async function research(op, args = {}) {
  const res = await chrome.runtime.sendMessage({ type: 'research:op', op, args });
  if (!res || !res.ok) {
    toast((res && res.error) || 'Something went wrong. Try again.', 'error');
    return null;
  }
  return res.result;
}

async function planner(op, args = {}) {
  const res = await chrome.runtime.sendMessage({ type: 'planner:op', op, args });
  if (!res || !res.ok) {
    toast((res && res.error) || 'Something went wrong. Try again.', 'error');
    return null;
  }
  return res.result;
}

async function earn(op, args = {}) {
  const res = await chrome.runtime.sendMessage({ type: 'earn:op', op, args });
  if (!res || !res.ok) {
    toast((res && res.error) || 'Something went wrong. Try again.', 'error');
    return null;
  }
  return res.result;
}

// Celebrate badges earned since they were last seen (once, in one place: the side panel).
let badgeTimer = null;
function checkBadges() {
  if (surface !== 'panel') return;
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(async () => {
    const fresh = newBadges(state, state.earn.seenBadges);
    if (!fresh.length) return;
    // First run on an existing install: mark what's already earned without a burst of toasts.
    if (!state.earn.seenBadges.length && fresh.length > 2) { await earn('markBadgesSeen', { ids: fresh.map((b) => b.id) }); return; }
    toast(fresh.length === 1 ? `Badge unlocked: ${fresh[0].name}` : `${fresh.length} badges unlocked: ${fresh.map((b) => b.name).join(', ')}`);
    await earn('markBadgesSeen', { ids: fresh.map((b) => b.id) });
  }, 800);
}

// The tab that's active in the window this panel belongs to.
let panelWindowId = null;
async function activeTab() {
  if (panelWindowId == null) {
    try { panelWindowId = (await chrome.windows.getCurrent()).id; } catch { /* ignore */ }
  }
  const q = panelWindowId != null ? { active: true, windowId: panelWindowId } : { active: true, lastFocusedWindow: true };
  const [tab] = await chrome.tabs.query(q);
  return tab || null;
}

const ctx = { state, saveSettings, saveSyllabi, saveStudy, send, research, planner, earn, activeTab, toast, open, el, svg, surface };

// ---------- navigation ----------
let current = null;
let currentName = '';
const root = document.getElementById('view');
const subnav = document.getElementById('subnav');

function remember(key, value) { try { localStorage.setItem(key, value); } catch { /* storage blocked */ } }
function recall(key) { try { return localStorage.getItem(key); } catch { return null; } }

function lastViewOf(mode) {
  const saved = recall(`oris:view:${mode}`);
  if (MODES[mode].some(([v]) => v === saved)) return saved;
  // Study opens on Focus as before, until a study plan exists.
  if (mode === 'study' && !state.study.setupDone) return 'focus';
  return (MODES[mode][0] || [])[0];
}

function openMode(mode) {
  if (MODES[mode].length) open(lastViewOf(mode));
  else open('soon', { mode });
}

function open(name, params = {}) {
  if (current && current.unmount) current.unmount();
  root.replaceChildren();
  currentName = name;
  current = views[name].mount(root, ctx, params) || {};

  const mode = name === 'soon' ? params.mode : modeOf(name);
  const tools = mode ? MODES[mode] : [];
  subnav.hidden = !tools.length;
  subnav.setAttribute('aria-label', mode ? `${mode[0].toUpperCase()}${mode.slice(1)} tools` : '');
  subnav.replaceChildren(...tools.map(([v, label]) => el('button', {
    'aria-current': v === name ? 'page' : null,
    onclick: () => open(v),
  }, label)));
  document.querySelectorAll('.modes [role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
  document.getElementById('btn-settings').classList.toggle('active', name === 'settings');
  if (mode && name !== 'soon') {
    remember(`oris:view:${mode}`, name);
    remember('oris:mode', mode);
  }
  root.scrollTop = 0;
  window.scrollTo(0, 0);
}

document.querySelectorAll('.modes [role="tab"]').forEach((b) => b.addEventListener('click', () => openMode(b.dataset.mode)));
document.getElementById('btn-settings').addEventListener('click', () => {
  if (currentName === 'settings') openMode(recall('oris:mode') || 'study');
  else open('settings');
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const changed = {};
  if (changes[KEYS.settings]) { state.settings = mergeSettings(changes[KEYS.settings].newValue); changed.settings = true; }
  if (changes[KEYS.timer]) { state.timer = mergeTimer(changes[KEYS.timer].newValue); changed.timer = true; }
  if (changes[KEYS.stats]) { state.stats = changes[KEYS.stats].newValue || { days: {} }; changed.stats = true; }
  if (changes[KEYS.syllabi]) { state.syllabi = changes[KEYS.syllabi].newValue || []; changed.syllabi = true; }
  if (changes[RESEARCH_KEY]) { state.research = mergeResearch(changes[RESEARCH_KEY].newValue); changed.research = true; }
  if (changes[PLANNER_KEY]) { state.planner = mergePlanner(changes[PLANNER_KEY].newValue); changed.planner = true; }
  if (changes[EARN_KEY]) { state.earn = mergeEarn(changes[EARN_KEY].newValue); changed.earn = true; }
  if (changes[STUDY_KEY]) { state.study = mergeStudy(changes[STUDY_KEY].newValue); changed.study = true; }
  if (changes[EARN_KEY] || changes[PLANNER_KEY] || changes[KEYS.stats] || changes[RESEARCH_KEY]) checkBadges();
  // A focus session just finished: let the page celebrate.
  if (changes[KEYS.timer]) {
    const before = mergeTimer(changes[KEYS.timer].oldValue);
    if (state.timer.completedFocus > before.completedFocus) {
      window.dispatchEvent(new CustomEvent('oris:session-complete', { detail: { timer: state.timer } }));
    }
  }
  // Alt+Shift+N: open the Focus view with the note box ready (side panel only).
  if (changes['ui:noteRequest'] && surface === 'panel') openNote();
  if (current && current.update) current.update(changed);
});

function openNote() {
  open('focus', { focusNote: true });
}

window.addEventListener('oris:open-mode', (e) => openMode(e.detail && MODES[e.detail] ? e.detail : 'study'));
window.addEventListener('oris:open-view', (e) => { if (e.detail && views[e.detail.name]) open(e.detail.name, e.detail.params || {}); });

// Let views react when you switch tabs or a page finishes loading.
function tabChanged() { if (current && current.update) current.update({ tab: true }); }
chrome.tabs.onActivated.addListener(tabChanged);
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (tab.active && (info.status === 'complete' || info.title || info.url)) tabChanged();
});

// ---------- boot ----------
(async () => {
  const r = await chrome.storage.local.get([KEYS.settings, KEYS.timer, KEYS.stats, KEYS.syllabi, RESEARCH_KEY, PLANNER_KEY, EARN_KEY, STUDY_KEY, 'ui:noteRequest']);
  state.settings = mergeSettings(r[KEYS.settings]);
  state.timer = mergeTimer(r[KEYS.timer]);
  state.stats = r[KEYS.stats] || { days: {} };
  state.syllabi = r[KEYS.syllabi] || [];
  state.research = mergeResearch(r[RESEARCH_KEY]);
  state.planner = mergePlanner(r[PLANNER_KEY]);
  state.earn = mergeEarn(r[EARN_KEY]);
  state.study = mergeStudy(r[STUDY_KEY]);
  // Older v1 installs remembered the Study view under a different key.
  const legacy = recall('oris:view');
  if (legacy && !recall('oris:view:study') && MODES.study.some(([v]) => v === legacy)) remember('oris:view:study', legacy);
  const mode = recall('oris:mode');
  // The panel was opened by the quick-note shortcut a moment ago.
  if (surface === 'panel' && r['ui:noteRequest'] && Date.now() - r['ui:noteRequest'] < 5000) openNote();
  else openMode(MODES[mode] ? mode : 'study');
  window.dispatchEvent(new CustomEvent('oris:ready'));
  checkBadges();
})();

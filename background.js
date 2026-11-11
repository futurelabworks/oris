// Oris service worker: focus timer (chrome.alarms), website blocking (declarativeNetRequest),
// stats, notifications and toolbar badge.
// The worker is shut down when idle, so all state lives in chrome.storage.local.

import { KEYS, PHASE_LABEL, mergeSettings, mergeTimer, todayKey, DEFAULT_SETTINGS } from './lib/defaults.js';
import { buildRules, isUrlBlocked, isFocusSession } from './lib/rules.js';
import { RESEARCH_KEY, mergeResearch, applyOp, highlightsForUrl, normalizeUrl, uid } from './lib/research.js';
import { extractFromTab } from './lib/extract.js';
import { textKey } from './lib/source-text.js';
import { EARN_KEY, mergeEarn, applyEarnOp } from './lib/earn.js';
import { PLANNER_KEY, mergePlanner, applyPlannerOp } from './lib/planner.js';
import { STUDY_KEY, mergeStudy, logEvent } from './lib/study.js';
import { coachOf, recordDayPlan, reminderNow, sanitizeEvents, canShare } from './lib/coach.js';
import { ORIS_AI_URL, installId } from './lib/ai.js';

const ALARM_END = 'oris-phase-end';
const ALARM_TICK = 'oris-tick';
const NOTIF_ID = 'oris-phase';
const BLOCKED_PAGE = () => chrome.runtime.getURL('blocked/blocked.html');

// ---------- serialisation (alarms, messages and commands can race) ----------
let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

// ---------- storage ----------
async function load() {
  const r = await chrome.storage.local.get([KEYS.settings, KEYS.timer, KEYS.stats]);
  return {
    settings: mergeSettings(r[KEYS.settings]),
    timer: mergeTimer(r[KEYS.timer]),
    stats: r[KEYS.stats] || { days: {} },
  };
}
const saveTimer = (timer) => chrome.storage.local.set({ [KEYS.timer]: timer });

function phaseMinutes(settings, phase) {
  const v = phase === 'focus' ? settings.focusMin : phase === 'short' ? settings.shortMin : settings.longMin;
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 300 ? n : DEFAULT_SETTINGS[phase === 'focus' ? 'focusMin' : phase === 'short' ? 'shortMin' : 'longMin'];
}

async function addFocusTime(ms, sessionCompleted, timer) {
  if (ms < 60000 && !sessionCompleted) return; // ignore sub-minute fragments
  if (timer && timer.taskId) await plannerOp('logTaskFocus', { id: timer.taskId, ms, completed: sessionCompleted });
  if (timer && timer.skillId) await earnOp('logSkillFocus', { id: timer.skillId, ms });
  const { stats } = await load();
  stats.days = stats.days || {};
  const key = todayKey();
  const day = stats.days[key] || { focusMs: 0, sessions: 0 };
  day.focusMs += Math.max(0, Math.round(ms));
  if (sessionCompleted) day.sessions += 1;
  stats.days[key] = day;
  // keep ~1 year
  const keys = Object.keys(stats.days).sort();
  while (keys.length > 370) delete stats.days[keys.shift()];
  await chrome.storage.local.set({ [KEYS.stats]: stats });
}

// ---------- timer actions ----------
async function startPhase(phase, task, taskId, skillId) {
  const { settings, timer } = await load();
  const durationMs = phaseMinutes(settings, phase) * 60000;
  const now = Date.now();
  const next = {
    ...timer,
    phase,
    status: 'running',
    durationMs,
    endsAt: now + durationMs,
    remainingMs: null,
    startedAt: now,
    task: typeof task === 'string' ? task.slice(0, 140) : timer.task,
    taskId: taskId !== undefined ? (taskId || null) : timer.taskId,
    // Set when a session is started from a skill in Earn mode; its focus time counts to that skill.
    skillId: skillId !== undefined ? (skillId || null) : timer.skillId || null,
    // Notes taken during a focus session and its break share this key.
    focusStartedAt: phase === 'focus' ? now : timer.focusStartedAt || null,
  };
  await saveTimer(next);
  await chrome.alarms.create(ALARM_END, { when: next.endsAt });
  await chrome.alarms.create(ALARM_TICK, { periodInMinutes: 0.5 });
  await afterStateChange(settings, next, phase === 'focus');
  return next;
}

async function pause() {
  const { settings, timer } = await load();
  if (timer.status !== 'running') return timer;
  if (settings.hardMode && timer.phase === 'focus') throw new Error('Hard mode is on. The session can’t be paused.');
  const next = { ...timer, status: 'paused', remainingMs: Math.max(0, timer.endsAt - Date.now()), endsAt: null };
  await saveTimer(next);
  await chrome.alarms.clear(ALARM_END);
  await afterStateChange(settings, next);
  return next;
}

async function resume() {
  const { settings, timer } = await load();
  if (timer.status !== 'paused') return timer;
  const next = { ...timer, status: 'running', endsAt: Date.now() + timer.remainingMs, remainingMs: null };
  await saveTimer(next);
  await chrome.alarms.create(ALARM_END, { when: next.endsAt });
  await chrome.alarms.create(ALARM_TICK, { periodInMinutes: 0.5 });
  await afterStateChange(settings, next);
  return next;
}

function elapsedOf(timer) {
  if (!timer.durationMs) return 0;
  const remaining = timer.status === 'running' ? timer.endsAt - Date.now() : timer.status === 'paused' ? timer.remainingMs : timer.durationMs;
  return Math.max(0, timer.durationMs - remaining);
}

async function stop() {
  const { settings, timer } = await load();
  if (timer.status === 'idle') return timer;
  if (settings.hardMode && timer.phase === 'focus') throw new Error('Hard mode is on. The session can’t be stopped.');
  if (timer.phase === 'focus') await addFocusTime(elapsedOf(timer), false, timer);
  const next = { ...timer, phase: 'focus', status: 'idle', endsAt: null, remainingMs: null, durationMs: null, completedFocus: 0 };
  await saveTimer(next);
  await chrome.alarms.clear(ALARM_END);
  await chrome.alarms.clear(ALARM_TICK);
  await afterStateChange(settings, next);
  return next;
}

// Skip ends the current phase now and moves on. Focus time already spent is still counted,
// but a skipped focus phase doesn't count as a completed session.
async function skip() {
  const { settings, timer } = await load();
  if (timer.status === 'idle') {
    // Idle with a break pending: skipping the break goes straight to focus (ready to start).
    if (timer.phase !== 'focus') {
      const next = { ...timer, phase: 'focus' };
      await saveTimer(next);
      await afterStateChange(settings, next);
      return next;
    }
    return timer;
  }
  if (settings.hardMode && timer.phase === 'focus') throw new Error('Hard mode is on. The session can’t be skipped.');
  if (timer.phase === 'focus') await addFocusTime(elapsedOf(timer), false, timer);
  return advance(timer, settings, { completed: false });
}

// Phase reached its end (alarm fired, or caught up after the browser was closed).
async function completeCurrent() {
  const { settings, timer } = await load();
  if (timer.status !== 'running' || timer.endsAt > Date.now() + 1000) return timer;
  if (timer.phase === 'focus') await addFocusTime(timer.durationMs, true, timer);
  return advance(timer, settings, { completed: true });
}

async function advance(timer, settings, { completed }) {
  await chrome.alarms.clear(ALARM_END);
  let nextPhase;
  let completedFocus = timer.completedFocus;
  if (timer.phase === 'focus') {
    if (completed) completedFocus += 1;
    const every = Math.max(1, Number(settings.longEvery) || 4);
    nextPhase = completed && completedFocus > 0 && completedFocus % every === 0 ? 'long' : 'short';
  } else {
    nextPhase = 'focus';
  }

  const autoStart = nextPhase === 'focus' ? settings.autoStartFocus : settings.autoStartBreaks;
  if (completed) notifyPhaseEnd(settings, timer.phase, nextPhase, autoStart);

  const base = { ...timer, completedFocus };
  if (autoStart) {
    await saveTimer({ ...base, status: 'idle' });
    return startPhase(nextPhase, timer.task);
  }
  const next = { ...base, phase: nextPhase, status: 'idle', endsAt: null, remainingMs: null, durationMs: null };
  await saveTimer(next);
  await chrome.alarms.clear(ALARM_TICK);
  await afterStateChange(settings, next);
  return next;
}

function notifyPhaseEnd(settings, endedPhase, nextPhase, autoStarted) {
  if (!settings.notify) return;
  let title;
  let message;
  if (endedPhase === 'focus') {
    title = 'Focus session complete';
    const mins = nextPhase === 'long' ? settings.longMin : settings.shortMin;
    message = autoStarted ? `${PHASE_LABEL[nextPhase]} of ${mins} min has started.` : `Time for a ${mins} min ${nextPhase === 'long' ? 'long ' : ''}break.`;
  } else {
    title = 'Break is over';
    message = autoStarted ? 'Your next focus session has started.' : 'Ready for the next focus session?';
  }
  const opts = {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title,
    message,
    priority: 2,
  };
  if (!autoStarted) opts.buttons = [{ title: endedPhase === 'focus' ? 'Start break' : 'Start focus' }];
  chrome.notifications.clear(NOTIF_ID, () => chrome.notifications.create(NOTIF_ID, opts));
}

// ---------- blocking + badge ----------
async function syncRules(settings, timer) {
  if (!settings || !timer) ({ settings, timer } = await load());
  const rules = buildRules(settings, timer, BLOCKED_PAGE());
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: rules,
  });
}

// Tabs already open on a blocked site aren't caught by network rules, so move them to the blocked page.
async function redirectOpenTabs(settings, timer) {
  const tabs = await chrome.tabs.query({});
  const base = BLOCKED_PAGE();
  await Promise.all(tabs.map(async (tab) => {
    if (!tab.url || !isUrlBlocked(tab.url, settings, timer)) return;
    try { await chrome.tabs.update(tab.id, { url: base + '#' + tab.url }); } catch { /* tab closed */ }
  }));
}

async function updateBadge(timer) {
  if (!timer) ({ timer } = await load());
  let text = '';
  let color = '#3D4FD6';
  if (timer.status === 'running') {
    const min = Math.ceil(Math.max(0, timer.endsAt - Date.now()) / 60000);
    text = `${min}m`;
    if (timer.phase !== 'focus') color = '#2F8A62';
  } else if (timer.status === 'paused') {
    text = '||';
    color = '#5E6782';
  }
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
}

async function afterStateChange(settings, timer, focusStarted = false) {
  await syncRules(settings, timer);
  await updateBadge(timer);
  if (focusStarted) await redirectOpenTabs(settings, timer);
}

// Recreate alarms / finish phases that ended while the worker or browser was asleep.
async function reconcile() {
  const { settings, timer } = await load();
  if (timer.status === 'running') {
    if (timer.endsAt <= Date.now()) return completeCurrent();
    await chrome.alarms.create(ALARM_END, { when: timer.endsAt });
    await chrome.alarms.create(ALARM_TICK, { periodInMinutes: 0.5 });
  }
  await syncRules(settings, timer);
  await updateBadge(timer);
}


// ---------- planner: daily focus, tasks, notes, dock ----------
async function plannerOp(op, args) {
  const r = await chrome.storage.local.get(PLANNER_KEY);
  const state = mergePlanner(r[PLANNER_KEY]);
  const result = applyPlannerOp(state, op, args);
  await chrome.storage.local.set({ [PLANNER_KEY]: state });
  return result;
}

// ---------- earn: clients, income, jobs, skills ----------
async function earnOp(op, args) {
  const r = await chrome.storage.local.get(EARN_KEY);
  const state = mergeEarn(r[EARN_KEY]);
  const result = applyEarnOp(state, op, args);
  await chrome.storage.local.set({ [EARN_KEY]: state });
  return result;
}

const ALARM_FOLLOWUP = 'oris-followups';
const ALARM_COACH = 'oris-coach';

// Every 30 minutes: remember today's planned minutes, send at most one coach reminder,
// and (only if the student opted in) share anonymous study events once a day.
async function coachTick(now = Date.now()) {
  const r = await chrome.storage.local.get([STUDY_KEY, KEYS.syllabi]);
  if (!r[STUDY_KEY]) return;
  const study = mergeStudy(r[STUDY_KEY]);
  if (!study.setupDone) return;
  const syllabi = r[KEYS.syllabi] || [];
  const today = todayKey(new Date(now));
  const before = JSON.stringify(study.dayPlan || {});
  recordDayPlan(study, syllabi, today);
  let changed = JSON.stringify(study.dayPlan) !== before;
  const rem = reminderNow(study, syllabi, now);
  if (rem) {
    const c = coachOf(study);
    c.notified = { [today]: [...(c.notified[today] || []), rem.kind] };
    study.coach = c;
    logEvent(study, 'coach.remind', { usual: rem.kind === 'usual' });
    changed = true;
    chrome.notifications.create(ALARM_COACH, { type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'), title: rem.title, message: rem.message, priority: 1 });
  }
  const c = coachOf(study);
  if (canShare(study) && now - (c.uploadedAt || 0) > 20 * 3600e3) {
    const events = sanitizeEvents(study.log, { since: c.uploadedAt || 0, level: study.profile.level });
    if (events.length) {
      try {
        const res = await fetch(ORIS_AI_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-oris-install': await installId() }, body: JSON.stringify({ task: 'events', events }) });
        if (res.ok) { c.uploadedAt = now; study.coach = c; changed = true; }
      } catch { /* try again next time */ }
    }
  }
  if (changed) await chrome.storage.local.set({ [STUDY_KEY]: study });
}

// Once a day per application: remind about follow-ups that are due.
async function checkFollowUps() {
  const r = await chrome.storage.local.get(EARN_KEY);
  const state = mergeEarn(r[EARN_KEY]);
  const today = todayKey();
  const due = state.jobs.filter((j) => j.followUp && j.followUp <= today && j.notifiedOn !== today && !['offer', 'rejected'].includes(j.stage));
  if (!due.length) return;
  for (const j of due) j.notifiedOn = today;
  await chrome.storage.local.set({ [EARN_KEY]: state });
  const names = due.map((j) => [j.role, j.company].filter(Boolean).join(' at ')).slice(0, 3);
  chrome.notifications.create('oris-followup', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: due.length === 1 ? 'Time to follow up' : `${due.length} follow-ups due`,
    message: names.join(', ') + (due.length > 3 ? ', and more' : '') + '. Open Oris → Earn → Jobs.',
    priority: 1,
  });
}

// ---------- research: store, highlighter, context menus ----------
async function researchOp(op, args) {
  const r = await chrome.storage.local.get(RESEARCH_KEY);
  const state = mergeResearch(r[RESEARCH_KEY]);
  const before = new Set(state.sources.map((x) => x.id));
  const result = applyOp(state, op, args);
  await chrome.storage.local.set({ [RESEARCH_KEY]: state });
  // Deleting a source or a project also deletes the stored page text of those sources.
  const after = new Set(state.sources.map((x) => x.id));
  const gone = [...before].filter((id) => !after.has(id)).map(textKey);
  if (gone.length) await chrome.storage.local.remove(gone);
  return result;
}

const isWeb = (url) => /^https?:/i.test(url || '');

async function inTab(tabId, func, args = []) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return res && res.result;
}

async function injectHighlighter(tabId, url) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content/highlighter.js'] });
  await inTab(tabId, (key) => window.__orisHL.init(key), [normalizeUrl(url)]);
}

const pageToast = (tabId, msg, isError) => inTab(tabId, (m, e) => window.__orisHL && window.__orisHL.toast(m, e), [msg, !!isError]).catch(() => {});

async function readMeta(tab) {
  try { return (await extractFromTab(tab.id, 1)).meta; } catch { return { title: tab.title || '' }; }
}

async function highlightInTab(tab, color = 'yellow') {
  if (!tab || !isWeb(tab.url)) return;
  try {
    await injectHighlighter(tab.id, tab.url);
  } catch {
    return; // Chrome doesn't allow scripts on this page
  }
  const id = uid();
  const captured = await inTab(tab.id, (c, i) => window.__orisHL.capture(c, i), [color, id]);
  if (!captured || captured.error) return pageToast(tab.id, (captured && captured.error) || 'Couldn’t highlight that.', true);
  const meta = await readMeta(tab);
  try {
    const res = await serial(() => researchOp('addHighlight', { url: tab.url, meta, highlight: { ...captured, id, color } }));
    await pageToast(tab.id, `Highlighted. Saved to “${res.projectName}”.`);
  } catch (err) {
    await inTab(tab.id, (i) => window.__orisHL.unwrap(i), [id]).catch(() => {});
    await pageToast(tab.id, err.message, true);
  }
}

async function savePageFromMenu(tab) {
  if (!tab || !isWeb(tab.url)) return;
  const meta = await readMeta(tab);
  try {
    await serial(() => researchOp('saveSource', { url: tab.url, meta }));
    const r = mergeResearch((await chrome.storage.local.get(RESEARCH_KEY))[RESEARCH_KEY]);
    const name = (r.projects.find((p) => p.id === r.activeProjectId) || {}).name;
    await injectHighlighter(tab.id, tab.url).catch(() => {});
    await pageToast(tab.id, `Page saved to “${name}”.`);
  } catch (err) {
    await pageToast(tab.id, err.message, true);
  }
}

// Repaint saved highlights when a page that has them finishes loading.
async function restoreHighlights(tabId, url) {
  if (!isWeb(url)) return;
  const r = await chrome.storage.local.get(RESEARCH_KEY);
  if (!r[RESEARCH_KEY]) return;
  const list = highlightsForUrl(mergeResearch(r[RESEARCH_KEY]), url);
  if (!list.length) return;
  try {
    await injectHighlighter(tabId, url);
    await inTab(tabId, (hs) => window.__orisHL.sync(hs), [list]);
  } catch { /* page not scriptable */ }
}

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'oris-highlight', title: 'Highlight with Oris', contexts: ['selection'], documentUrlPatterns: ['http://*/*', 'https://*/*'] });
    chrome.contextMenus.create({ id: 'oris-save-page', title: 'Save page to Oris', contexts: ['page'], documentUrlPatterns: ['http://*/*', 'https://*/*'] });
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'oris-highlight') highlightInTab(tab);
  if (info.menuItemId === 'oris-save-page') savePageFromMenu(tab);
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete') restoreHighlights(tabId, tab.url);
});

// ---------- events ----------
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onInstalled.addListener((details) => serial(async () => {
  createMenus();
  // First install: open a New Tab so onboarding starts right away.
  if (details && details.reason === 'install') chrome.tabs.create({}).catch(() => {});
  const r = await chrome.storage.local.get([KEYS.settings, KEYS.timer, KEYS.stats, KEYS.syllabi, RESEARCH_KEY]);
  const init = {};
  if (!r[KEYS.settings]) init[KEYS.settings] = mergeSettings(null);
  if (!r[KEYS.timer]) init[KEYS.timer] = mergeTimer(null);
  if (!r[KEYS.stats]) init[KEYS.stats] = { days: {} };
  if (!r[KEYS.syllabi]) init[KEYS.syllabi] = [];
  if (!r[RESEARCH_KEY]) init[RESEARCH_KEY] = mergeResearch(null);
  if (!(await chrome.storage.local.get(PLANNER_KEY))[PLANNER_KEY]) init[PLANNER_KEY] = mergePlanner(null);
  if (!(await chrome.storage.local.get(EARN_KEY))[EARN_KEY]) init[EARN_KEY] = mergeEarn(null);
  if (Object.keys(init).length) await chrome.storage.local.set(init);
  await reconcile();
}));

chrome.runtime.onStartup.addListener(() => serial(reconcile));
chrome.alarms.create(ALARM_FOLLOWUP, { periodInMinutes: 60, delayInMinutes: 1 });
chrome.alarms.create(ALARM_COACH, { periodInMinutes: 30, delayInMinutes: 2 });

chrome.alarms.onAlarm.addListener((alarm) => serial(async () => {
  if (alarm.name === ALARM_END) return completeCurrent();
  if (alarm.name === ALARM_FOLLOWUP) return checkFollowUps();
  if (alarm.name === ALARM_COACH) return coachTick();
  if (alarm.name === ALARM_TICK) {
    const { timer } = await load();
    if (timer.status === 'running' && timer.endsAt <= Date.now()) return completeCurrent();
    if (timer.status !== 'running') await chrome.alarms.clear(ALARM_TICK);
    return updateBadge(timer);
  }
}));

// A coach reminder opens Oris on a New Tab.
if (chrome.notifications.onClicked) {
  chrome.notifications.onClicked.addListener((id) => {
    if (id === ALARM_COACH) { chrome.tabs.create({}); chrome.notifications.clear(id); }
  });
}

chrome.notifications.onButtonClicked.addListener((id) => serial(async () => {
  if (id !== NOTIF_ID) return;
  const { timer } = await load();
  if (timer.status === 'idle') await startPhase(timer.phase);
  chrome.notifications.clear(NOTIF_ID);
}));

chrome.commands.onCommand.addListener((cmd, tab) => {
  if (cmd === 'highlight-selection') {
    if (tab) highlightInTab(tab);
    else chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([t]) => highlightInTab(t));
    return;
  }
  if (cmd === 'toggle-timer') toggleTimer();
  if (cmd === 'quick-note') {
    // Opening the side panel must happen inside the shortcut's user gesture, so do it first.
    const open = tab ? chrome.sidePanel.open({ windowId: tab.windowId }) : Promise.resolve();
    open.catch(() => {});
    chrome.storage.local.set({ 'ui:noteRequest': Date.now() });
  }
});

const toggleTimer = () => serial(async () => {
  const { timer } = await load();
  try {
    if (timer.status === 'running') await pause();
    else if (timer.status === 'paused') await resume();
    else await startPhase(timer.phase);
  } catch { /* hard mode */ }
});

// Settings edited in the side panel -> refresh rules.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[KEYS.settings]) return;
  serial(async () => {
    const { settings, timer } = await load();
    const before = mergeSettings(changes[KEYS.settings].oldValue);
    await syncRules(settings, timer);
    // Blocking just became stricter -> sweep open tabs.
    const nowAlways = settings.blockMode === 'always' && before.blockMode !== 'always';
    const listChanged = JSON.stringify([before.listType, before.blocklist, before.allowlist]) !== JSON.stringify([settings.listType, settings.blocklist, settings.allowlist]);
    if (nowAlways || ((settings.blockMode === 'always' || isFocusSession(timer)) && listChanged)) await redirectOpenTabs(settings, timer);
  });
});

const handlers = {
  // A focus session started by hand belongs to the task or skill it names, or to neither.
  'timer:start': (msg) => {
    const manualFocus = (msg.phase || 'focus') === 'focus';
    return startPhase(msg.phase || 'focus', msg.task, msg.taskId, manualFocus ? (msg.skillId || null) : undefined);
  },
  'timer:pause': () => pause(),
  'timer:resume': () => resume(),
  'timer:stop': () => stop(),
  'timer:skip': () => skip(),
  'timer:get': async () => (await load()).timer,
  'research:op': (msg) => researchOp(msg.op, msg.args),
  'planner:op': (msg) => plannerOp(msg.op, msg.args),
  'earn:op': (msg) => earnOp(msg.op, msg.args),
  'research:scrollTo': async (msg) => {
    await injectHighlighter(msg.tabId, msg.url);
    await inTab(msg.tabId, (hs) => window.__orisHL.sync(hs), [highlightsForUrl(mergeResearch((await chrome.storage.local.get(RESEARCH_KEY))[RESEARCH_KEY]), msg.url)]);
    return inTab(msg.tabId, (i) => window.__orisHL.scrollTo(i), [msg.id]);
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const fn = msg && handlers[msg.type];
  if (!fn) return false;
  // Timer and research replies share one shape: { ok, timer?, result? }
  const run = msg.type === 'research:scrollTo' ? fn(msg) : serial(() => fn(msg));
  run
    .then((value) => sendResponse(/^(research|planner|earn):/.test(msg.type) ? { ok: true, result: value } : { ok: true, timer: value }))
    .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
  return true; // async response
});

// Worker may wake for any event; make sure nothing was missed.
serial(reconcile);

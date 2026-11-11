// Planner data shared by the New Tab page and the side panel: today's focus line, tasks,
// quick notes and the mini-app dock. Like research data, every write goes through the
// service worker (applyPlannerOp) so the two pages and the timer never overwrite each other.
import { todayKey } from './defaults.js';

export const PLANNER_KEY = 'planner';
export const DOCK_APPS = [['calc', 'Calculator'], ['stopwatch', 'Stopwatch'], ['links', 'Links']];

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);

export function emptyPlanner() {
  return {
    daily: { date: '', text: '' },
    tasks: [],
    notes: [],
    summaries: {},
    dock: { apps: { calc: true, stopwatch: true, links: true }, links: [] },
  };
}

export function mergePlanner(raw) {
  const e = emptyPlanner();
  if (!raw || typeof raw !== 'object') return e;
  return {
    daily: raw.daily && typeof raw.daily === 'object' ? { date: clip(raw.daily.date, 10), text: clip(raw.daily.text, 140) } : e.daily,
    tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
    notes: Array.isArray(raw.notes) ? raw.notes : [],
    summaries: raw.summaries && typeof raw.summaries === 'object' ? raw.summaries : {},
    dock: {
      apps: { ...e.dock.apps, ...((raw.dock && raw.dock.apps) || {}) },
      links: Array.isArray(raw.dock && raw.dock.links) ? raw.dock.links : [],
    },
  };
}

// The daily focus line only counts on the day it was written.
export function dailyFocus(planner, now = new Date()) {
  return planner.daily.date === todayKey(now) ? planner.daily.text : '';
}

// Open tasks, plus tasks finished today (older finished tasks drop off the list).
export function visibleTasks(planner, now = new Date()) {
  const today = todayKey(now);
  return planner.tasks.filter((t) => !t.done || todayKey(new Date(t.doneAt)) === today);
}

// Notes for one focus session (keyed by its start time), or today's notes when no session runs.
export function sessionNotes(planner, sessionKey, now = new Date()) {
  if (sessionKey) return planner.notes.filter((n) => n.session === sessionKey);
  const today = todayKey(now);
  return planner.notes.filter((n) => todayKey(new Date(n.createdAt)) === today);
}

function needTask(state, id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) throw new Error('That task no longer exists.');
  return t;
}

function cleanUrl(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  if (!/^[a-z]+:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : '';
  } catch { return ''; }
}

export const PLANNER_OPS = {
  setDaily(state, { text }) {
    state.daily = { date: todayKey(), text: clip(text, 140).trim() };
    return state.daily;
  },

  addTask(state, { title }) {
    const clean = clip(title, 140).trim();
    if (!clean) throw new Error('Write the task first.');
    const t = { id: uid(), title: clean, done: false, createdAt: Date.now(), doneAt: null, sessions: 0, focusMs: 0 };
    state.tasks.push(t);
    if (state.tasks.length > 300) state.tasks = state.tasks.filter((x) => !x.done).concat(state.tasks.filter((x) => x.done).slice(-100));
    return t;
  },
  toggleTask(state, { id, done }) {
    const t = needTask(state, id);
    t.done = done == null ? !t.done : !!done;
    t.doneAt = t.done ? Date.now() : null;
    return t;
  },
  renameTask(state, { id, title }) {
    const clean = clip(title, 140).trim();
    if (!clean) throw new Error('A task needs a name.');
    needTask(state, id).title = clean;
    return true;
  },
  deleteTask(state, { id }) {
    state.tasks = state.tasks.filter((t) => t.id !== id);
    return true;
  },
  moveTask(state, { id, to }) {
    const from = state.tasks.findIndex((t) => t.id === id);
    if (from === -1) throw new Error('That task no longer exists.');
    const [t] = state.tasks.splice(from, 1);
    state.tasks.splice(Math.max(0, Math.min(state.tasks.length, to)), 0, t);
    return true;
  },
  // Called by the timer when a focus session on this task ends.
  logTaskFocus(state, { id, ms, completed }) {
    const t = state.tasks.find((x) => x.id === id);
    if (!t) return false;
    t.focusMs = (t.focusMs || 0) + Math.max(0, Math.round(ms || 0));
    if (completed) t.sessions = (t.sessions || 0) + 1;
    return true;
  },

  addNote(state, { text, session, task }) {
    const clean = clip(text, 2000).trim();
    if (!clean) throw new Error('Write the note first.');
    const n = { id: uid(), text: clean, createdAt: Date.now(), session: session || null, task: clip(task, 140) };
    state.notes.push(n);
    if (state.notes.length > 1000) state.notes = state.notes.slice(-1000);
    return n;
  },
  deleteNote(state, { id }) {
    state.notes = state.notes.filter((n) => n.id !== id);
    return true;
  },
  saveSummary(state, { key, points }) {
    state.summaries[clip(key, 40)] = { points: (points || []).map((p) => clip(p, 400)).slice(0, 8), at: Date.now() };
    const keys = Object.keys(state.summaries);
    if (keys.length > 200) delete state.summaries[keys[0]];
    return true;
  },

  setDockApp(state, { app, on }) {
    if (!DOCK_APPS.some(([k]) => k === app)) throw new Error('Unknown app.');
    state.dock.apps[app] = !!on;
    return true;
  },
  addLink(state, { title, url }) {
    const clean = cleanUrl(url);
    if (!clean) throw new Error('Enter a web address, for example nptel.ac.in');
    if (state.dock.links.length >= 12) throw new Error('You can pin up to 12 links.');
    const l = { id: uid(), url: clean, title: clip(title, 40).trim() || new URL(clean).hostname.replace(/^www\./, '') };
    state.dock.links.push(l);
    return l;
  },
  deleteLink(state, { id }) {
    state.dock.links = state.dock.links.filter((l) => l.id !== id);
    return true;
  },
};

export function applyPlannerOp(state, op, args = {}) {
  const fn = PLANNER_OPS[op];
  if (!fn) throw new Error(`Unknown planner action: ${op}`);
  return fn(state, args);
}

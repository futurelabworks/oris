// Earn mode data: clients and work time, income, job and gig applications, skills with
// milestones. Like research and planner data, every write goes through the service worker.
import { todayKey } from './defaults.js';

export const EARN_KEY = 'earn';
export const INCOME_CATEGORIES = [['freelance', 'Freelance'], ['gig', 'Gig'], ['job', 'Job or internship'], ['affiliate', 'Affiliate'], ['content', 'Content'], ['other', 'Other']];
export const JOB_STAGES = [['saved', 'Saved'], ['applied', 'Applied'], ['interview', 'Interview'], ['offer', 'Offer'], ['rejected', 'Not selected']];
export const JOB_KINDS = [['job', 'Job'], ['internship', 'Internship'], ['gig', 'Gig'], ['freelance', 'Freelance project']];

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
const money = (v) => {
  const n = Math.round(Number(String(v).replace(/[,₹\s]/g, '')) * 100) / 100;
  return Number.isFinite(n) ? n : NaN;
};
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

export function emptyEarn() {
  return { currency: 'INR', privacy: false, clients: [], work: null, entries: [], income: [], jobs: [], skills: [], seenBadges: [] };
}

export function mergeEarn(raw) {
  const e = emptyEarn();
  if (!raw || typeof raw !== 'object') return e;
  for (const k of ['clients', 'entries', 'income', 'jobs', 'skills', 'seenBadges']) e[k] = Array.isArray(raw[k]) ? raw[k] : [];
  e.currency = /^[A-Z]{3}$/.test(raw.currency || '') ? raw.currency : 'INR';
  e.privacy = !!raw.privacy;
  e.work = raw.work && raw.work.startedAt ? raw.work : null;
  return e;
}

function need(list, id, what) {
  const x = list.find((i) => i.id === id);
  if (!x) throw new Error(`That ${what} no longer exists.`);
  return x;
}

function minutesBetween(a, b) {
  return Math.max(0, Math.round((b - a) / 60000));
}

export const EARN_OPS = {
  setPrefs(state, { currency, privacy }) {
    if (currency !== undefined) {
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Choose a currency.');
      state.currency = currency;
    }
    if (privacy !== undefined) state.privacy = !!privacy;
    return true;
  },

  // ---- clients + work timer ----
  addClient(state, { name, rate }) {
    const clean = clip(name, 80).trim();
    if (!clean) throw new Error('Give the client or project a name.');
    const r = rate === '' || rate == null ? 0 : money(rate);
    if (!Number.isFinite(r) || r < 0) throw new Error('Enter the hourly rate as a number, for example 500.');
    const c = { id: uid(), name: clean, rate: r, archived: false, createdAt: Date.now() };
    state.clients.push(c);
    return c;
  },
  updateClient(state, { id, patch }) {
    const c = need(state.clients, id, 'client');
    if ('name' in patch) { const n = clip(patch.name, 80).trim(); if (!n) throw new Error('Give the client a name.'); c.name = n; }
    if ('rate' in patch) { const r = money(patch.rate || 0); if (!Number.isFinite(r) || r < 0) throw new Error('Enter the hourly rate as a number.'); c.rate = r; }
    if ('archived' in patch) c.archived = !!patch.archived;
    return c;
  },
  startWork(state, { clientId, note }, now = Date.now()) {
    need(state.clients, clientId, 'client');
    if (state.work) throw new Error('A work timer is already running. Stop it first.');
    state.work = { clientId, note: clip(note, 140).trim(), startedAt: now };
    return state.work;
  },
  stopWork(state, _args, now = Date.now()) {
    const w = state.work;
    if (!w) throw new Error('No work timer is running.');
    state.work = null;
    const minutes = minutesBetween(w.startedAt, now);
    if (minutes < 1) return null; // under a minute: nothing to log
    const c = state.clients.find((x) => x.id === w.clientId);
    const e = { id: uid(), clientId: w.clientId, start: w.startedAt, minutes, note: w.note, rate: c ? c.rate : 0 };
    state.entries.unshift(e);
    return e;
  },
  addEntry(state, { clientId, date, minutes, note }) {
    const c = need(state.clients, clientId, 'client');
    const m = Math.round(Number(minutes));
    if (!(m >= 1 && m <= 24 * 60)) throw new Error('Enter the time worked in minutes (1 to 1440).');
    if (!isDate(date)) throw new Error('Pick the date you worked.');
    const e = { id: uid(), clientId, start: new Date(`${date}T09:00:00`).getTime(), minutes: m, note: clip(note, 140).trim(), rate: c.rate };
    state.entries.unshift(e);
    state.entries.sort((a, b) => b.start - a.start);
    return e;
  },
  deleteEntry(state, { id }) {
    state.entries = state.entries.filter((e) => e.id !== id);
    return true;
  },

  // ---- income ----
  addIncome(state, { amount, date, source, category, clientId, paid, passive, note }) {
    const a = money(amount);
    if (!(a > 0)) throw new Error('Enter the amount, for example 2500.');
    if (!isDate(date)) throw new Error('Pick the date.');
    const src = clip(source, 80).trim() || (clientId && (state.clients.find((c) => c.id === clientId) || {}).name) || '';
    if (!src) throw new Error('Say where the money came from, for example a client or platform.');
    const i = {
      id: uid(), amount: a, date, source: src,
      category: INCOME_CATEGORIES.some(([k]) => k === category) ? category : 'other',
      clientId: clientId || null, paid: paid !== false, passive: !!passive, note: clip(note, 200).trim(),
      createdAt: Date.now(),
    };
    state.income.push(i);
    state.income.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : y.createdAt - x.createdAt));
    return i;
  },
  markPaid(state, { id, paid = true }) {
    need(state.income, id, 'income entry').paid = !!paid;
    return true;
  },
  deleteIncome(state, { id }) {
    state.income = state.income.filter((i) => i.id !== id);
    return true;
  },

  // ---- jobs and gigs ----
  addJob(state, { company, role, kind, link, followUp, stage }) {
    const c = clip(company, 80).trim();
    const r = clip(role, 100).trim();
    if (!c && !r) throw new Error('Enter the company or the role.');
    let url = clip(link, 500).trim();
    if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
    const j = {
      id: uid(), company: c, role: r,
      kind: JOB_KINDS.some(([k]) => k === kind) ? kind : 'job',
      stage: JOB_STAGES.some(([k]) => k === stage) ? stage : 'saved',
      link: url, followUp: isDate(followUp) ? followUp : '', notes: '',
      createdAt: Date.now(), appliedAt: stage === 'applied' ? Date.now() : null, notifiedOn: '',
    };
    state.jobs.unshift(j);
    return j;
  },
  updateJob(state, { id, patch }) {
    const j = need(state.jobs, id, 'application');
    if ('stage' in patch && JOB_STAGES.some(([k]) => k === patch.stage)) {
      j.stage = patch.stage;
      if (patch.stage === 'applied' && !j.appliedAt) j.appliedAt = Date.now();
    }
    if ('followUp' in patch) { j.followUp = isDate(patch.followUp) ? patch.followUp : ''; j.notifiedOn = ''; }
    if ('notes' in patch) j.notes = clip(patch.notes, 2000);
    if ('company' in patch) j.company = clip(patch.company, 80).trim();
    if ('role' in patch) j.role = clip(patch.role, 100).trim();
    if ('notifiedOn' in patch) j.notifiedOn = clip(patch.notifiedOn, 10);
    return j;
  },
  deleteJob(state, { id }) {
    state.jobs = state.jobs.filter((j) => j.id !== id);
    return true;
  },

  // ---- skills ----
  addSkill(state, { name, goal }) {
    const n = clip(name, 60).trim();
    if (!n) throw new Error('Name the skill, for example Python or Video editing.');
    const s = { id: uid(), name: n, goal: clip(goal, 140).trim(), milestones: [], focusMs: 0, createdAt: Date.now() };
    state.skills.push(s);
    return s;
  },
  deleteSkill(state, { id }) {
    state.skills = state.skills.filter((s) => s.id !== id);
    return true;
  },
  addMilestone(state, { skillId, title, link }) {
    const s = need(state.skills, skillId, 'skill');
    const t = clip(title, 140).trim();
    if (!t) throw new Error('Describe the step, for example "Finish the Python basics course".');
    let url = clip(link, 500).trim();
    if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
    const m = { id: uid(), title: t, link: url, done: false, doneAt: null };
    s.milestones.push(m);
    return m;
  },
  toggleMilestone(state, { skillId, id }) {
    const m = need(need(state.skills, skillId, 'skill').milestones, id, 'step');
    m.done = !m.done;
    m.doneAt = m.done ? Date.now() : null;
    return m;
  },
  deleteMilestone(state, { skillId, id }) {
    const s = need(state.skills, skillId, 'skill');
    s.milestones = s.milestones.filter((m) => m.id !== id);
    return true;
  },
  // Called by the timer when a focus session started from a skill ends.
  logSkillFocus(state, { id, ms }) {
    const s = state.skills.find((x) => x.id === id);
    if (!s) return false;
    s.focusMs = (s.focusMs || 0) + Math.max(0, Math.round(ms || 0));
    return true;
  },

  markBadgesSeen(state, { ids }) {
    state.seenBadges = [...new Set([...state.seenBadges, ...(ids || []).map((x) => clip(x, 40))])];
    return true;
  },
};

export function applyEarnOp(state, op, args = {}) {
  const fn = EARN_OPS[op];
  if (!fn) throw new Error(`Unknown earn action: ${op}`);
  return fn(state, args);
}

// ---------- numbers for the Overview ----------
export const monthKey = (d) => d.slice(0, 7); // 'YYYY-MM-DD' -> 'YYYY-MM'
const entryDate = (e) => todayKey(new Date(e.start));

export function earnSummary(state, now = new Date()) {
  const thisMonth = todayKey(now).slice(0, 7);
  const paid = state.income.filter((i) => i.paid);
  const monthIncome = paid.filter((i) => monthKey(i.date) === thisMonth).reduce((a, i) => a + i.amount, 0);
  const pending = state.income.filter((i) => !i.paid).reduce((a, i) => a + i.amount, 0);
  const monthEntries = state.entries.filter((e) => entryDate(e).slice(0, 7) === thisMonth);
  const monthMinutes = monthEntries.reduce((a, e) => a + e.minutes, 0);
  const billed = monthEntries.reduce((a, e) => a + (e.minutes / 60) * (e.rate || 0), 0);

  // Earnings per hour: paid income linked to clients over hours logged for those clients.
  const clientIds = new Set(state.entries.map((e) => e.clientId));
  const linkedIncome = paid.filter((i) => i.clientId && clientIds.has(i.clientId)).reduce((a, i) => a + i.amount, 0);
  const linkedMinutes = state.entries.filter((e) => paid.some((i) => i.clientId === e.clientId)).reduce((a, e) => a + e.minutes, 0);
  const perHour = linkedMinutes >= 30 ? linkedIncome / (linkedMinutes / 60) : null;

  // Last 6 months of paid income, oldest first.
  const months = [];
  for (let k = 5; k >= 0; k--) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push({ key, label: d.toLocaleDateString('en-IN', { month: 'short' }), total: paid.filter((i) => monthKey(i.date) === key).reduce((a, i) => a + i.amount, 0) });
  }

  const bySource = new Map();
  for (const i of paid) bySource.set(i.source, (bySource.get(i.source) || 0) + i.amount);
  const topSources = [...bySource.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([source, total]) => ({ source, total }));

  const today = todayKey(now);
  const followUps = state.jobs.filter((j) => j.followUp && j.followUp <= today && !['offer', 'rejected'].includes(j.stage));
  const activeJobs = state.jobs.filter((j) => !['rejected'].includes(j.stage)).length;
  const total = paid.reduce((a, i) => a + i.amount, 0);
  const passive = paid.filter((i) => i.passive).reduce((a, i) => a + i.amount, 0);

  return { monthIncome, pending, monthMinutes, billed, perHour, months, topSources, followUps, activeJobs, total, passiveShare: total ? passive / total : 0 };
}

export function clientTotals(state, clientId) {
  const es = state.entries.filter((e) => e.clientId === clientId);
  const minutes = es.reduce((a, e) => a + e.minutes, 0);
  const billed = es.reduce((a, e) => a + (e.minutes / 60) * (e.rate || 0), 0);
  return { minutes, billed };
}

// ---------- CSV ----------
const csvCell = (v) => {
  const s = String(v == null ? '' : v);
  // Leading = + - @ would run as a formula in Excel; quote and prefix them.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) || safe !== s ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

export function incomeCsv(state) {
  return toCsv([['Date', 'Source', 'Category', 'Amount', 'Currency', 'Paid', 'Passive', 'Note'],
    ...state.income.map((i) => [i.date, i.source, i.category, i.amount, state.currency, i.paid ? 'yes' : 'no', i.passive ? 'yes' : 'no', i.note])]);
}

export function workCsv(state) {
  const name = (id) => (state.clients.find((c) => c.id === id) || {}).name || '';
  return toCsv([['Date', 'Client', 'Minutes', 'Hours', 'Rate per hour', 'Amount', 'Note'],
    ...state.entries.map((e) => [entryDate(e), name(e.clientId), e.minutes, (e.minutes / 60).toFixed(2), e.rate || 0, ((e.minutes / 60) * (e.rate || 0)).toFixed(2), e.note])]);
}

export function formatMoney(n, currency = 'INR', hidden = false) {
  if (hidden) return currency === 'INR' ? '₹ •••' : '•••';
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
  } catch {
    return `${currency} ${Math.round(n)}`;
  }
}

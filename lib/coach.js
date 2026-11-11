// The Oris coach. It watches what the student actually does (the on-device log in the study store,
// daily totals, lecture quiz scores) and suggests small changes to the plan. It learns which kinds
// of tips this student takes: tips they wave away come back less often, three in a month mutes
// that kind, and tips they accept come up more readily.
//
// study.coach = {
//   tips: true, reminders: true,
//   share: false, guardian: false,           // opt-in anonymous data sharing (guardian consent for school students)
//   memory: { [type]: { shown, accepted, dismissed: [dayKeys] } },
//   snooze: { [suggestionId]: dayKey },       // don't show this exact tip again before this day
//   muted: { [type]: true },
//   notified: { [dayKey]: [kinds] },          // reminders already sent
//   reviews: { [weekKey]: { text, ai, at } },
//   uploadedAt: number,                       // last event shared (ms)
// }
// study.dayPlan = { [dayKey]: minutes planned that day } (recorded the first time the day is seen)
import { buildPlan, addDays, daysBetween, parseDay } from './study.js';
import { chatJSON } from './ai.js';

export const TIP_TYPES = {
  split: 'Split a topic you keep postponing',
  room: 'Make room before an exam',
  lighten: 'Lighter days',
  more: 'More study time',
  rewatch: 'Rewatch a lecture you found hard',
  streak: 'Keep your streak',
  restart: 'Welcome back',
};

export function coachOf(study) {
  return { tips: true, reminders: true, share: false, guardian: false, memory: {}, snooze: {}, muted: {}, notified: {}, reviews: {}, uploadedAt: 0, ...(study.coach || {}) };
}

// ---------- signals ----------
const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function plannedToday(study, syllabi, today) {
  const plan = buildPlan(study, syllabi, today);
  const day = plan.days.find((d) => d.date === today);
  return (day ? day.items.reduce((a, i) => a + i.minutes, 0) : 0) + (Number((study.dayDone || {})[today]) || 0);
}

// Remember how much was planned for today (the first time today is seen).
export function recordDayPlan(study, syllabi, today) {
  study.dayPlan = study.dayPlan || {};
  if (study.dayPlan[today] == null) study.dayPlan[today] = plannedToday(study, syllabi, today);
  for (const d of Object.keys(study.dayPlan)) if (d < addDays(today, -30)) delete study.dayPlan[d];
  return study;
}

// Share of planned minutes actually done over the last `n` finished days that had work planned.
export function completion(study, today, n = 3) {
  const days = Object.keys(study.dayPlan || {}).filter((d) => d < today && study.dayPlan[d] > 0).sort().slice(-n);
  if (days.length < n) return null;
  const planned = days.reduce((a, d) => a + study.dayPlan[d], 0);
  const done = days.reduce((a, d) => a + (Number((study.dayDone || {})[d]) || 0), 0);
  return planned ? done / planned : null;
}

// Days in a row (ending yesterday, or today if something is done today) with planned work done.
export function streak(study, today) {
  const done = study.dayDone || {};
  let n = 0;
  let d = done[today] > 0 ? today : addDays(today, -1);
  while (done[d] > 0) { n++; d = addDays(d, -1); }
  return n;
}

export function lastActive(study) {
  const days = Object.keys(study.dayDone || {}).filter((d) => study.dayDone[d] > 0).sort();
  return days.at(-1) || null;
}

// The hour the student usually gets work done (needs a few data points).
export function usualHour(study, now = Date.now()) {
  const counts = new Array(24).fill(0);
  for (const e of study.log || []) {
    if (now - e.at > 21 * 864e5) continue;
    if (e.kind === 'item.done' || e.kind === 'lecture.done' || e.kind === 'lecture.note') counts[new Date(e.at).getHours()]++;
  }
  const total = counts.reduce((a, b) => a + b, 0);
  if (total < 5) return null;
  return counts.indexOf(Math.max(...counts));
}

// ---------- suggestions ----------
// Each: { id, type, title, body, actions: [{ label, apply: {...} }], weight }
export function suggestions(study, syllabi, lectures, today, now = Date.now()) {
  const c = coachOf(study);
  if (!c.tips || !study.setupDone) return [];
  const plan = buildPlan(study, syllabi, today);
  const out = [];
  const titleOf = (id) => { for (const y of syllabi) for (const u of y.units) for (const t of u.topics) if (t.id === id) return t.title; return ''; };
  const learned = (id) => { for (const y of syllabi) for (const u of y.units) for (const t of u.topics) if (t.id === id) return !!t.done; return true; };
  const p = study.prefs;

  // 1. A topic pushed to "tomorrow" twice or more in two weeks → split it.
  const later = {};
  for (const e of study.log || []) if (e.kind === 'item.later' && e.data && e.data.topicId && now - e.at < 14 * 864e5) later[e.data.topicId] = (later[e.data.topicId] || 0) + 1;
  for (const [topicId, n] of Object.entries(later)) {
    const ov = study.overrides[topicId] || {};
    if (n < 2 || ov.skip || (ov.parts || 1) > 1 || learned(topicId)) continue;
    const t = titleOf(topicId);
    if (!t) continue;
    out.push({
      id: `split:${topicId}`, type: 'split', weight: 3 + n,
      title: `“${t}” keeps moving to tomorrow`,
      body: 'Big topics are easier to start in small pieces. Split it into shorter parts across a few days?',
      actions: [{ label: 'Split into 2 parts', apply: { kind: 'split', topicId, parts: 2 } }, { label: 'Split into 3', apply: { kind: 'split', topicId, parts: 3 } }],
    });
  }

  // 2. Work that doesn't fit before an exam → more time, or drop the lowest-priority topics.
  const tight = plan.dropped.filter((d) => !d.skipped);
  if (tight.length) {
    const actions = [];
    if (p.minutesPerDay < 480) actions.push({ label: `Study ${fmtMin(p.minutesPerDay + 30)} a day`, apply: { kind: 'prefs', patch: { minutesPerDay: p.minutesPerDay + 30 } } });
    actions.push({ label: `Skip the ${tight.length === 1 ? 'lowest-priority topic' : `${tight.length} lowest-priority topics`}`, apply: { kind: 'skip', topicIds: tight.map((d) => d.topicId) } });
    if ((p.revisionDays || 0) > 1) actions.push({ label: 'One revision day less', apply: { kind: 'prefs', patch: { revisionDays: p.revisionDays - 1 } } });
    out.push({
      id: `room:${tight.length}`, type: 'room', weight: 6,
      title: `${tight.length} topic${tight.length === 1 ? '' : 's'} won’t fit before the exam`,
      body: `They’re the lowest priority (least asked, fewest marks): ${tight.slice(0, 3).map((d) => d.title).join(', ')}${tight.length > 3 ? '…' : ''}. Choose what to do:`,
      actions,
    });
  }

  // 3/4. Doing much less, or much more, than planned.
  const rate = completion(study, today);
  if (rate != null && rate < 0.4 && p.minutesPerDay > 60) {
    const to = Math.max(60, p.minutesPerDay - 30 * Math.ceil((1 - rate) * 2));
    out.push({
      id: `lighten:${to}`, type: 'lighten', weight: 5,
      title: 'Your days have been too full',
      body: `You finished about ${Math.round(rate * 100)}% of the plan over the last 3 days. A plan you actually finish beats a perfect one. Try ${fmtMin(to)} a day for now?`,
      actions: [{ label: `Plan ${fmtMin(to)} a day`, apply: { kind: 'prefs', patch: { minutesPerDay: to } } }],
    });
  } else if (rate != null && rate > 1.25 && p.minutesPerDay < 480) {
    out.push({
      id: `more:${p.minutesPerDay + 30}`, type: 'more', weight: 2,
      title: 'You’re ahead of your plan',
      body: `You did ${Math.round(rate * 100)}% of the planned work over the last 3 days. Plan a bit more each day and finish earlier, with extra time to revise?`,
      actions: [{ label: `Plan ${fmtMin(p.minutesPerDay + 30)} a day`, apply: { kind: 'prefs', patch: { minutesPerDay: p.minutesPerDay + 30 } } }],
    });
  }

  // 5. Low practice score on a lecture → revise that topic.
  for (const [videoId, q] of Object.entries((lectures && lectures.quiz) || {})) {
    if (!q || q.best == null || q.best >= 3) continue;
    const topicId = Object.keys((lectures && lectures.videos) || {}).find((t) => lectures.videos[t].videoId === videoId);
    if (!topicId) continue;
    const t = titleOf(topicId);
    if (!t) continue;
    out.push({
      id: `rewatch:${topicId}`, type: 'rewatch', weight: 4,
      title: `“${t}” needs another look`,
      body: `Your best practice score was ${q.best}/5. Rewatch your pinned parts and add it to revision so it comes up again before the exam.`,
      actions: [{ label: 'Add to revision', apply: { kind: 'revise', topicId } }],
    });
  }

  // 6. Evening, nothing done yet, a streak to protect.
  const s = streak(study, today);
  const hour = new Date(now).getHours();
  if (s >= 2 && !(Number((study.dayDone || {})[today]) > 0) && hour >= 17) {
    const first = (plan.days.find((d) => d.date === today) || { items: [] }).items[0];
    out.push({
      id: `streak:${today}`, type: 'streak', weight: 7,
      title: `Keep your ${s}-day streak`,
      body: first ? `Just one thing tonight keeps it going: ${first.title} (${fmtMin(first.minutes)}).` : 'Do one short task tonight to keep it going.',
      actions: first ? [{ label: 'Start it now', apply: { kind: 'focus', task: first.title } }] : [],
    });
  }

  // 7. Away for 3+ days → a gentle restart.
  const last = lastActive(study);
  if (last && daysBetween(last, today) >= 3 && p.minutesPerDay > 60) {
    out.push({
      id: `restart:${last}`, type: 'restart', weight: 6,
      title: 'Welcome back',
      body: `It’s been ${daysBetween(last, today)} days. The plan has already moved missed work forward. Start gently: a lighter plan for now?`,
      actions: [{ label: 'Plan 1 hour a day', apply: { kind: 'prefs', patch: { minutesPerDay: 60 } } }],
    });
  }

  // Learning: muted types never show; snoozed tips wait; each recent dismissal halves the weight,
  // each acceptance raises it a little.
  return out
    .filter((x) => !c.muted[x.type] && !(c.snooze[x.id] && c.snooze[x.id] > today))
    .map((x) => {
      const m = c.memory[x.type] || {};
      const recent = (m.dismissed || []).filter((d) => d >= addDays(today, -30)).length;
      return { ...x, weight: x.weight * 0.5 ** recent * Math.min(1.6, 1 + 0.1 * (m.accepted || 0)) };
    })
    .filter((x) => x.weight >= 1)
    .sort((a, b) => b.weight - a.weight);
}

// Apply an accepted tip to a study copy (and syllabi for "revise"). Returns { study, syllabi, focus }.
export function applyTip(study, syllabi, tip, action, today) {
  const a = action.apply;
  let focus = null;
  if (a.kind === 'split') study.overrides[a.topicId] = { ...(study.overrides[a.topicId] || {}), parts: a.parts, notBefore: '' };
  else if (a.kind === 'prefs') study.prefs = { ...study.prefs, ...a.patch };
  else if (a.kind === 'skip') for (const id of a.topicIds) study.overrides[id] = { ...(study.overrides[id] || {}), skip: true };
  else if (a.kind === 'revise') syllabi = syllabi.map((y) => ({ ...y, units: y.units.map((u) => ({ ...u, topics: u.topics.map((t) => (t.id === a.topicId ? { ...t, revise: true } : t)) })) }));
  else if (a.kind === 'focus') focus = a.task;
  remember(study, tip, 'accepted', today);
  return { study, syllabi, focus };
}

export function dismissTip(study, tip, today) {
  remember(study, tip, 'dismissed', today);
  const c = coachOf(study);
  c.snooze[tip.id] = addDays(today, 3);
  const m = c.memory[tip.type];
  // Three dismissals of the same kind in a month: stop showing that kind.
  if ((m.dismissed || []).filter((d) => d >= addDays(today, -30)).length >= 3) c.muted[tip.type] = true;
  study.coach = c;
  return study;
}

function remember(study, tip, what, today) {
  const c = coachOf(study);
  const m = { shown: 0, accepted: 0, dismissed: [], ...(c.memory[tip.type] || {}) };
  if (what === 'accepted') m.accepted++;
  else m.dismissed = [...m.dismissed, today].slice(-10);
  c.memory[tip.type] = m;
  study.coach = c;
  return study;
}

// ---------- weekly review ----------
export const weekKey = (today) => { const d = parseDay(today); const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dayOf(mon.getTime()); };

export function weekStats(study, lectures, today, now = Date.now()) {
  const from = addDays(today, -6);
  const days = [];
  for (let d = from; d <= today; d = addDays(d, 1)) days.push(d);
  const minutes = days.reduce((a, d) => a + (Number((study.dayDone || {})[d]) || 0), 0);
  const planned = days.reduce((a, d) => a + (Number((study.dayPlan || {})[d]) || 0), 0);
  const inWeek = (e) => now - e.at < 7 * 864e5;
  const log = (study.log || []).filter(inWeek);
  const items = log.filter((e) => e.kind === 'item.done').length;
  const lecturesDone = log.filter((e) => e.kind === 'lecture.done').length;
  const notes = log.filter((e) => e.kind === 'lecture.note' || e.kind === 'lecture.pin').length;
  const postponed = log.filter((e) => e.kind === 'item.later').length;
  const best = days.reduce((b, d) => ((Number((study.dayDone || {})[d]) || 0) > ((study.dayDone || {})[b] || 0) ? d : b), days[0]);
  const activeDays = days.filter((d) => (study.dayDone || {})[d] > 0).length;
  const points = ((lectures && lectures.points && lectures.points.log) || []).filter((l) => now - l.at < 7 * 864e5).reduce((a, l) => a + l.pts, 0);
  return { from, to: today, minutes, planned, items, lectures: lecturesDone, notes, postponed, activeDays, bestDay: (study.dayDone || {})[best] > 0 ? best : null, streak: streak(study, today), points };
}

export function reviewText(w, name = '') {
  const hi = name ? `${name}, ` : '';
  if (!w.minutes && !w.items) return `${hi}this week was quiet. That’s okay. Pick one small task today and the plan will carry you from there.`;
  const pct = w.planned ? Math.round((w.minutes / w.planned) * 100) : null;
  const parts = [`${hi}you studied ${fmtMin(w.minutes)} this week on ${w.activeDays} day${w.activeDays === 1 ? '' : 's'}${pct != null ? ` (${pct}% of the plan)` : ''}.`];
  if (w.lectures) parts.push(`You finished ${w.lectures} lecture${w.lectures === 1 ? '' : 's'}${w.notes ? ` and wrote ${w.notes} notes` : ''}.`);
  if (w.streak >= 3) parts.push(`You’re on a ${w.streak}-day streak. Keep it going.`);
  if (w.postponed >= 3) parts.push(`You moved ${w.postponed} tasks to tomorrow. Splitting big topics into smaller parts can help.`);
  else if (pct != null && pct >= 90) parts.push('You’re right on plan. Great consistency.');
  return parts.join(' ');
}

export async function aiReview(w, profile, settings) {
  const content = await chatJSON({
    task: 'coach',
    temperature: 0.6,
    messages: [
      { role: 'system', content: 'You are a warm, honest study coach for a student. Use only the numbers given. No guilt, no exaggeration, no emojis. Reply with JSON only.' },
      { role: 'user', content: `Student: ${profile.name || 'the student'} (${profile.level || 'student'}).\nThis week: ${JSON.stringify(w)}\nWrite a short weekly review: 3 to 4 sentences that name one real win, one thing to adjust, and one concrete action for next week.\nReturn exactly: {"review": "<text>"}` },
    ],
  }, settings);
  let parsed;
  try { parsed = JSON.parse(content); } catch { throw new Error('The AI reply wasn’t valid JSON.'); }
  const text = String(parsed.review || '').trim();
  if (text.length < 20) throw new Error('The AI didn’t write a review. Try again.');
  return text.slice(0, 900);
}

// ---------- reminders (run from the background) ----------
// Returns the reminder to send now, or null. `notified` records what was sent today.
export function reminderNow(study, syllabi, now = Date.now()) {
  const c = coachOf(study);
  if (!study.setupDone || !c.reminders) return null;
  const today = dayOf(now);
  const sent = c.notified[today] || [];
  const doneToday = Number((study.dayDone || {})[today]) > 0;
  if (doneToday || sent.length) return null; // at most one reminder a day
  const hour = new Date(now).getHours();
  const plan = buildPlan(study, syllabi, today);
  const first = (plan.days.find((d) => d.date === today) || { items: [] }).items[0];
  if (!first) return null;
  const usual = usualHour(study, now);
  if (usual != null && hour === usual && !sent.includes('usual')) {
    return { kind: 'usual', title: 'Your usual study time', message: `Today starts with: ${first.title} (${fmtMin(first.minutes)}).` };
  }
  const s = streak(study, today);
  if (s >= 2 && hour >= 20 && hour < 22 && !sent.includes('streak')) {
    return { kind: 'streak', title: `Keep your ${s}-day streak`, message: `One task tonight keeps it going: ${first.title}.` };
  }
  return null;
}

// ---------- sharing (opt-in) ----------
const SHARE_KINDS = new Set(['item.done', 'item.undone', 'item.later', 'topic.skip', 'topic.unskip', 'topic.minutes', 'dep.remove', 'prefs.minutes', 'prefs.rest', 'prefs.revision', 'subject.exam', 'subject.importance', 'subject.marks', 'setup.done', 'ai.order', 'lecture.done', 'lecture.note', 'lecture.pin', 'lecture.quiz', 'coach.accept', 'coach.dismiss']);
// Strip everything that could say who the student is: no titles, names, ids or free text,
// only the kind of event, the day, the hour and small numbers / known labels.
export function sanitizeEvents(log, { since = 0, level = '' } = {}) {
  return (log || []).filter((e) => e.at > since && SHARE_KINDS.has(e.kind)).slice(-500).map((e) => {
    const d = {};
    for (const [k, v] of Object.entries(e.data || {})) {
      if (typeof v === 'number' && Number.isFinite(v)) d[k] = Math.round(v * 100) / 100;
      else if (typeof v === 'boolean') d[k] = v;
      else if (k === 'kind' && ['learn', 'practice', 'pyq', 'revise', 'mock'].includes(v)) d[k] = v;
      else if (k === 'type' && Object.keys(TIP_TYPES).includes(v)) d[k] = v;
    }
    const t = new Date(e.at);
    return { kind: e.kind, day: dayOf(e.at), hour: t.getHours(), level: ['school', 'college', 'competitive'].includes(level) ? level : '', data: d };
  });
}

export const canShare = (study) => { const c = coachOf(study); return c.share && (study.profile.level !== 'school' || c.guardian); };

export function fmtMin(m) { return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`; }

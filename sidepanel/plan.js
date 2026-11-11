// Study → Plan: today's work, goals and sub-goals per subject, the next days, what didn't fit,
// and plan settings. The plan is recalculated on every change (see lib/study.js).
import { hasAI } from '../lib/ai.js';
import { todayKey } from '../lib/defaults.js';
import { videoForTopic } from '../lib/lectures.js';
import {
  suggestions, applyTip, dismissTip, coachOf, recordDayPlan, weekKey, weekStats, reviewText, aiReview, TIP_TYPES,
} from '../lib/coach.js';
import {
  buildPlan, feasibility, aiTopicOrder, subjectColor, addDays, niceDay, daysBetween, IMPORTANCE, DAY_NAMES, LEVELS,
} from '../lib/study.js';

const KIND_LABEL = { learn: 'Learn', practice: 'Practice', pyq: 'Past questions', revise: 'Revise', mock: 'Mock test' };
const hm = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);

export function mount(root, ctx) {
  const { el, state, saveStudy, saveSyllabi, send, toast, open, openPlayer } = ctx;
  const body = el('div', { class: 'plan' });
  root.append(body);
  const openMenus = new Set();
  let busy = '';

  const S = () => state.study;
  const topicIndex = () => {
    const m = new Map();
    for (const y of state.syllabi) for (const u of y.units) for (const t of u.topics) m.set(t.id, { t, syl: y });
    return m;
  };

  // ---------- actions (each one is logged on this device) ----------
  async function setDone(item, done) {
    const today = todayKey();
    // A split topic is learned when its last part is done.
    const partsLeft = item.parts > 1 ? Array.from({ length: item.parts }, (_, i) => `learnpart:${item.topicId}:${i + 1}`).filter((k) => k !== item.key && !state.study.progress[k]).length : 0;
    if (item.kind === 'learn' && (!item.parts || item.parts === 1 || (done && partsLeft === 0))) {
      await saveSyllabi(state.syllabi.map((y) => (y.id !== item.syllabusId ? y : { ...y, units: y.units.map((u) => ({ ...u, topics: u.topics.map((t) => (t.id === item.topicId ? { ...t, done } : t)) })) })));
    }
    await saveStudy((st) => {
      if (done) { st.progress[item.key] = today; st.dayDone = { ...(st.dayDone || {}), [today]: ((st.dayDone || {})[today] || 0) + item.minutes }; } else delete st.progress[item.key];
      // keep a month of daily totals
      for (const d of Object.keys(st.dayDone || {})) if (d < addDays(today, -30)) delete st.dayDone[d];
      return st;
    }, { kind: done ? 'item.done' : 'item.undone', data: { kind: item.kind, topicId: item.topicId || null, minutes: item.minutes, part: item.part || 0 } });
    if (done) toast('Done. Nice work.');
  }
  const later = (item) => saveStudy((st) => { st.overrides[item.topicId] = { ...(st.overrides[item.topicId] || {}), notBefore: addDays(todayKey(), 1) }; return st; }, { kind: 'item.later', data: { kind: item.kind, topicId: item.topicId } });
  const skipTopic = (topicId, skip) => saveStudy((st) => { st.overrides[topicId] = { ...(st.overrides[topicId] || {}), skip }; if (!skip) delete st.overrides[topicId].skip; return st; }, { kind: skip ? 'topic.skip' : 'topic.unskip', data: { topicId } });
  const resize = (item, delta) => saveStudy((st) => {
    const cur = (st.overrides[item.topicId] || {}).minutes || item.minutes;
    st.overrides[item.topicId] = { ...(st.overrides[item.topicId] || {}), minutes: Math.max(15, Math.min(360, cur + delta)) };
    return st;
  }, { kind: 'topic.minutes', data: { topicId: item.topicId, delta } });
  const dropDep = (topicId, dep) => saveStudy((st) => { st.deps[topicId] = (st.deps[topicId] || []).filter((d) => d !== dep); if (!st.deps[topicId].length) delete st.deps[topicId]; return st; }, { kind: 'dep.remove', data: { topicId, dep } });
  const subjPatch = (id, patch, kind) => saveStudy((st) => { const s = st.subjects.find((x) => x.id === id); if (s) Object.assign(s, patch); return st; }, { kind, data: { subjectId: id, ...patch } });
  const prefPatch = (patch, kind) => saveStudy((st) => { st.prefs = { ...st.prefs, ...patch }; return st; }, { kind, data: patch });

  async function focusOn(item) {
    if (await send({ type: 'timer:start', phase: 'focus', task: item.title, taskId: null })) toast(`Focus started: ${item.title}`);
  }

  async function reorder() {
    if (!hasAI(state.settings)) { toast('Topic order needs AI. Turn on Oris AI in Settings.', 'error'); return; }
    for (const s of S().subjects) {
      const syl = state.syllabi.find((y) => y.id === s.syllabusId);
      if (!syl) continue;
      busy = `Working out the topic order for ${s.name}…`; render();
      try {
        const { deps, hours } = await aiTopicOrder(s.name, syl, state.settings);
        const ids = new Set(syl.units.flatMap((u) => u.topics.map((t) => t.id)));
        await saveStudy((st) => {
          for (const id of Object.keys(st.deps)) if (ids.has(id)) delete st.deps[id];
          Object.assign(st.deps, deps); Object.assign(st.hours, hours); return st;
        }, { kind: 'ai.order', data: { subjectId: s.id, links: Object.keys(deps).length } });
      } catch (e) { toast(`${s.name}: ${e.message}`, 'error'); }
    }
    busy = '';
    render();
  }

  // ---------- pieces ----------
  function itemRow(item, { today = false, names } = {}) {
    const st = S();
    const done = item.kind === 'learn' ? false : !!st.progress[item.key];
    const menu = openMenus.has(item.key);
    const sub = st.subjects.find((s) => s.id === item.subjectId);
    const deps = (item.after || []).map((id) => ({ id, name: (names.get(id) || {}).t?.title })).filter((d) => d.name);
    const topicTitle = item.title.replace(/^[^:]+:\s*/, '');
    return el('li', { class: `plan-item kind-${item.kind}${done ? ' done' : ''}`, style: { '--subj': subjectColor(st, item.subjectId) } },
      el('label', { class: 'plan-check' },
        el('input', { type: 'checkbox', checked: done, 'aria-label': `Done: ${item.title}`, onchange: (e) => setDone(item, e.target.checked) }),
        el('span', { class: 'plan-text' },
          el('span', { class: 'plan-kind' }, KIND_LABEL[item.kind] || item.kind, sub ? el('span', { class: 'plan-subj' }, sub.name) : null),
          el('span', { class: 'plan-title' }, item.kind === 'learn' || item.kind === 'practice' || item.kind === 'pyq' ? topicTitle : item.title),
          deps.length ? el('span', { class: 'plan-deps' }, 'After ', ...deps.map((d, i) => el('span', { class: 'dep' }, d.name, el('button', { class: 'dep-x', 'aria-label': `Don’t require ${d.name} first`, title: 'Remove this order rule', onclick: (e) => { e.preventDefault(); dropDep(item.topicId, d.id); } }, '×'), i < deps.length - 1 ? ', ' : ''))) : null)),
      el('span', { class: 'plan-min' }, hm(item.minutes)),
      today ? el('div', { class: 'plan-actions' },
        el('button', { class: 'btn small', onclick: () => focusOn(item) }, 'Focus'),
        item.kind === 'learn' ? lectureButton(item, names) : null,
        item.kind === 'pyq' || item.kind === 'mock' || item.kind === 'revise' ? el('button', { class: 'btn ghost small', onclick: () => open('syllabus', { id: item.syllabusId, tab: 'exam' }) }, 'Exam prep') : null,
        item.topicId ? el('button', { class: 'btn ghost small', 'aria-expanded': String(menu), onclick: () => { if (menu) openMenus.delete(item.key); else openMenus.add(item.key); render(); } }, menu ? 'Close' : 'More') : null) : null,
      menu ? el('div', { class: 'plan-menu' },
        el('button', { class: 'btn ghost small', onclick: () => later(item) }, 'Do it tomorrow'),
        item.kind === 'learn' ? el('button', { class: 'btn ghost small', onclick: () => resize(item, 30) }, 'Needs more time (+30m)') : null,
        item.kind === 'learn' && item.minutes > 15 ? el('button', { class: 'btn ghost small', onclick: () => resize(item, -15) }, 'Shorter (−15m)') : null,
        el('button', { class: 'btn ghost small', onclick: () => skipTopic(item.topicId, true) }, 'Skip this topic')) : null);
  }

  // Play the topic's lecture in the Oris player, or go pick one.
  function lectureButton(item, names) {
    const t = (names.get(item.topicId) || {}).t;
    const v = t && state.lectures ? videoForTopic(state.lectures, t) : null;
    return v
      ? el('button', { class: 'btn ghost small', onclick: () => openPlayer({ videoId: v.videoId, topicId: item.topicId, syllabusId: item.syllabusId }) }, '▶ Lecture')
      : el('button', { class: 'btn ghost small', onclick: () => open('lectures') }, 'Find lecture');
  }

  // ---------- coach ----------
  const COACH_TIPS = 2;
  async function acceptTip(tip, action) {
    let focus = null;
    let newSyllabi = null;
    await saveStudy((st) => {
      const res = applyTip(st, state.syllabi, tip, action, todayKey());
      focus = res.focus;
      if (res.syllabi !== state.syllabi) newSyllabi = res.syllabi;
      return res.study;
    }, { kind: 'coach.accept', data: { type: tip.type, ...(action.apply.parts ? { parts: action.apply.parts } : {}), ...(action.apply.patch && action.apply.patch.minutesPerDay ? { minutes: action.apply.patch.minutesPerDay } : {}) } });
    if (newSyllabi) await saveSyllabi(newSyllabi);
    if (focus) await send({ type: 'timer:start', phase: 'focus', task: focus, taskId: null });
    toast(focus ? `Focus started: ${focus}` : 'Done. Your plan is updated.');
  }
  async function dismiss(tip) {
    await saveStudy((st) => dismissTip(st, tip, todayKey()), { kind: 'coach.dismiss', data: { type: tip.type } });
    const c = coachOf(state.study);
    toast(c.muted[tip.type] ? 'Got it. Oris won’t suggest that kind of change again (turn it back on in Plan settings).' : 'Okay, not now.');
  }

  function coachPanel() {
    const tips = suggestions(S(), state.syllabi, state.lectures, todayKey()).slice(0, COACH_TIPS);
    if (!tips.length) return null;
    return el('section', { class: 'panel coach', 'aria-label': 'Coach' },
      el('p', { class: 'coach-label' }, 'Coach'),
      ...tips.map((tip) => el('div', { class: `tip tip-${tip.type}` },
        el('p', { class: 'tip-title' }, tip.title),
        el('p', { class: 'tip-body' }, tip.body),
        el('div', { class: 'row wrap' },
          ...tip.actions.map((a, i) => el('button', { class: `btn small${i === 0 ? ' primary' : ''}`, onclick: () => acceptTip(tip, a) }, a.label)),
          el('button', { class: 'btn ghost small', onclick: () => dismiss(tip) }, 'Not now')))));
  }

  let reviewBusy = false;
  function reviewPanel() {
    const today = todayKey();
    const wk = weekKey(today);
    const c = coachOf(S());
    const saved = c.reviews[wk];
    if (saved && saved.hidden) return null;
    const w = weekStats(S(), state.lectures, today);
    // Show from Sunday, or any day once there's a week of history, if there's anything to review.
    const dow = new Date().getDay();
    const history = Object.keys(S().dayDone || {}).length + Object.keys(S().dayPlan || {}).length;
    if (!saved && !(dow === 0 || dow === 1) && history < 7) return null;
    if (!w.minutes && !w.items && !saved) return null;
    const ai = hasAI(state.settings);
    const save = (patch, kind) => saveStudy((st) => { const cc = coachOf(st); cc.reviews = { ...cc.reviews, [wk]: { ...(cc.reviews[wk] || {}), ...patch } }; for (const k of Object.keys(cc.reviews)) if (k < addDays(wk, -56)) delete cc.reviews[k]; st.coach = cc; return st; }, kind ? { kind } : undefined);
    return el('section', { class: 'panel review' },
      el('div', { class: 'section-head' }, el('h2', {}, 'Your week'), el('button', { class: 'linkish', onclick: () => save({ hidden: true }) }, 'Hide')),
      el('div', { class: 'review-stats' },
        el('div', {}, el('strong', {}, hm(w.minutes)), el('span', {}, 'studied')),
        el('div', {}, el('strong', {}, String(w.activeDays)), el('span', {}, 'active days')),
        el('div', {}, el('strong', {}, String(w.lectures)), el('span', {}, 'lectures')),
        el('div', {}, el('strong', {}, `${w.streak}`), el('span', {}, 'day streak'))),
      el('p', { class: 'review-text' }, saved && saved.text ? saved.text : reviewText(w, S().profile.name)),
      saved && saved.ai ? el('p', { class: 'hint small' }, 'Written by AI from your numbers.') : null,
      ai && !(saved && saved.ai) ? el('button', {
        class: 'btn ghost small', disabled: reviewBusy,
        onclick: async () => {
          reviewBusy = true; render();
          try { const text = await aiReview(w, S().profile, state.settings); await save({ text, ai: true, at: Date.now() }, 'coach.review'); } catch (e) { toast(e.message, 'error'); }
          reviewBusy = false; render();
        },
      }, reviewBusy ? 'Writing…' : 'Get a personal review (AI)') : null);
  }

  function coachSettings() {
    const st = S();
    const c = coachOf(st);
    const set = (patch, kind) => saveStudy((x) => { x.coach = { ...coachOf(x), ...patch }; return x; }, { kind, data: {} });
    const school = st.profile.level === 'school';
    const muted = Object.keys(c.muted).filter((k) => c.muted[k]);
    return el('div', { class: 'coach-settings' },
      el('p', { class: 'summary-label' }, 'Coach'),
      el('label', { class: 'toggle' }, el('span', { class: 'toggle-text' }, 'Coach tips', el('small', {}, 'Suggestions based on how your plan is going.')),
        el('input', { type: 'checkbox', role: 'switch', checked: c.tips, onchange: (e) => set({ tips: e.target.checked }, 'coach.tips') })),
      el('label', { class: 'toggle' }, el('span', { class: 'toggle-text' }, 'Reminders', el('small', {}, 'A notification at your usual study time, or in the evening to save a streak. At most one a day, and none once you’ve started.')),
        el('input', { type: 'checkbox', role: 'switch', checked: c.reminders, onchange: (e) => set({ reminders: e.target.checked }, 'coach.reminders') })),
      el('label', { class: 'toggle' }, el('span', { class: 'toggle-text' }, 'Help improve Oris', el('small', {}, 'Share anonymous study events once a day: what kind of task, the day and hour, minutes and scores. Never your name, subjects, topics, notes or anything you typed. Off by default.')),
        el('input', { type: 'checkbox', role: 'switch', checked: c.share, onchange: (e) => set({ share: e.target.checked }, 'coach.share') })),
      c.share && school ? el('label', { class: 'guardian' },
        el('input', { type: 'checkbox', checked: c.guardian, onchange: (e) => set({ guardian: e.target.checked }, 'coach.guardian') }),
        el('span', {}, 'My parent or guardian has read what is shared and agrees.')) : null,
      c.share && school && !c.guardian ? el('p', { class: 'hint small error-text' }, 'Nothing is shared until a parent or guardian agrees.') : null,
      muted.length ? el('p', { class: 'hint small' }, 'Tips you turned off: ', ...muted.map((k, i) => el('button', { class: 'linkish', onclick: () => saveStudy((x) => { const cc = coachOf(x); delete cc.muted[k]; cc.memory[k] = { ...(cc.memory[k] || {}), dismissed: [] }; x.coach = cc; return x; }, { kind: 'coach.unmute', data: { type: k } }) }, `${TIP_TYPES[k] || k}${i < muted.length - 1 ? ',' : ''}`)), ' (click to turn back on)') : null,
      el('button', { class: 'btn ghost small', onclick: downloadData }, 'Download my learning data'));
  }

  function downloadData() {
    const st = S();
    const data = {
      app: 'oris', kind: 'learning-data', exportedAt: new Date().toISOString(),
      profile: { level: st.profile.level }, prefs: st.prefs, dayPlan: st.dayPlan || {}, dayDone: st.dayDone || {},
      events: st.log, lecturePoints: state.lectures ? state.lectures.points : null,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `oris-learning-data-${todayKey()}.json` });
    document.body.append(a);
    a.click();
    a.remove();
  }

  function header(plan) {
    const p = S().profile;
    const exams = S().subjects.filter((s) => s.examDate && s.examDate >= plan.today).sort((a, b) => a.examDate.localeCompare(b.examDate));
    const lv = (LEVELS.find(([v]) => v === p.level) || [, ''])[1];
    return el('section', { class: 'panel plan-hero' },
      el('p', { class: 'ob-step' }, niceDay(plan.today)),
      el('h2', {}, p.name ? `Hi ${p.name}` : 'Your study plan'),
      el('p', { class: 'source-meta' }, [p.level === 'school' && p.classYear ? `Class ${p.classYear}` : '', p.course, p.institution, !p.course && !p.classYear ? lv : ''].filter(Boolean).join(' · ')),
      exams.length ? el('div', { class: 'exam-chips' }, ...exams.map((s) => {
        const d = daysBetween(plan.today, s.examDate);
        return el('span', { class: `exam-chip${d <= 7 ? ' soon' : ''}`, style: { '--subj': subjectColor(S(), s.id) } }, el('strong', {}, s.name), d === 0 ? ' today' : ` in ${d} day${d === 1 ? '' : 's'}`);
      })) : null);
  }

  function todayPanel(plan, names) {
    const day = plan.days.find((d) => d.date === plan.today);
    const items = day ? day.items : [];
    const total = items.reduce((a, i) => a + i.minutes, 0);
    const doneToday = Object.entries(S().progress).filter(([, d]) => d === plan.today).map(([k]) => k);
    const rest = (S().prefs.restDays || []).includes(new Date().getDay());
    return el('section', { class: 'panel' },
      el('div', { class: 'section-head' }, el('h2', {}, 'Today'), total ? el('span', { class: 'source-meta' }, `${hm(total)} planned`) : null),
      items.length ? el('ul', { class: 'plan-list' }, ...items.map((i) => itemRow(i, { today: true, names })))
        : el('p', { class: 'empty' }, rest ? 'Rest day. Nothing planned. Enjoy it.' : 'Nothing left for today. Great work.'),
      doneToday.length ? el('p', { class: 'done-today' }, `✓ ${doneToday.length} done today`) : null);
  }

  function goalsPanel(plan) {
    if (!plan.goals.length) return null;
    const subgoal = (sg) => el('li', {},
      el('strong', {}, sg.title),
      el('span', { class: 'source-meta' }, ` by ${niceDay(sg.due)}${sg.minutes ? ` · ${hm(sg.minutes)}` : ''}`),
      el('p', { class: 'hint small' }, sg.revision ? 'Revise the most-asked topics, then take a full mock test.' : sg.topics.join(', ')));
    const goal = (g) => el('li', { class: 'goal', style: { '--subj': subjectColor(S(), g.subjectId) } },
      el('p', { class: 'goal-title' }, g.title),
      el('div', { class: 'goal-bar' },
        el('span', { class: 'progress' }, el('span', { style: { width: `${g.total ? (g.learned / g.total) * 100 : 0}%` } })),
        el('span', { class: 'source-meta' }, `${g.learned}/${g.total} topics`)),
      el('details', { class: 'subgoals' },
        el('summary', {}, `${g.subgoals.length} sub-goal${g.subgoals.length === 1 ? '' : 's'}`),
        el('ol', {}, ...g.subgoals.map(subgoal))));
    return el('section', { class: 'panel' }, el('h2', {}, 'Goals'), el('ul', { class: 'goal-list' }, ...plan.goals.map(goal)));
  }

  function upcomingPanel(plan, names) {
    const next = plan.days.filter((d) => d.date > plan.today).slice(0, 7);
    if (!next.length) return null;
    return el('section', { class: 'panel' },
      el('h2', {}, 'Coming up'),
      ...next.map((d) => el('details', { class: 'day' },
        el('summary', {}, el('span', {}, niceDay(d.date)), el('span', { class: 'source-meta' }, d.items.length ? hm(d.items.reduce((a, i) => a + i.minutes, 0)) : 'Rest')),
        el('ul', { class: 'plan-list' }, ...d.items.map((i) => itemRow(i, { names }))))));
  }

  function droppedPanel(plan, names) {
    if (!plan.dropped.length) return null;
    const tight = plan.dropped.filter((d) => !d.skipped);
    const skipped = plan.dropped.filter((d) => d.skipped);
    return el('section', { class: 'panel' },
      el('h2', {}, 'Not in the plan'),
      tight.length ? el('p', { class: 'hint' }, `${tight.length} topic${tight.length === 1 ? '' : 's'} didn’t fit before the exam. They’re the lowest priority. Add study time in Plan settings or skip something else to fit them in.`) : null,
      tight.length ? el('ul', { class: 'plain-list' }, ...tight.map((d) => el('li', {}, d.title))) : null,
      skipped.length ? el('ul', { class: 'plain-list' }, ...skipped.map((d) => el('li', { class: 'skipped' }, el('span', {}, `${d.title} (skipped)`), el('button', { class: 'linkish', onclick: () => skipTopic(d.topicId, false) }, 'Put back')))) : null);
  }

  function settingsPanel(plan) {
    const st = S();
    const p = st.prefs;
    const feas = feasibility(st, state.syllabi, plan.today);
    return el('details', { class: 'panel plan-settings' },
      el('summary', {}, el('h2', {}, 'Plan settings')),
      el('div', { class: 'grid2' },
        el('label', { class: 'field' }, el('span', {}, 'Study time per day'),
          el('select', { class: 'text-input', onchange: (e) => prefPatch({ minutesPerDay: Number(e.target.value) }, 'prefs.minutes') },
            ...[60, 90, 120, 180, 240, 300, 360, 480].map((m) => el('option', { value: String(m), selected: p.minutesPerDay === m }, hm(m))))),
        el('label', { class: 'field' }, el('span', {}, 'Revision days'),
          el('select', { class: 'text-input', onchange: (e) => prefPatch({ revisionDays: Number(e.target.value) }, 'prefs.revision') },
            ...[0, 1, 2, 3, 4].map((n) => el('option', { value: String(n), selected: p.revisionDays === n }, String(n)))))),
      el('div', { class: 'day-toggles', role: 'group', 'aria-label': 'Rest days' }, ...DAY_NAMES.map((d, i) => el('button', {
        type: 'button', class: 'day-btn', 'aria-pressed': String((p.restDays || []).includes(i)), title: 'Rest day',
        onclick: () => prefPatch({ restDays: (p.restDays || []).includes(i) ? p.restDays.filter((x) => x !== i) : [...(p.restDays || []), i] }, 'prefs.rest'),
      }, d))),
      el('p', { class: 'summary-label' }, 'Subjects'),
      el('ul', { class: 'subj-settings' }, ...st.subjects.map((s) => {
        const f = feas.find((x) => x.subjectId === s.id);
        return el('li', { style: { '--subj': subjectColor(st, s.id) } },
          el('p', { class: 'subj-name' }, s.name),
          el('div', { class: 'grid3' },
            el('label', { class: 'field' }, el('span', {}, 'Exam'), el('input', { class: 'text-input', type: 'date', value: s.examDate, onchange: (e) => subjPatch(s.id, { examDate: e.target.value }, 'subject.exam') })),
            el('label', { class: 'field' }, el('span', {}, 'Marks'), el('input', { class: 'text-input', inputmode: 'numeric', value: String(s.maxMarks || ''), onchange: (e) => subjPatch(s.id, { maxMarks: Number(e.target.value.replace(/\D/g, '')) || 100 }, 'subject.marks') })),
            el('label', { class: 'field' }, el('span', {}, 'Importance'), el('select', { class: 'text-input', onchange: (e) => subjPatch(s.id, { importance: Number(e.target.value) }, 'subject.importance') },
              ...IMPORTANCE.map(([v, l]) => el('option', { value: String(v), selected: (s.importance || 2) === v }, l))))),
          f && f.avail != null ? el('p', { class: `hint small${f.ok ? '' : ' error-text'}` }, f.ok
            ? `${hm(f.left)} of work left, ${hm(f.avail)} of study time before the exam.`
            : `Too much for the time left: ${hm(f.left)} of work, ${hm(f.avail)} available.`) : null);
      })),
      coachSettings(),
      busy ? el('p', { class: 'batch' }, busy) : el('div', { class: 'row wrap' },
        el('button', { class: 'btn small', onclick: () => open('setup', { step: 1 }) }, 'Add or remove subjects'),
        el('button', { class: 'btn ghost small', onclick: () => open('setup', { step: 2 }) }, 'Syllabus and papers'),
        el('button', { class: 'btn ghost small', disabled: !hasAI(state.settings), onclick: reorder, title: hasAI(state.settings) ? '' : 'Needs Oris AI' }, 'Redo topic order (AI)'),
        el('button', { class: 'btn ghost small', onclick: () => open('setup', { step: 0 }) }, 'Edit my details')));
  }

  function welcome() {
    const st = S();
    const started = st.subjects.length || st.profile.name;
    return el('section', { class: 'panel plan-welcome' },
      el('h2', {}, 'Your plan to top every subject'),
      el('p', {}, 'Tell Oris your subjects, exam dates and syllabus. Add past papers if you have them. Oris plans every day up to your exams: the most important topics first, in an order that makes sense, broken into goals you can actually finish.'),
      el('ul', { class: 'ob-summary' },
        el('li', {}, 'Takes about 3 minutes'),
        el('li', {}, 'Everything stays on this device'),
        el('li', {}, 'Change anything at any time')),
      el('button', { class: 'btn primary', onclick: () => open('setup', { step: 0 }) }, started ? 'Continue setup' : 'Make my study plan'));
  }

  function render() {
    const a = document.activeElement;
    if (a && body.contains(a) && a.matches('input[type="date"], input[inputmode]')) return;
    if (!S().setupDone) { body.replaceChildren(welcome()); return; }
    const plan = buildPlan(S(), state.syllabi, todayKey());
    const names = topicIndex();
    if (!(S().dayPlan || {})[plan.today]) saveStudy((st) => recordDayPlan(st, state.syllabi, plan.today));
    body.replaceChildren(...[
      header(plan),
      ...plan.warnings.map((w) => el('p', { class: 'notice' }, w.text)),
      coachPanel(),
      reviewPanel(),
      todayPanel(plan, names),
      goalsPanel(plan),
      upcomingPanel(plan, names),
      droppedPanel(plan, names),
      settingsPanel(plan),
    ].filter(Boolean));
  }
  render();
  return { update(changed) { if (changed.study || changed.syllabi || changed.settings || changed.lectures) render(); } };
}

// First-run setup on the New Tab page: three questions set the timer and blocker defaults,
// then an optional three-step tour points at the main controls.
import { KEYS, mergeSettings } from '../lib/defaults.js';

const QUESTIONS = [
  {
    key: 'goal', title: 'What brings you to Oris?',
    options: [['learn', 'Learning for exams or courses'], ['skill', 'Building a new skill'], ['earn', 'Earning from my work']],
  },
  {
    key: 'style', title: 'How do you focus best?',
    options: [['blocks', 'In fixed time blocks'], ['flow', 'In long, free-flowing stretches'], ['deadline', 'Against a deadline']],
  },
  {
    key: 'level', title: 'How long can you focus in one go right now?',
    options: [['beginner', 'About 25 minutes'], ['intermediate', 'About 50 minutes'], ['expert', 'An hour and a half']],
  },
];

const LENGTHS = { beginner: [25, 5, 15], intermediate: [50, 10, 20], expert: [90, 20, 30] };

// Turns the three answers into settings. Exported for tests.
export function settingsFromAnswers({ goal, style, level }) {
  const [focusMin, shortMin, longMin] = LENGTHS[level] || LENGTHS.beginner;
  const patch = { focusMin, shortMin, longMin, profile: { goal, style, level }, onboarded: true, distractMode: 'always' };
  if (style === 'flow') Object.assign(patch, { autoStartBreaks: false, autoStartFocus: false, blockMode: 'focus' });
  else if (style === 'deadline') Object.assign(patch, { autoStartBreaks: true, autoStartFocus: true, blockMode: 'session' });
  else Object.assign(patch, { autoStartBreaks: true, autoStartFocus: false, blockMode: 'focus' });
  return patch;
}

export function describeSetup(p) {
  const lines = [`${p.focusMin}-minute focus sessions with ${p.shortMin}-minute breaks`];
  lines.push(p.autoStartFocus ? 'Breaks and the next session start on their own' : p.autoStartBreaks ? 'Breaks start on their own when a session ends' : 'You start every break and session yourself');
  lines.push(p.blockMode === 'session' ? 'Distracting sites stay blocked through focus and breaks' : 'Distracting sites are blocked while you focus');
  lines.push('Shorts and feeds are hidden on YouTube and social sites');
  return lines;
}

function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'class') n.className = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}

const TOUR = [
  { target: '#nt-daily', title: 'Your one focus', body: 'Write the one thing that matters today. It shows here on every New Tab and in the side panel.' },
  { target: '#nt-actions', title: 'Start a session', body: 'Start focus here or press Space. Distracting sites are blocked while it runs.' },
  { target: '#nt-modes', title: 'Study, Research, Earn', body: 'Open a mode full screen here, or press S, R or E. Click the Oris icon in the toolbar to keep the same tools next to any page.' },
];

export function runOnboarding({ root, state, toast, onDone, onStudySetup }) {
  const answers = {};
  let step = 0;
  root.hidden = false;
  const prevFocus = document.activeElement;

  async function finish(patch, tour, study = false) {
    const r = await chrome.storage.local.get(KEYS.settings);
    const next = mergeSettings({ ...mergeSettings(r[KEYS.settings]), ...patch });
    await chrome.storage.local.set({ [KEYS.settings]: next });
    state.settings = next;
    if (study && onStudySetup) { root.hidden = true; root.replaceChildren(); onStudySetup(); return; }
    if (tour) runTour(0);
    else close();
  }

  function close() {
    root.hidden = true;
    root.replaceChildren();
    document.querySelectorAll('.tour-target').forEach((n) => n.classList.remove('tour-target'));
    if (onDone) onDone();
    else if (prevFocus && prevFocus.focus) prevFocus.focus();
  }

  function card(...kids) {
    const c = h('div', { class: 'ob-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ob-title' }, ...kids);
    root.replaceChildren(h('div', { class: 'ob-scrim' }), c);
    const first = c.querySelector('button');
    if (first) setTimeout(() => first.focus(), 0);
  }

  function renderQuestion() {
    const q = QUESTIONS[step];
    card(
      h('p', { class: 'ob-step' }, `Question ${step + 1} of ${QUESTIONS.length}`),
      h('h2', { id: 'ob-title' }, q.title),
      h('div', { class: 'ob-options', role: 'group', 'aria-labelledby': 'ob-title' },
        ...q.options.map(([v, label]) => h('button', {
          class: 'ob-option', 'aria-pressed': String(answers[q.key] === v),
          onclick: () => {
            answers[q.key] = v;
            step++;
            if (step < QUESTIONS.length) renderQuestion();
            else renderSummary();
          },
        }, label))),
      h('div', { class: 'ob-foot' },
        step > 0 ? h('button', { class: 'btn ghost small', onclick: () => { step--; renderQuestion(); } }, 'Back') : h('span'),
        h('button', { class: 'btn ghost small', onclick: () => finish({ onboarded: true }, false) }, 'Skip setup')),
    );
  }

  function renderSummary() {
    const patch = settingsFromAnswers(answers);
    card(
      h('p', { class: 'ob-step' }, 'Your setup'),
      h('h2', { id: 'ob-title' }, 'Oris is ready'),
      h('ul', { class: 'ob-summary' }, ...describeSetup(patch).map((l) => h('li', {}, l))),
      h('p', { class: 'hint' }, 'You can change any of this later in Settings.'),
      onStudySetup ? h('div', { class: 'ob-next' },
        h('p', {}, h('strong', {}, 'Next: your study plan. '), 'Tell Oris your name, class, subjects and syllabus, and it plans every day up to your exams.'),
        h('button', { class: 'btn primary', onclick: () => finish(patch, false, true) }, 'Set up my study plan')) : null,
      h('div', { class: 'ob-foot' },
        h('button', { class: 'btn ghost small', onclick: () => { step = QUESTIONS.length - 1; renderQuestion(); } }, 'Back'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => finish(patch, false) }, 'Start using Oris'),
          h('button', { class: 'btn primary', onclick: () => finish(patch, true) }, 'Show me around'))),
    );
  }

  function runTour(i) {
    document.querySelectorAll('.tour-target').forEach((n) => n.classList.remove('tour-target'));
    const s = TOUR[i];
    const target = document.querySelector(s.target);
    if (!target) { close(); return; }
    target.classList.add('tour-target');
    const r = target.getBoundingClientRect();
    const tip = h('div', { class: 'ob-tip', role: 'dialog', 'aria-labelledby': 'ob-title' },
      h('p', { class: 'ob-step' }, `${i + 1} of ${TOUR.length}`),
      h('h2', { id: 'ob-title' }, s.title),
      h('p', {}, s.body),
      h('div', { class: 'ob-foot' },
        h('button', { class: 'btn ghost small', onclick: close }, 'End tour'),
        h('button', { class: 'btn primary small', onclick: () => (i + 1 < TOUR.length ? runTour(i + 1) : (close(), toast('You’re all set. Press Space to start focusing.'))) }, i + 1 < TOUR.length ? 'Next' : 'Done')));
    root.replaceChildren(tip);
    const width = Math.min(340, window.innerWidth - 32);
    tip.style.width = `${width}px`;
    tip.style.left = `${Math.max(16, Math.min(window.innerWidth - width - 16, r.left + r.width / 2 - width / 2))}px`;
    tip.style.top = `${Math.min(window.innerHeight - 200, r.bottom + 14 + window.scrollY)}px`;
    setTimeout(() => tip.querySelector('.btn.primary').focus(), 0);
  }

  // One keydown listener per page; it calls whichever run is current.
  root.orisEscape = () => finish({ onboarded: true }, false);
  if (!root.dataset.bound) {
    root.dataset.bound = '1';
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && root.orisEscape) { e.stopPropagation(); root.orisEscape(); } });
  }
  renderQuestion();
}

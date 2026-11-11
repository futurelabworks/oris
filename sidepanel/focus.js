import { PHASE_LABEL, TIMER_PRESETS, formatClock, formatDuration, remainingOf, todayKey, computeStreak } from '../lib/defaults.js';
import { dailyFocus, visibleTasks } from '../lib/planner.js';
import { tasksPanel, notesPanel } from './today.js';
import { celebrate } from './celebrate.js';
import { shortcutNotice } from './shortcuts.js';

const R = 130; // arc radius in the 300x160 viewBox
const ARC_LEN = Math.PI * R;

export function mount(root, ctx, params = {}) {
  const { el, svg, state, send, saveSettings, planner } = ctx;
  let pickedTaskId = state.timer.taskId || null;

  // ----- today's one focus -----
  const daily = el('input', {
    class: 'daily-input', type: 'text', maxlength: '140', 'aria-label': 'Your one focus for today',
    placeholder: 'What’s your one focus today?', value: dailyFocus(state.planner),
  });
  const saveDaily = () => { if (daily.value.trim() !== dailyFocus(state.planner)) planner('setDaily', { text: daily.value }); };
  daily.addEventListener('change', saveDaily);
  daily.addEventListener('keydown', (e) => { if (e.key === 'Enter') { daily.blur(); } });
  const dailyRow = el('label', { class: 'daily' }, el('span', {}, 'Today'), daily);

  // ----- timer card -----
  const arcFill = svg('path', { class: 'arc-fill', d: `M20 150 A${R} ${R} 0 0 1 280 150` });
  const sun = svg('circle', { class: 'arc-sun', r: '9', cx: '20', cy: '150' });
  const arcSvg = svg('svg', { class: 'arc', viewBox: '0 0 300 162', 'aria-hidden': 'true' },
    svg('path', { class: 'arc-track', d: `M20 150 A${R} ${R} 0 0 1 280 150` }),
    arcFill,
    svg('line', { class: 'arc-ground', x1: '4', y1: '150', x2: '296', y2: '150' }),
    sun,
  );
  arcFill.style.strokeDasharray = ARC_LEN;

  const phaseName = el('span', { class: 'phase-name' });
  const phaseCount = el('span', { class: 'phase-count' });
  const clock = el('div', { class: 'clock', role: 'timer', 'aria-live': 'off' });
  const task = el('input', {
    class: 'task-input', type: 'text', maxlength: '140',
    placeholder: 'What are you studying?', 'aria-label': 'What are you studying?',
    value: state.timer.task || '',
  });
  task.addEventListener('keydown', (e) => { if (e.key === 'Enter' && state.timer.status === 'idle') start(); });
  task.addEventListener('input', () => { pickedTaskId = null; renderPicker(); });
  const picker = el('div', { class: 'task-picker', role: 'group', 'aria-label': 'Pick a task' });
  const controls = el('div', { class: 'controls' });
  const lockNote = el('p', { class: 'lock-note', hidden: true }, 'Hard mode is on. This session can’t be paused, stopped or skipped.');

  const card = el('section', { class: 'timer-card' },
    el('div', { class: 'phase-row' }, phaseName, phaseCount),
    el('div', { class: 'arc-wrap' }, arcSvg, clock),
    task,
    picker,
    controls,
    lockNote,
  );

  // ----- length presets -----
  const presetRow = el('div', { class: 'chips', role: 'group', 'aria-label': 'Session length' });
  const custom = el('div', { class: 'custom-len', hidden: true });

  // ----- today -----
  const todayFocus = el('strong');
  const todaySessions = el('strong');
  const streak = el('strong');
  const week = el('div', { class: 'week', role: 'img' });

  const today = el('section', { class: 'panel' },
    el('h2', {}, 'Today'),
    el('div', { class: 'figures' },
      el('div', { class: 'figure' }, todayFocus, el('span', {}, 'focused')),
      el('div', { class: 'figure' }, todaySessions, el('span', {}, 'sessions')),
      el('div', { class: 'figure' }, streak, el('span', {}, 'day streak')),
    ),
    week,
  );

  const pick = (t) => {
    pickedTaskId = t.id;
    task.value = t.title;
    renderPicker();
    task.focus();
  };
  const tasks = tasksPanel(ctx, { onPick: pick });
  const notes = notesPanel(ctx);

  root.append(shortcutNotice(ctx), dailyRow, card, tasks.node, notes.node,
    el('section', { class: 'panel' }, el('h2', {}, 'Session length'), presetRow, custom),
    today);

  // ----- actions -----
  function start() {
    const title = task.value.trim();
    const taskId = state.timer.phase === 'focus' ? pickedTaskId : state.timer.taskId;
    send({ type: 'timer:start', phase: state.timer.phase, task: title, taskId: title ? taskId : null });
  }

  // Up to three open tasks as one-tap choices under the "What are you studying?" line.
  function renderPicker() {
    const t = state.timer;
    const show = t.status === 'idle' && t.phase === 'focus';
    const open = visibleTasks(state.planner).filter((x) => !x.done).slice(0, 3);
    picker.hidden = !show || !open.length;
    if (picker.hidden) return;
    picker.replaceChildren(...open.map((x) => el('button', {
      class: 'chip', 'aria-pressed': String(pickedTaskId === x.id), onclick: () => pick(x),
    }, x.title)));
  }
  const actions = {
    start,
    pause: () => send({ type: 'timer:pause' }),
    resume: () => send({ type: 'timer:resume' }),
    stop: () => send({ type: 'timer:stop' }),
    skip: () => send({ type: 'timer:skip' }),
  };

  function renderControls() {
    const t = state.timer;
    const locked = state.settings.hardMode && t.phase === 'focus' && t.status !== 'idle';
    const btn = (label, action, cls = '') => el('button', { class: `btn lg ${cls}`, disabled: locked && action !== 'start' && action !== 'resume', onclick: actions[action] }, label);
    let buttons;
    if (t.status === 'running') buttons = [btn('Pause', 'pause', 'primary'), btn('Stop', 'stop'), btn(t.phase === 'focus' ? 'Skip' : 'Skip break', 'skip', 'ghost')];
    else if (t.status === 'paused') buttons = [btn('Resume', 'resume', 'primary'), btn('Stop', 'stop')];
    else if (t.phase === 'focus') buttons = [btn('Start focus', 'start', 'primary')];
    else buttons = [btn(`Start ${PHASE_LABEL[t.phase].toLowerCase()}`, 'start', 'primary'), btn('Skip break', 'skip', 'ghost')];
    controls.replaceChildren(...buttons);
    lockNote.hidden = !locked;
    task.disabled = t.status !== 'idle' || t.phase !== 'focus';
    if (document.activeElement !== task) task.value = t.task || '';
  }

  function renderClock() {
    const t = state.timer;
    const s = state.settings;
    const minutes = t.phase === 'focus' ? s.focusMin : t.phase === 'short' ? s.shortMin : s.longMin;
    const total = t.durationMs || minutes * 60000;
    const remaining = remainingOf(t) ?? total;
    clock.textContent = formatClock(remaining);
    const progress = Math.min(1, Math.max(0, 1 - remaining / total));
    arcFill.style.strokeDashoffset = ARC_LEN * (1 - progress);
    const a = Math.PI * (1 - progress);
    sun.setAttribute('cx', (150 + R * Math.cos(a)).toFixed(2));
    sun.setAttribute('cy', (150 - R * Math.sin(a)).toFixed(2));

    card.classList.toggle('is-break', t.phase !== 'focus');
    card.classList.toggle('is-paused', t.status === 'paused');
    phaseName.textContent = t.status === 'paused' ? `${PHASE_LABEL[t.phase]}, paused` : t.status === 'idle' && t.phase !== 'focus' ? `${PHASE_LABEL[t.phase]} next` : PHASE_LABEL[t.phase];
    const every = Math.max(1, Number(s.longEvery) || 4);
    const done = t.completedFocus % every;
    const n = t.phase === 'focus' ? done + 1 : done === 0 ? every : done;
    phaseCount.textContent = `Session ${n} of ${every}`;
    document.title = t.status === 'running' ? `${formatClock(remaining)} · Oris` : 'Oris';
  }

  function renderPresets() {
    const s = state.settings;
    const busy = state.timer.status !== 'idle';
    const isCustom = !TIMER_PRESETS.some((p) => p.focusMin === s.focusMin && p.shortMin === s.shortMin && p.longMin === s.longMin);
    presetRow.replaceChildren(
      ...TIMER_PRESETS.map((p) => el('button', {
        class: 'chip', disabled: busy,
        'aria-pressed': String(!isCustom && p.focusMin === s.focusMin),
        onclick: () => { saveSettings({ focusMin: p.focusMin, shortMin: p.shortMin, longMin: p.longMin }); custom.hidden = true; },
      }, `${p.focusMin} / ${p.shortMin}`)),
      el('button', {
        class: 'chip', disabled: busy, 'aria-pressed': String(isCustom || !custom.hidden),
        onclick: () => { custom.hidden = !custom.hidden; renderPresets(); },
      }, isCustom ? `${s.focusMin} / ${s.shortMin}` : 'Custom'),
    );
    if (!custom.hidden) renderCustom();
  }

  function renderCustom() {
    const s = state.settings;
    const busy = state.timer.status !== 'idle';
    const field = (label, key, max) => el('label', { class: 'field' }, el('span', {}, label),
      el('input', {
        type: 'number', min: '1', max: String(max), value: String(s[key]), disabled: busy,
        onchange: (e) => {
          const v = Math.round(Number(e.target.value));
          if (v >= 1 && v <= max) saveSettings({ [key]: v });
          else e.target.value = s[key];
        },
      }));
    custom.replaceChildren(
      field('Focus (min)', 'focusMin', 300),
      field('Short break', 'shortMin', 60),
      field('Long break', 'longMin', 120),
      field('Long break every', 'longEvery', 12),
    );
  }

  function renderToday() {
    const days = (state.stats && state.stats.days) || {};
    const d = days[todayKey()] || { focusMs: 0, sessions: 0 };
    todayFocus.textContent = formatDuration(d.focusMs);
    todaySessions.textContent = String(d.sessions);
    streak.textContent = String(computeStreak(state.stats));

    const list = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const day = days[todayKey(date)] || { focusMs: 0 };
      list.push({ date, ms: day.focusMs, today: i === 0 });
    }
    const max = Math.max(60 * 60000, ...list.map((x) => x.ms));
    week.setAttribute('aria-label', 'Focus time over the last 7 days: ' + list.map((x) => `${x.date.toLocaleDateString(undefined, { weekday: 'short' })} ${formatDuration(x.ms)}`).join(', '));
    week.replaceChildren(...list.map((x) => el('div', { class: `bar${x.today ? ' today' : ''}`, title: `${x.date.toLocaleDateString(undefined, { weekday: 'long' })}: ${formatDuration(x.ms)}` },
      el('div', { class: 'bar-track' }, el('div', { class: 'bar-fill', style: { height: `${Math.max(x.ms ? 4 : 0, (x.ms / max) * 100)}%` } })),
      el('span', {}, x.date.toLocaleDateString(undefined, { weekday: 'narrow' })),
    )));
  }

  renderControls();
  renderClock();
  renderPresets();
  renderToday();
  renderPicker();
  const tick = setInterval(renderClock, 250);

  const onComplete = () => {
    const d = (state.stats.days || {})[todayKey()];
    celebrate(card, state.settings, { sessions: d ? d.sessions : 0 });
  };
  window.addEventListener('oris:session-complete', onComplete);
  if (params.focusNote) setTimeout(() => { notes.node.scrollIntoView({ block: 'center' }); notes.focus(); }, 50);

  return {
    update(changed) {
      if (changed.timer) { renderControls(); renderClock(); renderPresets(); renderPicker(); tasks.render(); notes.render(); }
      if (changed.settings) { renderControls(); renderClock(); renderPresets(); }
      if (changed.stats) renderToday();
      if (changed.planner) {
        if (document.activeElement !== daily) daily.value = dailyFocus(state.planner);
        tasks.render();
        notes.render();
        renderPicker();
      }
    },
    unmount() { clearInterval(tick); window.removeEventListener('oris:session-complete', onComplete); saveDaily(); document.title = 'Oris'; },
  };
}

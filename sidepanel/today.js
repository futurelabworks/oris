import { chatJSON, hasAI } from '../lib/ai.js';
// Today's tasks and quick notes. Used by the Focus view in the side panel and on the New Tab page.
import { visibleTasks, sessionNotes } from '../lib/planner.js';
import { formatDuration } from '../lib/defaults.js';

// The key that ties notes to the running focus session (kept through its break).
export function currentSessionKey(timer) {
  return timer.status !== 'idle' && timer.focusStartedAt ? String(timer.focusStartedAt) : null;
}

export function tasksPanel(ctx, { onPick } = {}) {
  const { el, state, planner, toast } = ctx;
  const node = el('section', { class: 'panel tasks' });
  let draft = '';

  function render() {
    const a = document.activeElement;
    if (a && node.contains(a) && a.matches('input[type="text"]') && a.value) return; // don't wipe what's being typed
    const list = visibleTasks(state.planner);
    const open = list.filter((t) => !t.done);
    const done = list.filter((t) => t.done);
    const busy = state.timer.status !== 'idle';
    const input = el('input', {
      class: 'text-input', type: 'text', maxlength: '140', placeholder: 'Add a task, e.g. Revise unit 2 notes', value: draft,
      'aria-label': 'New task', oninput: (e) => { draft = e.target.value; },
    });
    const item = (t) => el('li', { class: `task${t.done ? ' done' : ''}${state.timer.taskId === t.id && busy ? ' current' : ''}` },
      el('label', { class: 'topic-check' },
        el('input', { type: 'checkbox', checked: t.done, onchange: (e) => planner('toggleTask', { id: t.id, done: e.target.checked }) }),
        el('span', {}, t.title)),
      t.focusMs ? el('span', { class: 'task-time', title: `${t.sessions || 0} completed session${t.sessions === 1 ? '' : 's'}` }, formatDuration(t.focusMs)) : null,
      !t.done && onPick ? el('button', {
        class: 'btn ghost small', disabled: busy, title: busy ? 'Finish the current session first' : null,
        onclick: () => onPick(t),
      }, state.timer.taskId === t.id && busy ? 'Now' : 'Focus') : null,
      el('button', { class: 'icon-btn small', 'aria-label': `Delete task ${t.title}`, title: 'Delete task', onclick: () => planner('deleteTask', { id: t.id }) }, '×'));

    node.replaceChildren(
      el('h2', {}, `Tasks${open.length ? ` (${open.length})` : ''}`),
      open.length || done.length
        ? el('ul', { class: 'task-list' }, ...open.map(item), ...done.map(item))
        : el('p', { class: 'empty' }, 'Plan your day: add the few tasks that matter, then pick one to focus on.'),
      el('form', {
        class: 'add-row compact',
        onsubmit: async (e) => {
          e.preventDefault();
          const title = draft.trim();
          if (!title) { input.focus(); return; }
          draft = '';
          input.value = '';
          if (await planner('addTask', { title })) input.focus();
          else toast('Couldn’t add the task.', 'error');
        },
      }, input, el('button', { class: 'btn small', type: 'submit' }, 'Add')),
    );
  }
  render();
  return { node, render };
}

export function notesPanel(ctx) {
  const { el, state, planner, toast } = ctx;
  const node = el('section', { class: 'panel notes-panel' });
  let draft = '';
  let busy = false;
  let input;

  async function summarise(notes, key) {
    if (!hasAI(state.settings)) { toast('Turn on Oris AI in Settings to summarise notes.', 'error'); return; }
    busy = true;
    render();
    try {
      const content = await chatJSON({
        task: 'notes',
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'You turn a student\'s rough study notes into a short revision summary. Reply with JSON only. Use only what the notes say.' },
          { role: 'user', content: `Return {"points": ["<point>", ... 3 to 6 items]} summarising these notes:\n\"\"\"\n${notes.map((n) => '- ' + n.text).join('\n').slice(0, 8000)}\n\"\"\"` },
        ],
      }, state.settings);
      const points = (JSON.parse(content).points || []).map(String).filter(Boolean);
      if (!points.length) throw new Error('The AI returned an empty summary.');
      await planner('saveSummary', { key, points });
    } catch (err) {
      toast(err.message || String(err), 'error');
    } finally {
      busy = false;
      render();
    }
  }

  function render() {
    const a = document.activeElement;
    if (a && node.contains(a) && a.tagName === 'TEXTAREA' && a.value) return;
    const key = currentSessionKey(state.timer);
    const notes = sessionNotes(state.planner, key);
    const sumKey = key || `day-${new Date().toDateString()}`;
    const summary = state.planner.summaries[sumKey];
    input = el('textarea', {
      class: 'text-input', rows: '2', maxlength: '2000', 'aria-label': 'Quick note',
      placeholder: key ? 'Jot a thought, formula or question. Enter to save.' : 'Jot a quick note. Enter to save.',
      oninput: (e) => { draft = e.target.value; },
      onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); } },
    }, draft);

    async function save() {
      const text = draft.trim();
      if (!text) return;
      draft = '';
      input.value = '';
      await planner('addNote', { text, session: key, task: state.timer.task });
      input.focus();
    }

    // replaceChildren() would print a null as the text "null", so drop empty parts first.
    node.replaceChildren(...[
      el('div', { class: 'section-head' },
        el('h2', {}, key ? 'Notes for this session' : 'Today’s notes'),
        notes.length >= 2 ? el('button', { class: 'btn ghost small', disabled: busy, onclick: () => summarise(notes, sumKey) }, busy ? 'Summarising…' : summary ? 'Summarise again' : 'Summarise') : null),
      input,
      summary ? el('div', { class: 'summary' }, el('p', { class: 'summary-label' }, 'Summary'), el('ul', {}, ...summary.points.map((p) => el('li', {}, p)))) : null,
      notes.length ? el('ul', { class: 'note-list' }, ...notes.slice().reverse().map((n) => el('li', {},
        el('p', {}, n.text),
        el('span', { class: 'note-meta' }, new Date(n.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }), n.task ? `, ${n.task}` : ''),
        el('button', { class: 'icon-btn small', 'aria-label': 'Delete note', title: 'Delete note', onclick: () => planner('deleteNote', { id: n.id }) }, '×')))) : null,
      el('p', { class: 'hint tip' }, 'Shortcut: Alt+Shift+N opens this box from any page.'),
    ].filter(Boolean));
  }
  render();
  return { node, render, focus: () => input && input.focus() };
}

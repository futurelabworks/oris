// Earn → Jobs: applications for jobs, internships, gigs and freelance projects, by stage,
// with follow-up dates (Oris reminds you) and a focus session for writing each application.
import { JOB_STAGES, JOB_KINDS } from '../lib/earn.js';
import { today, niceDate, deleteButton } from './earn-common.js';

export function mount(root, ctx) {
  const { el, state, earn, send, toast } = ctx;
  const body = el('div');
  root.append(body);
  let stage = 'all';
  let adding = false;
  const draft = { company: '', role: '', kind: 'internship', link: '', followUp: '', stage: 'saved' };
  const openNotes = new Set();

  const title = (j) => [j.role, j.company].filter(Boolean).join(' at ');

  function addForm() {
    return el('form', {
      class: 'panel earn-form',
      onsubmit: async (e) => {
        e.preventDefault();
        if (await earn('addJob', { ...draft })) { adding = false; Object.assign(draft, { company: '', role: '', link: '', followUp: '', stage: 'saved' }); render(); toast('Added'); }
      },
    },
    el('h2', {}, 'Add an application'),
    el('div', { class: 'grid2' },
      el('label', { class: 'field' }, el('span', {}, 'Company or client'), el('input', { class: 'text-input', maxlength: '80', value: draft.company, placeholder: 'e.g. Razorpay', oninput: (e) => { draft.company = e.target.value; } })),
      el('label', { class: 'field' }, el('span', {}, 'Role'), el('input', { class: 'text-input', maxlength: '100', value: draft.role, placeholder: 'e.g. AI/ML intern', oninput: (e) => { draft.role = e.target.value; } }))),
    el('div', { class: 'grid2' },
      el('label', { class: 'field' }, el('span', {}, 'Type'), el('select', { class: 'text-input', onchange: (e) => { draft.kind = e.target.value; } }, ...JOB_KINDS.map(([v, l]) => el('option', { value: v, selected: draft.kind === v }, l)))),
      el('label', { class: 'field' }, el('span', {}, 'Stage'), el('select', { class: 'text-input', onchange: (e) => { draft.stage = e.target.value; } }, ...JOB_STAGES.slice(0, 3).map(([v, l]) => el('option', { value: v, selected: draft.stage === v }, l))))),
    el('label', { class: 'field' }, el('span', {}, 'Link (optional)'), el('input', { class: 'text-input', maxlength: '500', value: draft.link, placeholder: 'Job post or application page', oninput: (e) => { draft.link = e.target.value; } })),
    el('label', { class: 'field' }, el('span', {}, 'Follow up on (optional)'), el('input', { class: 'text-input', type: 'date', min: today(), value: draft.followUp, oninput: (e) => { draft.followUp = e.target.value; } }),
      el('small', {}, 'Oris sends a reminder that day.')),
    el('div', { class: 'row' }, el('button', { class: 'btn primary', type: 'submit' }, 'Add application'), el('button', { class: 'btn ghost', type: 'button', onclick: () => { adding = false; render(); } }, 'Cancel')));
  }

  function card(j) {
    const due = j.followUp && j.followUp <= today() && !['offer', 'rejected'].includes(j.stage);
    const notesOpen = openNotes.has(j.id);
    return el('li', { class: `job stage-${j.stage}${due ? ' due' : ''}` },
      el('div', { class: 'job-head' },
        el('div', {},
          j.link ? el('a', { class: 'job-title', href: j.link, target: '_blank', rel: 'noopener' }, title(j)) : el('span', { class: 'job-title' }, title(j)),
          el('span', { class: 'source-meta' }, [(JOB_KINDS.find(([k]) => k === j.kind) || [, ''])[1], j.appliedAt ? `applied ${new Date(j.appliedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : null].filter(Boolean).join(', '))),
        deleteButton(el, `Delete ${title(j)}`, () => earn('deleteJob', { id: j.id }))),
      el('div', { class: 'job-row' },
        el('select', { class: 'text-input stage-select', 'aria-label': 'Stage', onchange: (e) => earn('updateJob', { id: j.id, patch: { stage: e.target.value } }) },
          ...JOB_STAGES.map(([v, l]) => el('option', { value: v, selected: j.stage === v }, l))),
        el('label', { class: `follow${due ? ' due' : ''}` }, el('span', {}, due ? 'Follow up now' : 'Follow up'),
          el('input', { type: 'date', class: 'text-input', value: j.followUp, onchange: (e) => earn('updateJob', { id: j.id, patch: { followUp: e.target.value } }) }))),
      el('div', { class: 'row' },
        j.stage === 'saved' ? el('button', {
          class: 'btn primary small', title: 'Start a focus session for writing this application',
          onclick: async () => { if (await send({ type: 'timer:start', phase: 'focus', task: `Apply: ${title(j)}`, taskId: null })) toast('Focus started. Distracting sites are blocked while you apply.'); },
        }, 'Focus on applying') : null,
        el('button', { class: 'btn ghost small', 'aria-expanded': String(notesOpen), onclick: () => { if (notesOpen) openNotes.delete(j.id); else openNotes.add(j.id); render(); } }, j.notes ? 'Notes' : 'Add notes')),
      notesOpen ? el('textarea', {
        class: 'text-input', rows: '3', placeholder: 'Contact person, what you sent, interview prep…',
        onchange: (e) => earn('updateJob', { id: j.id, patch: { notes: e.target.value } }),
      }, j.notes || '') : null);
  }

  function render() {
    const a = document.activeElement;
    if (a && body.contains(a) && a.matches('input:not([type="date"]), textarea')) return;
    const jobs = state.earn.jobs;
    const counts = Object.fromEntries(JOB_STAGES.map(([k]) => [k, jobs.filter((j) => j.stage === k).length]));
    const shown = (stage === 'all' ? jobs : jobs.filter((j) => j.stage === stage))
      .slice().sort((x, y) => (y.followUp && y.followUp <= today() ? 1 : 0) - (x.followUp && x.followUp <= today() ? 1 : 0));
    body.replaceChildren(...[
      el('div', { class: 'pipeline', role: 'group', 'aria-label': 'Filter by stage' },
        el('button', { class: 'pipe', 'aria-pressed': String(stage === 'all'), onclick: () => { stage = 'all'; render(); } }, el('strong', {}, String(jobs.length)), el('span', {}, 'All')),
        ...JOB_STAGES.map(([k, l]) => el('button', { class: `pipe pipe-${k}`, 'aria-pressed': String(stage === k), onclick: () => { stage = k; render(); } }, el('strong', {}, String(counts[k])), el('span', {}, l)))),
      adding ? addForm() : el('button', { class: 'btn primary', onclick: () => { adding = true; render(); } }, 'Add an application'),
      shown.length ? el('ul', { class: 'job-list' }, ...shown.map(card))
        : el('p', { class: 'empty' }, jobs.length ? 'Nothing at this stage.' : 'Keep every job, internship and gig you apply for here. Set a follow-up date and Oris reminds you.'),
    ].filter(Boolean));
  }
  render();
  return { update(changed) { if (changed.earn) render(); } };
}

export { niceDate };

// Earn → Skills: a money-making skill broken into steps, with course links and focus time.
import { formatDuration } from '../lib/defaults.js';
import { deleteButton } from './earn-common.js';

export function mount(root, ctx) {
  const { el, state, earn, send, toast } = ctx;
  const body = el('div');
  root.append(body);
  const newSkill = { name: '', goal: '' };
  const stepDraft = {}; // skillId -> { title, link }

  function skillCard(s) {
    const done = s.milestones.filter((m) => m.done).length;
    const total = s.milestones.length;
    const d = stepDraft[s.id] || (stepDraft[s.id] = { title: '', link: '' });
    return el('section', { class: 'panel skill' },
      el('div', { class: 'section-head' },
        el('div', {}, el('h2', {}, s.name), s.goal ? el('p', { class: 'source-meta' }, `Goal: ${s.goal}`) : null),
        deleteButton(el, `Delete skill ${s.name}`, () => earn('deleteSkill', { id: s.id }))),
      el('p', { class: 'source-meta' }, `${done} of ${total} step${total === 1 ? '' : 's'} done${s.focusMs ? `, ${formatDuration(s.focusMs)} of focus` : ''}`),
      el('span', { class: 'progress' }, el('span', { style: { width: `${total ? (done / total) * 100 : 0}%` } })),
      total ? el('ul', { class: 'steps' }, ...s.milestones.map((m) => el('li', { class: m.done ? 'done' : '' },
        el('label', { class: 'topic-check' },
          el('input', { type: 'checkbox', checked: m.done, onchange: () => earn('toggleMilestone', { skillId: s.id, id: m.id }) }),
          m.link ? el('a', { href: m.link, target: '_blank', rel: 'noopener' }, m.title) : el('span', {}, m.title)),
        m.done ? null : el('button', {
          class: 'btn ghost small', title: 'Start a focus session; its time counts to this skill',
          onclick: async () => { if (await send({ type: 'timer:start', phase: 'focus', task: `${s.name}: ${m.title}`, taskId: null, skillId: s.id })) toast(`Focus started on ${m.title}`); },
        }, 'Focus'),
        deleteButton(el, `Delete step ${m.title}`, () => earn('deleteMilestone', { skillId: s.id, id: m.id }))))) : null,
      el('form', {
        class: 'add-step',
        onsubmit: async (e) => {
          e.preventDefault();
          if (await earn('addMilestone', { skillId: s.id, ...d })) { stepDraft[s.id] = { title: '', link: '' }; render(); }
        },
      },
      el('input', { class: 'text-input', maxlength: '140', placeholder: 'Add a step, e.g. Finish Python basics', 'aria-label': `Add a step to ${s.name}`, value: d.title, oninput: (e) => { d.title = e.target.value; } }),
      el('input', { class: 'text-input', maxlength: '500', placeholder: 'Course or resource link (optional)', 'aria-label': 'Link', value: d.link, oninput: (e) => { d.link = e.target.value; } }),
      el('button', { class: 'btn small', type: 'submit' }, 'Add step')));
  }

  function render() {
    const a = document.activeElement;
    if (a && body.contains(a) && a.matches('input') && a.value) return;
    const skills = state.earn.skills;
    body.replaceChildren(...[
      ...skills.map(skillCard),
      el('form', {
        class: 'panel earn-form',
        onsubmit: async (e) => {
          e.preventDefault();
          const s = await earn('addSkill', { ...newSkill });
          if (s) { newSkill.name = ''; newSkill.goal = ''; render(); toast(`Added ${s.name}. Now break it into steps.`); }
        },
      },
      el('h2', {}, skills.length ? 'Add another skill' : 'Plan a skill that earns'),
      skills.length ? null : el('p', { class: 'hint' }, 'Pick a skill people pay for, break it into steps with a course or project for each, and focus on one step at a time. Focus time from those sessions is counted here.'),
      el('label', { class: 'field' }, el('span', {}, 'Skill'), el('input', { class: 'text-input', maxlength: '60', value: newSkill.name, placeholder: 'e.g. Python for ML, Video editing, UI design', oninput: (e) => { newSkill.name = e.target.value; } })),
      el('label', { class: 'field' }, el('span', {}, 'Goal (optional)'), el('input', { class: 'text-input', maxlength: '140', value: newSkill.goal, placeholder: 'e.g. Land a paid internship by March', oninput: (e) => { newSkill.goal = e.target.value; } })),
      el('button', { class: 'btn primary', type: 'submit' }, 'Add skill')),
    ]);
  }
  render();
  return { update(changed) { if (changed.earn) render(); } };
}

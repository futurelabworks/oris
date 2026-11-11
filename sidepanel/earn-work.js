// Earn → Work: a work timer per client or project, hourly rates, logged time and its value.
import { clientTotals, workCsv } from '../lib/earn.js';
import { formatClock } from '../lib/defaults.js';
import { money, hoursText, today, deleteButton } from './earn-common.js';
import { download } from './research-common.js';

export function mount(root, ctx) {
  const { el, state, earn, toast } = ctx;
  const body = el('div');
  root.append(body);
  let pickClient = '';
  let note = '';
  let newClient = { name: '', rate: '' };
  let manual = null; // { clientId, date, minutes, note } while the form is open
  let clock = null;

  function timerCard() {
    const S = state.earn;
    const active = S.clients.filter((c) => !c.archived);
    if (S.work) {
      const c = S.clients.find((x) => x.id === S.work.clientId);
      const time = el('p', { class: 'work-clock', role: 'timer' }, formatClock(Date.now() - S.work.startedAt));
      clearInterval(clock);
      clock = setInterval(() => { time.textContent = formatClock(Date.now() - S.work.startedAt); }, 1000);
      const earned = el('p', { class: 'source-meta' });
      const tick = () => { earned.textContent = c && c.rate ? `${money(state, Math.round(((Date.now() - S.work.startedAt) / 3600000) * c.rate))} so far at ${money(state, c.rate)}/hour` : ''; };
      tick();
      setTimeout(tick, 0);
      return el('section', { class: 'panel work-card running' },
        el('p', { class: 'current-label' }, 'Working on'),
        el('p', { class: 'current-title' }, c ? c.name : 'Deleted client', S.work.note ? el('span', { class: 'source-meta' }, `, ${S.work.note}`) : null),
        time, earned,
        el('button', {
          class: 'btn primary', onclick: async () => {
            const e = await earn('stopWork');
            toast(e ? `Logged ${hoursText(e.minutes)}` : 'Under a minute, so nothing was logged.');
          },
        }, 'Stop and log time'));
    }
    clearInterval(clock);
    if (!active.length) {
      return el('section', { class: 'panel empty-state' },
        el('h2', {}, 'Track paid work'),
        el('p', {}, 'Add a client or project with its hourly rate below, then start the timer whenever you work on it.'));
    }
    if (!active.some((c) => c.id === pickClient)) pickClient = active[0].id;
    return el('form', {
      class: 'panel work-card',
      onsubmit: async (e) => { e.preventDefault(); if (await earn('startWork', { clientId: pickClient, note })) { note = ''; } },
    },
    el('h2', {}, 'Work timer'),
    el('label', { class: 'field' }, el('span', {}, 'Client or project'),
      el('select', { class: 'text-input', onchange: (e) => { pickClient = e.target.value; } },
        ...active.map((c) => el('option', { value: c.id, selected: c.id === pickClient }, c.rate ? `${c.name} (${money(state, c.rate)}/h)` : c.name)))),
    el('label', { class: 'field' }, el('span', {}, 'What are you doing? (optional)'),
      el('input', { class: 'text-input', maxlength: '140', value: note, placeholder: 'e.g. Homepage design', oninput: (e) => { note = e.target.value; } })),
    el('button', { class: 'btn primary', type: 'submit' }, 'Start work timer'));
  }

  function clientsPanel() {
    const S = state.earn;
    const list = S.clients.filter((c) => !c.archived);
    const archived = S.clients.filter((c) => c.archived);
    return el('section', { class: 'panel' },
      el('h2', {}, 'Clients and projects'),
      list.length ? el('ul', { class: 'client-list' }, ...list.map((c) => {
        const t = clientTotals(S, c.id);
        return el('li', {},
          el('div', {}, el('span', { class: 'inc-source' }, c.name),
            el('span', { class: 'source-meta' }, `${c.rate ? `${money(state, c.rate)}/hour, ` : ''}${hoursText(t.minutes)} logged${c.rate ? `, ${money(state, Math.round(t.billed))} of work` : ''}`)),
          el('button', { class: 'btn ghost small', title: 'Hide from the timer; its time stays in reports', onclick: () => earn('updateClient', { id: c.id, patch: { archived: true } }) }, 'Archive'));
      })) : null,
      archived.length ? el('p', { class: 'hint' }, `${archived.length} archived: `, ...archived.map((c, i) => el('button', { class: 'linkish', onclick: () => earn('updateClient', { id: c.id, patch: { archived: false } }) }, `${c.name}${i < archived.length - 1 ? ',' : ''}`))) : null,
      el('form', {
        class: 'add-client',
        onsubmit: async (e) => {
          e.preventDefault();
          const c = await earn('addClient', { ...newClient });
          if (c) { newClient = { name: '', rate: '' }; pickClient = c.id; render(); toast(`Added ${c.name}`); }
        },
      },
      el('input', { class: 'text-input', maxlength: '80', placeholder: 'Client or project name', 'aria-label': 'Client or project name', value: newClient.name, oninput: (e) => { newClient.name = e.target.value; } }),
      el('input', { class: 'text-input rate', inputmode: 'decimal', placeholder: `Rate/h`, 'aria-label': `Hourly rate in ${state.earn.currency}`, value: newClient.rate, oninput: (e) => { newClient.rate = e.target.value; } }),
      el('button', { class: 'btn small', type: 'submit' }, 'Add')));
  }

  function entriesPanel() {
    const S = state.earn;
    const name = (id) => (S.clients.find((c) => c.id === id) || {}).name || 'Deleted client';
    const active = S.clients.filter((c) => !c.archived);
    const form = manual ? el('form', {
      class: 'manual-entry',
      onsubmit: async (e) => {
        e.preventDefault();
        if (await earn('addEntry', { ...manual, minutes: Math.round(Number(manual.hours || 0) * 60) })) { manual = null; render(); toast('Time added'); }
      },
    },
    el('div', { class: 'grid2' },
      el('label', { class: 'field' }, el('span', {}, 'Client'), el('select', { class: 'text-input', onchange: (e) => { manual.clientId = e.target.value; } }, ...active.map((c) => el('option', { value: c.id, selected: c.id === manual.clientId }, c.name)))),
      el('label', { class: 'field' }, el('span', {}, 'Date'), el('input', { class: 'text-input', type: 'date', value: manual.date, oninput: (e) => { manual.date = e.target.value; } }))),
    el('div', { class: 'grid2' },
      el('label', { class: 'field' }, el('span', {}, 'Hours'), el('input', { class: 'text-input', inputmode: 'decimal', placeholder: '1.5', value: manual.hours, oninput: (e) => { manual.hours = e.target.value; } })),
      el('label', { class: 'field' }, el('span', {}, 'Note'), el('input', { class: 'text-input', maxlength: '140', value: manual.note, oninput: (e) => { manual.note = e.target.value; } }))),
    el('div', { class: 'row' }, el('button', { class: 'btn primary small', type: 'submit' }, 'Add time'), el('button', { class: 'btn ghost small', type: 'button', onclick: () => { manual = null; render(); } }, 'Cancel'))) : null;

    return el('section', { class: 'panel' },
      el('div', { class: 'section-head' }, el('h2', {}, 'Logged time'),
        !manual && active.length ? el('button', { class: 'btn ghost small', onclick: () => { manual = { clientId: active[0].id, date: today(), hours: '', note: '' }; render(); } }, 'Add time by hand') : null),
      form,
      S.entries.length ? el('ul', { class: 'income-list' }, ...S.entries.slice(0, 20).map((e) => el('li', {},
        el('div', {}, el('span', { class: 'inc-source' }, name(e.clientId)),
          el('span', { class: 'source-meta' }, [new Date(e.start).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), e.note].filter(Boolean).join(', '))),
        el('div', { class: 'inc-right' },
          el('strong', {}, hoursText(e.minutes)),
          e.rate ? el('span', { class: 'source-meta' }, money(state, Math.round((e.minutes / 60) * e.rate))) : null,
          deleteButton(el, 'Delete this time entry', () => earn('deleteEntry', { id: e.id }))))))
        : el('p', { class: 'empty' }, 'Time you log shows here.'),
      S.entries.length ? el('button', { class: 'btn ghost small', onclick: () => download(`oris-work-${today()}.csv`, workCsv(S), 'text/csv') }, 'Download CSV') : null);
  }

  function render() {
    const a = document.activeElement;
    if (a && body.contains(a) && a.matches('input')) return;
    body.replaceChildren(timerCard(), clientsPanel(), entriesPanel());
  }
  render();
  return {
    update(changed) { if (changed.earn) render(); },
    unmount() { clearInterval(clock); },
  };
}

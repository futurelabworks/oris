// Earn → Overview: this month at a glance, income log, trend, top sources, follow-ups, level.
import { earnSummary, INCOME_CATEGORIES, incomeCsv } from '../lib/earn.js';
import { xpBreakdown, levelFor } from '../lib/rewards.js';
import { money, hoursText, today, niceDate, privacyButton, deleteButton, CURRENCIES } from './earn-common.js';
import { download } from './research-common.js';

export function mount(root, ctx) {
  const { el, state, earn, open } = ctx;
  const body = el('div');
  root.append(body);
  let adding = false;
  const draft = { amount: '', date: today(), source: '', clientId: '', category: 'freelance', paid: true, passive: false };
  let showAll = false;

  function addForm() {
    const clients = state.earn.clients.filter((c) => !c.archived);
    const f = el('form', {
      class: 'panel earn-form',
      onsubmit: async (e) => {
        e.preventDefault();
        const ok = await earn('addIncome', { ...draft });
        if (ok) { adding = false; Object.assign(draft, { amount: '', source: '', clientId: '', date: today(), paid: true, passive: false }); render(); ctx.toast('Income added'); }
      },
    },
    el('h2', {}, 'Add income'),
    el('div', { class: 'grid2' },
      el('label', { class: 'field' }, el('span', {}, `Amount (${state.earn.currency})`),
        el('input', { class: 'text-input', inputmode: 'decimal', required: true, value: draft.amount, placeholder: '2500', oninput: (e) => { draft.amount = e.target.value; } })),
      el('label', { class: 'field' }, el('span', {}, 'Date'),
        el('input', { class: 'text-input', type: 'date', required: true, value: draft.date, oninput: (e) => { draft.date = e.target.value; } }))),
    clients.length ? el('label', { class: 'field' }, el('span', {}, 'Client (optional)'),
      el('select', { class: 'text-input', onchange: (e) => { draft.clientId = e.target.value; } },
        el('option', { value: '' }, 'Not a client'), ...clients.map((c) => el('option', { value: c.id, selected: draft.clientId === c.id }, c.name)))) : null,
    el('label', { class: 'field' }, el('span', {}, 'From'),
      el('input', { class: 'text-input', maxlength: '80', value: draft.source, placeholder: 'e.g. Fiverr, a client, YouTube', oninput: (e) => { draft.source = e.target.value; } }),
      el('small', {}, 'Leave empty if you picked a client.')),
    el('label', { class: 'field' }, el('span', {}, 'Type'),
      el('select', { class: 'text-input', onchange: (e) => { draft.category = e.target.value; } },
        ...INCOME_CATEGORIES.map(([v, l]) => el('option', { value: v, selected: draft.category === v }, l)))),
    el('label', { class: 'toggle' }, el('span', { class: 'toggle-text' }, 'Already received', el('small', {}, 'Turn off for invoices you’re still waiting on.')),
      el('input', { type: 'checkbox', role: 'switch', checked: draft.paid, onchange: (e) => { draft.paid = e.target.checked; } })),
    el('label', { class: 'toggle' }, el('span', { class: 'toggle-text' }, 'Passive income', el('small', {}, 'Earned without hours, like affiliate or ad revenue.')),
      el('input', { type: 'checkbox', role: 'switch', checked: draft.passive, onchange: (e) => { draft.passive = e.target.checked; } })),
    el('div', { class: 'row' },
      el('button', { class: 'btn primary', type: 'submit' }, 'Add income'),
      el('button', { class: 'btn ghost', type: 'button', onclick: () => { adding = false; render(); } }, 'Cancel')));
    return f;
  }

  function render() {
    const a = document.activeElement;
    if (adding && a && body.contains(a) && a.matches('input, select')) return; // don't wipe the form while typing
    const S = state.earn;
    const sum = earnSummary(S);
    const xp = xpBreakdown(state);
    const lvl = levelFor(xp.total);
    const max = Math.max(1, ...sum.months.map((m) => m.total));
    const list = showAll ? S.income : S.income.slice(0, 8);

    body.replaceChildren(...[
      el('div', { class: 'section-head' },
        el('h2', {}, new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })),
        el('div', { class: 'row' },
          privacyButton(ctx),
          el('select', { class: 'text-input currency', 'aria-label': 'Currency', onchange: (e) => earn('setPrefs', { currency: e.target.value }) },
            ...CURRENCIES.map(([v, l]) => el('option', { value: v, selected: S.currency === v }, l))))),

      el('div', { class: 'stat-grid' },
        el('div', { class: 'stat' }, el('strong', {}, money(state, sum.monthIncome)), el('span', {}, 'received this month')),
        el('div', { class: 'stat' }, el('strong', {}, money(state, sum.pending)), el('span', {}, 'waiting to be paid')),
        el('div', { class: 'stat' }, el('strong', {}, hoursText(sum.monthMinutes)), el('span', {}, 'client work this month')),
        el('div', { class: 'stat' }, el('strong', {}, sum.perHour == null ? '—' : money(state, Math.round(sum.perHour))), el('span', {}, 'per client hour, all time'))),

      el('section', { class: 'panel' },
        el('div', { class: 'section-head' }, el('h2', {}, 'Last 6 months'), el('span', { class: 'source-meta' }, `${money(state, sum.total)} received in total`)),
        el('div', { class: 'month-bars', role: 'img', 'aria-label': 'Income received by month: ' + sum.months.map((m) => `${m.label} ${money(state, m.total)}`).join(', ') },
          ...sum.months.map((m, i) => el('div', { class: `mbar${i === 5 ? ' now' : ''}` },
            el('span', { class: 'mbar-val' }, m.total ? money(state, m.total).replace(/\.\d+$/, '') : ''),
            el('div', { class: 'mbar-track' }, el('div', { class: 'mbar-fill', style: { height: `${(m.total / max) * 100}%` } })),
            el('span', { class: 'mbar-label' }, m.label)))),
        sum.topSources.length ? el('div', { class: 'top-sources' },
          el('p', { class: 'summary-label' }, 'Top sources'),
          el('ul', {}, ...sum.topSources.map((t) => el('li', {}, el('span', {}, t.source), el('strong', {}, money(state, t.total)))))) : null),

      sum.followUps.length ? el('section', { class: 'panel due' },
        el('h2', {}, `${sum.followUps.length} follow-up${sum.followUps.length === 1 ? '' : 's'} due`),
        el('ul', { class: 'plain-list' }, ...sum.followUps.slice(0, 4).map((j) => el('li', {}, [j.role, j.company].filter(Boolean).join(' at ')))),
        el('button', { class: 'btn small', onclick: () => open('jobs') }, 'Open Jobs')) : null,

      el('button', { class: 'panel level-card', onclick: () => open('rewards') },
        el('span', { class: 'level-num' }, `Level ${lvl.level}`),
        el('span', { class: 'progress' }, el('span', { style: { width: `${(lvl.into / lvl.span) * 100}%` } })),
        el('span', { class: 'source-meta' }, `${xp.total.toLocaleString('en-IN')} XP, ${lvl.toNext.toLocaleString('en-IN')} to level ${lvl.level + 1}`)),

      adding ? addForm() : null,

      el('section', { class: 'panel' },
        el('div', { class: 'section-head' }, el('h2', {}, `Income (${S.income.length})`),
          adding ? null : el('button', { class: 'btn primary small', onclick: () => { adding = true; render(); } }, 'Add income')),
        S.income.length ? el('ul', { class: 'income-list' }, ...list.map((i) => el('li', { class: i.paid ? '' : 'pending' },
          el('div', {},
            el('span', { class: 'inc-source' }, i.source),
            el('span', { class: 'source-meta' }, [niceDate(i.date), (INCOME_CATEGORIES.find(([k]) => k === i.category) || [, ''])[1], i.passive ? 'passive' : null].filter(Boolean).join(', '))),
          el('div', { class: 'inc-right' },
            el('strong', {}, money(state, i.amount)),
            i.paid ? null : el('button', { class: 'btn small', onclick: () => earn('markPaid', { id: i.id }) }, 'Mark received'),
            deleteButton(el, `Delete ${i.source} ${i.date}`, () => earn('deleteIncome', { id: i.id }))))))
          : el('p', { class: 'empty' }, 'Log what you earn from freelancing, gigs, internships or content. Oris turns it into trends and earnings per hour.'),
        S.income.length > 8 ? el('button', { class: 'btn ghost small', onclick: () => { showAll = !showAll; render(); } }, showAll ? 'Show fewer' : `Show all ${S.income.length}`) : null,
        S.income.length ? el('button', { class: 'btn ghost small', onclick: () => download(`oris-income-${today()}.csv`, incomeCsv(S), 'text/csv') }, 'Download CSV') : null),
    ].filter(Boolean));
  }

  render();
  return { update(changed) { if (changed.earn || changed.stats || changed.planner || changed.research) render(); } };
}

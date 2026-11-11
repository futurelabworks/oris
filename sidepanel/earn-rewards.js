// Earn → Rewards: level, where XP comes from, and badges.
import { xpBreakdown, levelFor, badges } from '../lib/rewards.js';

export function mount(root, ctx) {
  const { el, state } = ctx;
  const body = el('div');
  root.append(body);

  function render() {
    const xp = xpBreakdown(state);
    const lvl = levelFor(xp.total);
    const list = badges(state);
    const got = list.filter((b) => b.got).length;
    body.replaceChildren(
      el('section', { class: 'panel level-hero' },
        el('p', { class: 'level-big' }, `Level ${lvl.level}`),
        el('p', { class: 'source-meta' }, `${xp.total.toLocaleString('en-IN')} XP`),
        el('span', { class: 'progress big' }, el('span', { style: { width: `${(lvl.into / lvl.span) * 100}%` } })),
        el('p', { class: 'hint' }, `${lvl.toNext.toLocaleString('en-IN')} XP to level ${lvl.level + 1}. XP comes only from real work, so it can’t be gamed.`)),
      el('section', { class: 'panel' },
        el('h2', {}, 'Where your XP comes from'),
        el('table', { class: 'xp-table' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Activity'), el('th', {}, 'Done'), el('th', {}, 'XP each'), el('th', {}, 'XP'))),
          el('tbody', {}, ...xp.items.map((i) => el('tr', {}, el('td', {}, i.label), el('td', {}, i.count.toLocaleString('en-IN')), el('td', {}, String(i.each)), el('td', {}, i.xp.toLocaleString('en-IN'))))))),
      el('section', { class: 'panel' },
        el('h2', {}, `Badges (${got} of ${list.length})`),
        el('ul', { class: 'badge-grid' }, ...list.map((b) => el('li', { class: b.got ? 'got' : 'locked', title: b.how },
          el('span', { class: 'badge-mark', 'aria-hidden': 'true' }, b.got ? '★' : '☆'),
          el('span', { class: 'badge-name' }, b.name),
          el('span', { class: 'badge-how' }, b.got ? 'Earned' : b.how))))),
    );
  }
  render();
  return { update(changed) { if (changed.earn || changed.stats || changed.planner || changed.research) render(); } };
}

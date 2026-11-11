const COPY = {
  earn: {
    title: 'Earn mode is on the way',
    body: 'Next up: a client work timer, a freelance and job tracker, a skill learning path and focus rewards. Your focus timer and blockers keep working from Study mode.',
  },
};

export function mount(root, ctx, params = {}) {
  const { el, open } = ctx;
  const c = COPY[params.mode] || COPY.earn;
  root.append(el('section', { class: 'panel empty-state' },
    el('h2', {}, c.title),
    el('p', {}, c.body),
    el('button', { class: 'btn primary', onclick: () => open('focus') }, 'Go to Study')));
  return {};
}

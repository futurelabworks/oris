import { BLOCK_PRESETS, normalizeDomain } from '../lib/defaults.js';
import { isFocusSession } from '../lib/rules.js';

const DISTRACTION_GROUPS = [
  { site: 'YouTube', items: [
    ['ytShorts', 'Hide Shorts', 'Shorts links open as normal videos'],
    ['ytHome', 'Hide the home feed', 'Search still works'],
    ['ytSidebar', 'Hide recommended videos next to the player', 'Playlists stay visible'],
    ['ytEndscreen', 'Hide end-screen suggestions'],
    ['ytComments', 'Hide comments'],
  ] },
  { site: 'Instagram', items: [['igReels', 'Hide Reels and Explore'], ['igFeed', 'Hide the home feed', 'Messages still work']] },
  { site: 'Facebook', items: [['fbFeed', 'Hide the news feed, Stories and Reels']] },
  { site: 'X (Twitter)', items: [['xFeed', 'Hide the home timeline and trending']] },
  { site: 'Reddit', items: [['redditFeed', 'Hide the front page and r/popular']] },
  { site: 'LinkedIn', items: [['liFeed', 'Hide the feed']] },
];

export function mount(root, ctx) {
  const { el, state, saveSettings, toast } = ctx;
  const container = el('div');
  root.append(container);
  let draft = '';

  const locked = () => state.settings.hardMode && isFocusSession(state.timer);

  function segmented(label, value, options, onPick, disabled) {
    return el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label },
      ...options.map(([v, text]) => el('button', {
        role: 'radio', 'aria-checked': String(v === value), disabled,
        onclick: () => { if (v !== value) onPick(v); },
      }, text)));
  }

  function addDomains(list, key) {
    const current = state.settings[key];
    const added = list.map(normalizeDomain).filter((d) => d && !current.includes(d));
    if (!added.length) return 0;
    saveSettings({ [key]: [...current, ...added] });
    return added.length;
  }

  function render() {
    const s = state.settings;
    const lock = locked();
    const key = s.listType === 'allow' ? 'allowlist' : 'blocklist';
    const list = s[key];

    // ---- website blocker ----
    const input = el('input', {
      type: 'text', class: 'text-input', value: draft, 'aria-label': 'Website to add',
      placeholder: s.listType === 'allow' ? 'Add an allowed site, e.g. nptel.ac.in' : 'Add a site, e.g. instagram.com',
      oninput: (e) => { draft = e.target.value; },
    });
    const submit = (e) => {
      e.preventDefault();
      const d = normalizeDomain(draft);
      if (!d) { toast('Enter a website like instagram.com', 'error'); return; }
      if (list.includes(d)) { toast(`${d} is already on the list`); return; }
      draft = '';
      addDomains([d], key);
    };

    const items = list.length
      ? el('ul', { class: 'domain-list' }, ...list.map((d) => el('li', {},
        el('span', { class: 'domain-badge', 'aria-hidden': 'true' }, d.charAt(0).toUpperCase()),
        el('span', {}, d),
        el('button', {
          class: 'icon-btn small', 'aria-label': `Remove ${d}`, title: lock && key === 'blocklist' ? 'Locked by hard mode' : `Remove ${d}`,
          disabled: lock && key === 'blocklist',
          onclick: () => saveSettings({ [key]: list.filter((x) => x !== d) }),
        }, '×'))))
      : el('p', { class: 'empty' }, s.listType === 'allow'
        ? 'No sites allowed yet. While blocking is on, every website will be blocked. Add the sites you study on.'
        : 'No sites yet. Add the ones that pull you away, or use a quick-add set below.');

    const presets = s.listType === 'block'
      ? el('div', { class: 'chips' }, ...Object.entries(BLOCK_PRESETS).map(([name, domains]) => el('button', {
        class: 'chip', onclick: () => {
          const n = addDomains(domains, 'blocklist');
          toast(n ? `Added ${n} ${name.toLowerCase()} site${n > 1 ? 's' : ''}` : `All ${name.toLowerCase()} sites are already on the list`);
        },
      }, `+ ${name}`)))
      : null;

    const inSession = state.timer.status !== 'idle';
    const status = s.blockMode === 'off' ? 'Website blocking is off.'
      : s.blockMode === 'always' ? 'Blocking is on all the time.'
      : s.blockMode === 'session' ? (inSession ? 'Blocking now, through focus and breaks, until you stop the timer.' : 'Blocking starts with a focus session and stays on through its breaks.')
      : isFocusSession(state.timer) ? 'Blocking now, until this focus session ends.' : 'Blocking starts when you start a focus session.';

    const websites = el('section', { class: 'panel' },
      el('h2', {}, 'Website blocker'),
      el('p', { class: 'hint' }, status),
      segmented('When to block websites', s.blockMode, [['off', 'Off'], ['focus', 'Focus'], ['session', 'Focus + breaks'], ['always', 'Always']],
        (v) => saveSettings({ blockMode: v }), lock),
      segmented('List type', s.listType, [['block', 'Block these sites'], ['allow', 'Allow only these']],
        (v) => saveSettings({ listType: v }), lock),
      el('form', { class: 'add-row', onsubmit: submit }, input, el('button', { class: 'btn primary', type: 'submit' }, 'Add')),
      items,
      presets,
    );

    // ---- distraction blocker ----
    const d = s.distractions;
    const distract = el('section', { class: 'panel' },
      el('h2', {}, 'Distraction blocker'),
      el('p', { class: 'hint' }, 'Keeps useful sites open but hides the parts built to keep you scrolling.'),
      segmented('When to hide distractions', s.distractMode, [['off', 'Off'], ['focus', 'During focus'], ['always', 'Always']],
        (v) => saveSettings({ distractMode: v }), lock),
      ...DISTRACTION_GROUPS.map((g) => el('fieldset', { class: 'toggle-group', disabled: s.distractMode === 'off' },
        el('legend', {}, g.site),
        ...g.items.map(([k, label, sub]) => el('label', { class: 'toggle' },
          el('span', { class: 'toggle-text' }, label, sub ? el('small', {}, sub) : null),
          el('input', {
            type: 'checkbox', role: 'switch', checked: !!d[k], disabled: lock && d[k],
            onchange: (e) => saveSettings({ distractions: { ...state.settings.distractions, [k]: e.target.checked } }),
          }),
        )),
      )),
    );

    // ---- hard mode ----
    const hard = el('section', { class: 'panel' },
      el('label', { class: 'toggle' },
        el('span', { class: 'toggle-text' }, el('strong', {}, 'Hard mode'),
          el('small', {}, 'During a focus session you can’t pause, stop, skip or loosen the blocker.')),
        el('input', {
          type: 'checkbox', role: 'switch', checked: s.hardMode, disabled: lock,
          onchange: (e) => saveSettings({ hardMode: e.target.checked }),
        }),
      ),
      lock ? el('p', { class: 'lock-note' }, 'Locked until this focus session ends.') : null,
    );

    const hadFocus = document.activeElement === container.querySelector('.add-row input');
    container.replaceChildren(websites, distract, hard);
    if (hadFocus) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  }

  render();
  return { update(changed) { if (changed.settings || changed.timer) render(); } };
}

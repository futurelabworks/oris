import { KEYS } from '../lib/defaults.js';
import { parseBackup } from '../lib/backup.js';
import { shortcutsPanel } from './shortcuts.js';
import { isFocusSession } from '../lib/rules.js';

const MODELS = [
  ['llama-3.3-70b-versatile', 'Llama 3.3 70B (best)'],
  ['openai/gpt-oss-120b', 'GPT-OSS 120B'],
  ['llama-3.1-8b-instant', 'Llama 3.1 8B (fastest)'],
];

export function mount(root, ctx) {
  const { el, state, saveSettings, toast } = ctx;
  const s = state.settings;
  const lock = s.hardMode && isFocusSession(state.timer);

  const number = (label, key, max, hint) => el('label', { class: 'field inline' },
    el('span', {}, label, hint ? el('small', {}, hint) : null),
    el('input', {
      type: 'number', min: '1', max: String(max), value: String(s[key]),
      onchange: (e) => {
        const v = Math.round(Number(e.target.value));
        if (v >= 1 && v <= max) { saveSettings({ [key]: v }); toast('Saved'); } else e.target.value = state.settings[key];
      },
    }));

  const toggle = (label, key, sub, disabled) => el('label', { class: 'toggle' },
    el('span', { class: 'toggle-text' }, label, sub ? el('small', {}, sub) : null),
    el('input', { type: 'checkbox', role: 'switch', checked: !!s[key], disabled, onchange: (e) => saveSettings({ [key]: e.target.checked }) }));

  const secret = (label, key, placeholder, helpUrl, helpText) => {
    const input = el('input', {
      type: 'password', class: 'text-input', value: s[key], placeholder, autocomplete: 'off', spellcheck: 'false',
      'aria-label': label,
      onchange: (e) => { saveSettings({ [key]: e.target.value.trim() }); toast(e.target.value.trim() ? `${label} saved` : `${label} removed`); },
    });
    return el('div', { class: 'field' },
      el('span', {}, label),
      el('div', { class: 'add-row' }, input,
        el('button', {
          type: 'button', class: 'btn small',
          onclick: (e) => { input.type = input.type === 'password' ? 'text' : 'password'; e.target.textContent = input.type === 'password' ? 'Show' : 'Hide'; },
        }, 'Show')),
      el('small', {}, el('a', { href: helpUrl, target: '_blank', rel: 'noopener' }, helpText)));
  };

  const select = (label, key, options) => el('label', { class: 'field' }, el('span', {}, label),
    el('select', { class: 'text-input', onchange: (e) => saveSettings({ [key]: e.target.value }) },
      ...options.map(([v, t]) => el('option', { value: v, selected: s[key] === v }, t))));

  async function exportData() {
    const all = await chrome.storage.local.get(null);
    const copy = { ...all, settings: { ...all.settings, groqKey: '', youtubeKey: '' } };
    const blob = new Blob([JSON.stringify({ app: 'oris', version: chrome.runtime.getManifest().version, exportedAt: new Date().toISOString(), data: copy }, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `oris-backup-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  let resetArmed = false;
  const resetBtn = el('button', {
    class: 'btn danger', disabled: lock,
    onclick: async () => {
      if (!resetArmed) {
        resetArmed = true;
        resetBtn.textContent = 'Tap again to reset stats';
        setTimeout(() => { resetArmed = false; resetBtn.textContent = 'Reset focus stats'; }, 4000);
        return;
      }
      await chrome.storage.local.set({ [KEYS.stats]: { days: {} } });
      resetArmed = false;
      resetBtn.textContent = 'Reset focus stats';
      toast('Focus stats reset');
    },
  }, 'Reset focus stats');

  // ----- restore -----
  let pendingRestore = null;
  const restoreNote = el('div', { class: 'restore', hidden: true });
  const fileInput = el('input', {
    type: 'file', accept: '.json,application/json', class: 'visually-hidden', 'aria-label': 'Choose a backup file',
    onchange: async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        pendingRestore = parseBackup(await f.text(), state.settings);
      } catch (err) {
        pendingRestore = null;
        toast(err.message, 'error');
      }
      renderRestore();
    },
  });
  function renderRestore() {
    restoreNote.hidden = !pendingRestore;
    if (!pendingRestore) return;
    const c = pendingRestore.counts;
    const when = pendingRestore.exportedAt ? new Date(pendingRestore.exportedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'an unknown date';
    restoreNote.replaceChildren(
      el('p', {}, `Backup from ${when}: ${c.sources} sources, ${c.syllabi} syllabi, ${c.tasks} tasks, ${c.days} days of focus stats.`),
      el('p', { class: 'hint' }, 'Restoring replaces that data on this device. Your API keys and the running timer stay as they are.'),
      el('div', { class: 'row' },
        el('button', {
          class: 'btn danger small', disabled: lock,
          onclick: async () => {
            await chrome.storage.local.set(pendingRestore.data);
            pendingRestore = null;
            renderRestore();
            toast('Backup restored');
          },
        }, 'Replace my data'),
        el('button', { class: 'btn ghost small', onclick: () => { pendingRestore = null; renderRestore(); } }, 'Cancel')),
    );
  }


  root.append(
    el('div', { class: 'section-head' }, el('h1', { class: 'page-title' }, 'Settings')),

    el('section', { class: 'panel' },
      el('h2', {}, 'Timer'),
      number('Focus length', 'focusMin', 300, 'minutes'),
      number('Short break', 'shortMin', 60, 'minutes'),
      number('Long break', 'longMin', 120, 'minutes'),
      number('Long break after', 'longEvery', 12, 'focus sessions'),
      toggle('Start breaks automatically', 'autoStartBreaks'),
      toggle('Start the next focus session automatically', 'autoStartFocus'),
      toggle('Notify me when a session ends', 'notify'),
      toggle('Hard mode', 'hardMode', 'No pausing, stopping or loosening the blocker during focus.', lock),
    ),

    shortcutsPanel(ctx),

    el('section', { class: 'panel' },
      el('h2', {}, 'AI'),
      toggle('Use Oris AI', 'cloudAI', 'Summaries, Ask, syllabus topics and note summaries, with a free daily allowance. The text you ask about is sent to the Oris server and then to Groq to get the answer. Nothing is stored. Turn this off and Oris uses simpler built-in methods.'),
      el('p', { class: 'hint' }, 'Want more, or a bigger model? Add your own free Groq key. Oris then talks to Groq directly and the daily allowance doesn’t apply.'),
      secret('Groq API key (optional)', 'groqKey', 'gsk_…', 'https://console.groq.com/keys', 'Get a free Groq key'),
      select('Model for your own key', 'groqModel', MODELS),
    ),

    el('section', { class: 'panel' },
      el('h2', {}, 'Videos'),
      el('p', { class: 'hint' }, 'The key is free and stays in this browser only. Without it, Oris uses plain YouTube searches.'),
      secret('YouTube API key', 'youtubeKey', 'AIza…', 'https://console.cloud.google.com/apis/library/youtube.googleapis.com', 'Enable YouTube Data API v3, then create an API key'),
      select('Video language', 'videoLang', [['en', 'English'], ['hi', 'Hindi'], ['any', 'Any language']]),
    ),

    el('section', { class: 'panel' },
      el('h2', {}, 'Look and feel'),
      el('div', { class: 'field' }, el('span', {}, 'Animations'),
        el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Animations' },
          ...[['full', 'Full'], ['low', 'Low'], ['off', 'Off']].map(([v, label]) => el('button', {
            role: 'radio', 'aria-checked': String((s.animation || 'full') === v),
            onclick: (e) => {
              saveSettings({ animation: v });
              e.target.parentNode.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b === e.target)));
            },
          }, label))),
        el('small', {}, 'Controls the New Tab transitions and session celebrations. Your system’s reduce-motion setting always turns them off.')),
      el('div', { class: 'row' },
        el('button', {
          class: 'btn small',
          onclick: async () => {
            await saveSettings({ onboarded: false });
            chrome.tabs.create({}).catch(() => {});
          },
        }, 'Run setup again'),
      ),
    ),

    el('section', { class: 'panel' },
      el('h2', {}, 'Your data'),
      el('p', { class: 'hint' }, 'Everything is stored on this device. The backup leaves out your API keys.'),
      el('div', { class: 'row' },
        el('button', { class: 'btn', onclick: exportData }, 'Download backup'),
        el('button', { class: 'btn', onclick: () => fileInput.click() }, 'Restore backup'),
        resetBtn),
      fileInput,
      restoreNote,
    ),

    el('p', { class: 'about' }, `Oris ${chrome.runtime.getManifest().version}`),
  );

  return {};
}

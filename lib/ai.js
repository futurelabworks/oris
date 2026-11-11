// One place for every AI call in Oris.
// - With the user's own Groq key: straight to Groq (their key, their model).
// - Without one: through the Oris AI server, which holds Oris's key and gives each
//   install a free daily allowance. The user can switch this off in Settings.
export const ORIS_AI_URL = 'https://evmaqpautompzugovzly.supabase.co/functions/v1/oris-ai';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const INSTALL_KEY = 'installId';

// True when some AI route is available for these settings.
export const hasAI = (settings = {}) => Boolean(settings.groqKey) || settings.cloudAI !== false;
// Which route a call will take: 'own' (user's key), 'oris' (server) or null.
export const aiRoute = (settings = {}) => (settings.groqKey ? 'own' : settings.cloudAI !== false ? 'oris' : null);

// A random id for this install, used only to count the free daily allowance.
export async function installId() {
  const r = await chrome.storage.local.get(INSTALL_KEY);
  if (r[INSTALL_KEY]) return r[INSTALL_KEY];
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [INSTALL_KEY]: id });
  return id;
}

let lastLeft = null; // free requests left today, from the server's last reply
export const freeLeft = () => lastLeft;

// Send a JSON-mode chat request and return the reply text.
// task: 'summary' | 'syllabus' | 'ask' | 'notes' | 'pyq' | 'practice' | 'plan' | 'quiz' (the server only accepts these).
export async function chatJSON({ task, messages, temperature = 0.2 }, settings = {}) {
  const route = aiRoute(settings);
  if (!route) throw new Error('AI is off. Turn on Oris AI or add a Groq key in Settings.');

  if (route === 'own') {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.groqKey}` },
      body: JSON.stringify({ model: settings.groqModel || 'llama-3.3-70b-versatile', temperature, response_format: { type: 'json_object' }, messages }),
    });
    if (!res.ok) {
      let msg = `Groq returned ${res.status}`;
      try { msg = (await res.json()).error.message || msg; } catch { /* keep status */ }
      if (res.status === 401) msg = 'Your Groq API key was rejected. Check it in Settings.';
      if (res.status === 429) msg = 'Groq rate limit reached. Wait a minute and try again.';
      throw new Error(msg);
    }
    const data = await res.json();
    return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  }

  let res;
  try {
    res = await fetch(ORIS_AI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-oris-install': await installId(), 'x-oris-version': chrome.runtime.getManifest?.().version || '' },
      body: JSON.stringify({ task, temperature, messages }),
    });
  } catch {
    throw new Error('Couldn’t reach Oris AI. Check your internet connection.');
  }
  let data = {};
  try { data = await res.json(); } catch { /* not JSON */ }
  const left = res.headers && res.headers.get && res.headers.get('x-oris-left');
  if (left !== null && left !== undefined && left !== '') lastLeft = Number(left);
  if (!res.ok) {
    if (res.status === 429 && String(data.code || '').startsWith('limit')) lastLeft = 0;
    throw new Error(data.error || `Oris AI returned ${res.status}.`);
  }
  return String(data.content || '');
}

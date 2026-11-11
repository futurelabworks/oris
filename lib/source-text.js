// Page text for saved sources, used by Ask. Stored under its own key per source
// ("rtext:<id>") so the main research record stays small and fast to rewrite.
export const TEXT_PREFIX = 'rtext:';
export const MAX_TEXT = 20000;

export const textKey = (id) => TEXT_PREFIX + id;

export async function saveText(id, text) {
  const clean = String(text || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEXT);
  if (!clean) return false;
  await chrome.storage.local.set({ [textKey(id)]: clean });
  return true;
}

export async function getTexts(ids) {
  if (!ids.length) return {};
  const r = await chrome.storage.local.get(ids.map(textKey));
  const out = {};
  for (const id of ids) if (r[textKey(id)]) out[id] = r[textKey(id)];
  return out;
}

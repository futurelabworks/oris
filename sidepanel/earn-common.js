// Shared bits for the Earn views.
import { formatMoney } from '../lib/earn.js';
import { todayKey } from '../lib/defaults.js';

export const CURRENCIES = [['INR', '₹ INR'], ['USD', '$ USD'], ['EUR', '€ EUR'], ['GBP', '£ GBP'], ['AED', 'AED'], ['CAD', 'CAD']];

export const money = (state, n) => formatMoney(n, state.earn.currency, state.earn.privacy);

export function hoursText(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

export const today = () => todayKey();

export function niceDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// Privacy toggle shown at the top of money screens.
export function privacyButton(ctx) {
  const { el, state, earn } = ctx;
  const hidden = state.earn.privacy;
  return el('button', {
    class: 'btn ghost small privacy-btn', 'aria-pressed': String(hidden), title: hidden ? 'Show amounts' : 'Hide amounts (for screen sharing)',
    onclick: () => earn('setPrefs', { privacy: !hidden }),
  }, hidden ? 'Show amounts' : 'Hide amounts');
}

// A two-tap delete button: the first tap arms it for 4 seconds.
export function deleteButton(el, label, onConfirm, cls = 'icon-btn small') {
  let armed = false;
  const b = el('button', { class: cls, 'aria-label': label, title: label }, '×');
  b.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      b.classList.add('armed');
      b.textContent = 'Delete?';
      setTimeout(() => { armed = false; b.classList.remove('armed'); b.textContent = '×'; }, 4000);
      return;
    }
    await onConfirm();
  });
  return b;
}

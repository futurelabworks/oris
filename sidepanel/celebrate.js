// A short celebration when a focus session completes: arcs burst out from the target and a
// line of text confirms it. Plays once, then removes itself. Respects the animation level.
import { motionLevel, play } from '../lib/motion.js';

const NS = 'http://www.w3.org/2000/svg';

export function celebrate(target, settings, { sessions } = {}) {
  if (!target) return;
  const level = motionLevel(settings);
  const host = document.createElement('div');
  host.className = 'celebrate';
  host.setAttribute('role', 'status');
  host.setAttribute('aria-live', 'polite');

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-100 -100 200 200');
  svg.setAttribute('aria-hidden', 'true');
  const arcs = [];
  if (level !== 'off') {
    for (let i = 0; i < 6; i++) {
      const a0 = (i * 60 * Math.PI) / 180;
      const a1 = a0 + (34 * Math.PI) / 180;
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', `M${40 * Math.cos(a0)} ${40 * Math.sin(a0)} A40 40 0 0 1 ${40 * Math.cos(a1)} ${40 * Math.sin(a1)}`);
      p.setAttribute('class', i % 2 ? 'celebrate-arc alt' : 'celebrate-arc');
      svg.appendChild(p);
      arcs.push(p);
    }
  }
  const label = document.createElement('p');
  label.className = 'celebrate-label';
  label.textContent = sessions ? `Session complete. ${sessions} today.` : 'Session complete.';
  host.append(svg, label);
  target.appendChild(host);

  const dur = level === 'full' ? 900 : 300;
  arcs.forEach((p, i) => {
    play(p, [
      { transform: 'scale(0.6) rotate(0deg)', opacity: 0 },
      { transform: 'scale(1.1) rotate(20deg)', opacity: 1, offset: 0.35 },
      { transform: `scale(${level === 'full' ? 2.1 : 1.3}) rotate(${i % 2 ? 50 : 35}deg)`, opacity: 0 },
    ], { duration: dur, easing: 'cubic-bezier(.2,.7,.2,1)', delay: i * 20 }, level);
  });
  play(label, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 240 }, level);
  setTimeout(() => {
    play(host, [{ opacity: 1 }, { opacity: 0 }], { duration: 300 }, level).then(() => host.remove());
    if (level === 'off') host.remove();
  }, level === 'off' ? 2200 : 2400);
}

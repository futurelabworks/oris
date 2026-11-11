// How much animation to play: the person's setting, overridden by the OS "reduce motion" switch.
export function motionLevel(settings) {
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'off';
  } catch { /* no matchMedia */ }
  const v = settings && settings.animation;
  return v === 'off' || v === 'low' ? v : 'full';
}

// Element.animate() that resolves when done, and does nothing when animation is off or unsupported.
export function play(el, keyframes, options, level) {
  if (level === 'off' || !el || typeof el.animate !== 'function') return Promise.resolve();
  try {
    const a = el.animate(keyframes, { fill: 'both', ...options });
    return a.finished.catch(() => {});
  } catch {
    return Promise.resolve();
  }
}

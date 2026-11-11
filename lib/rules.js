// Website-blocking logic shared by the service worker (to build declarativeNetRequest rules)
// and the blocked page (to know whether the site is still blocked).

import { normalizeDomain } from './defaults.js';

export const BLOCK_RULE_ID = 1;

export function isFocusSession(timer) {
  return timer.phase === 'focus' && (timer.status === 'running' || timer.status === 'paused');
}

// Any phase that is running or paused, breaks included.
export function isInSession(timer) {
  return timer.status === 'running' || timer.status === 'paused';
}

export function isBlockingActive(settings, timer) {
  if (settings.blockMode === 'always') return true;
  if (settings.blockMode === 'focus') return isFocusSession(timer);
  if (settings.blockMode === 'session') return isInSession(timer);
  return false;
}

export function cleanList(list) {
  return [...new Set((list || []).map(normalizeDomain).filter(Boolean))];
}

export function hostMatches(host, domain) {
  host = String(host || '').toLowerCase().replace(/^www\./, '');
  return host === domain || host.endsWith('.' + domain);
}

// Would this URL be blocked right now?
export function isUrlBlocked(url, settings, timer) {
  if (!isBlockingActive(settings, timer)) return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (settings.listType === 'allow') {
    return !cleanList(settings.allowlist).some((d) => hostMatches(u.hostname, d));
  }
  return cleanList(settings.blocklist).some((d) => hostMatches(u.hostname, d));
}

// Build the dynamic rule set. `blockedPageUrl` is chrome.runtime.getURL('blocked/blocked.html').
export function buildRules(settings, timer, blockedPageUrl) {
  if (!isBlockingActive(settings, timer)) return [];
  const condition = { regexFilter: '^https?://.*', resourceTypes: ['main_frame'] };
  if (settings.listType === 'allow') {
    const allow = cleanList(settings.allowlist);
    if (allow.length) condition.excludedRequestDomains = allow;
  } else {
    const block = cleanList(settings.blocklist);
    if (!block.length) return [];
    condition.requestDomains = block;
  }
  return [{
    id: BLOCK_RULE_ID,
    priority: 1,
    action: { type: 'redirect', redirect: { regexSubstitution: blockedPageUrl + '#\\0' } },
    condition,
  }];
}

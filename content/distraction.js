// Oris distraction blocker. Hides attention traps (Shorts, feeds, recommendations) on useful sites
// instead of blocking the whole site. Runs at document_start on the sites listed in manifest.json.
(() => {
  if (window.__orisDistraction) return;
  window.__orisDistraction = true;

  const host = location.hostname;
  const site =
    /(^|\.)youtube\.com$/.test(host) ? 'yt' :
    /(^|\.)instagram\.com$/.test(host) ? 'ig' :
    /(^|\.)facebook\.com$/.test(host) ? 'fb' :
    /(^|\.)(x|twitter)\.com$/.test(host) ? 'x' :
    /(^|\.)reddit\.com$/.test(host) ? 'reddit' :
    /(^|\.)linkedin\.com$/.test(host) ? 'li' : null;
  if (!site) return;

  // Keep in sync with DEFAULT_DISTRACTIONS in lib/defaults.js
  const DEFAULTS = {
    ytShorts: true, ytHome: true, ytSidebar: true, ytEndscreen: true, ytComments: false,
    igReels: true, igFeed: false, fbFeed: true, xFeed: true, redditFeed: false, liFeed: false,
  };

  const NOTE = (text) => `content:"${text}";display:block;padding:56px 24px;text-align:center;font:500 15px/1.5 system-ui,sans-serif;color:#7a8199;`;

  // html[data-oris-path] is set from location.pathname so rules can target one page of an SPA.
  const CSS = {
    ytShorts: `
      ytd-reel-shelf-renderer,
      ytd-rich-shelf-renderer[is-shorts],
      ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]),
      ytd-rich-section-renderer:has(ytm-shorts-lockup-view-model),
      ytd-rich-section-renderer:has(ytm-shorts-lockup-view-model-v2),
      grid-shelf-view-model:has(ytm-shorts-lockup-view-model),
      grid-shelf-view-model:has(ytm-shorts-lockup-view-model-v2),
      ytd-rich-item-renderer:has(a[href^="/shorts/"]),
      ytd-video-renderer:has(a[href^="/shorts/"]),
      ytd-grid-video-renderer:has(a[href^="/shorts/"]),
      ytd-compact-video-renderer:has(a[href^="/shorts/"]),
      ytd-guide-entry-renderer:has(a[title="Shorts"]),
      ytd-mini-guide-entry-renderer[aria-label="Shorts"],
      ytd-mini-guide-entry-renderer:has(a[title="Shorts"]),
      yt-tab-shape[tab-title="Shorts"] { display: none !important; }`,
    ytHome: `
      html[data-oris-path="/"] ytd-browse[page-subtype="home"] #primary,
      html[data-oris-path="/"] ytd-browse[page-subtype="home"] ytd-rich-grid-renderer { display: none !important; }
      html[data-oris-path="/"] ytd-browse[page-subtype="home"]::before { ${NOTE('Feed hidden by Oris. Search for what you’re studying.')} }`,
    ytSidebar: `
      ytd-watch-flexy #secondary #related,
      ytd-watch-flexy ytd-watch-next-secondary-results-renderer { display: none !important; }`,
    ytEndscreen: `
      .ytp-endscreen-content, .ytp-ce-element, .html5-endscreen,
      .ytp-autonav-endscreen-countdown-overlay, .ytp-fullscreen-grid,
      .ytp-fullscreen-grid-stills-container { display: none !important; }`,
    ytComments: `
      ytd-watch-flexy ytd-comments#comments, ytd-watch-flexy #comments { display: none !important; }`,
    igReels: `
      a[href="/reels/"], a[href^="/reels/"], a[href="/explore/"] { display: none !important; }`,
    igFeed: `
      html[data-oris-path="/"] main article,
      html[data-oris-path="/"] main [role="main"] article { display: none !important; }
      html[data-oris-path="/"] main::after { ${NOTE('Feed hidden by Oris.')} }`,
    fbFeed: `
      html[data-oris-path="/"] [role="feed"],
      html[data-oris-path="/"] [aria-label="Stories"],
      a[href*="/reel/"][role="link"] { display: none !important; }
      html[data-oris-path="/"] [role="main"]::before { ${NOTE('Feed hidden by Oris.')} }`,
    xFeed: `
      html[data-oris-path="/home"] [aria-label^="Timeline: Your Home"],
      html[data-oris-path="/home"] [aria-label^="Timeline:"],
      [data-testid="sidebarColumn"] [aria-label^="Timeline: Trending"],
      [data-testid="sidebarColumn"] section[aria-labelledby] { display: none !important; }
      html[data-oris-path="/home"] [data-testid="primaryColumn"]::after { ${NOTE('Timeline hidden by Oris.')} }`,
    redditFeed: `
      html[data-oris-path="/"] shreddit-feed,
      html[data-oris-path^="/r/popular"] shreddit-feed,
      html[data-oris-path^="/r/all"] shreddit-feed,
      html[data-oris-path="/"] #main-content > div:has(shreddit-feed) { display: none !important; }
      html[data-oris-path="/"] #main-content::after { ${NOTE('Front page hidden by Oris. Open a specific subreddit instead.')} }`,
    liFeed: `
      html[data-oris-path^="/feed"] main .scaffold-finite-scroll,
      html[data-oris-path^="/feed"] main [data-finite-scroll-hotkey-context="FEED"],
      html[data-oris-path^="/feed"] main .feed-shared-update-v2 { display: none !important; }
      html[data-oris-path^="/feed"] main::after { ${NOTE('Feed hidden by Oris.')} }`,
  };

  const style = document.createElement('style');
  style.id = 'oris-distraction-blocker';
  let enabled = [];
  let lastHref = '';

  function attachStyle() {
    if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
  }

  function isActive(settings, timer) {
    const mode = settings.distractMode || 'always';
    if (mode === 'off') return false;
    if (mode === 'always') return true;
    return timer.phase === 'focus' && (timer.status === 'running' || timer.status === 'paused');
  }

  function handleUrl() {
    document.documentElement.setAttribute('data-oris-path', location.pathname);
    if (enabled.includes('ytShorts')) {
      const m = location.pathname.match(/^\/shorts\/([\w-]{6,})/);
      if (m) { location.replace(`/watch?v=${m[1]}`); return; }
    }
    if (enabled.includes('igReels') && /^\/reels\/?$/.test(location.pathname)) {
      location.replace('/');
    }
  }

  async function refresh() {
    let data;
    try {
      data = await chrome.storage.local.get(['settings', 'timer']);
    } catch {
      return; // extension was reloaded; this old script is orphaned
    }
    const settings = data.settings || {};
    const timer = data.timer || {};
    const toggles = { ...DEFAULTS, ...(settings.distractions || {}) };
    enabled = isActive(settings, timer)
      ? Object.keys(CSS).filter((k) => k.startsWith(site) && toggles[k])
      : [];
    style.textContent = enabled.map((k) => CSS[k]).join('\n');
    attachStyle();
    handleUrl();
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes.settings || changes.timer)) refresh();
    });
  } catch { /* orphaned */ }

  // SPAs change the URL without reloading; poll cheaply instead of patching history in the page.
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      handleUrl();
    }
    attachStyle();
  }, 400);
  document.addEventListener('yt-navigate-finish', handleUrl);

  lastHref = location.href;
  document.documentElement.setAttribute('data-oris-path', location.pathname);
  refresh();
})();

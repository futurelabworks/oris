// Talks to the YouTube player inside the Oris lecture page.
//
// YouTube refuses to play some embeds placed directly in browser-extension pages, so by default the
// video runs inside a tiny relay page on GitHub Pages (docs/player/ in the repo), which uses the
// official YouTube IFrame API and passes messages back. If the relay doesn't answer, the bridge
// falls back to a direct youtube-nocookie embed driven by YouTube's postMessage protocol.
//
// Events (onEvent): { type: 'mode', mode } | { type: 'ready', d } | { type: 'time', t, d, state, rate }
//                   | { type: 'state', state } | { type: 'error', code } | { type: 'fail' }
// YouTube states: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued.

export const RELAY_URL = 'https://futurelabworks.github.io/oris/player/';
const DIRECT_ORIGIN = 'https://www.youtube-nocookie.com';
const FATAL = new Set([2, 5, 100]); // bad id / HTML5 error / removed: no point trying the other mode

export function createBridge(container, { videoId, start = 0, mode = 'auto', relayUrl = RELAY_URL, onEvent = () => {}, timeoutMs = 9000, win = window }) {
  let iframe = null;
  let current = null;   // 'relay' | 'direct'
  let ready = false;
  let timer = null;
  let poll = null;
  let vid = videoId;
  let at = start;
  const order = mode === 'direct' ? ['direct'] : mode === 'relay' ? ['relay'] : ['relay', 'direct'];
  const relayOrigin = new URL(relayUrl).origin;

  function emit(e) { try { onEvent(e); } catch (err) { console.error(err); } }

  function onMessage(e) {
    if (!iframe || e.source !== iframe.contentWindow) return;
    if (current === 'relay') {
      if (e.origin !== relayOrigin || !e.data || e.data.oris !== 1) return;
      handle(e.data);
    } else if (current === 'direct') {
      if (e.origin !== DIRECT_ORIGIN) return;
      let d = e.data;
      if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return; } }
      if (!d || !d.event) return;
      if (d.event === 'onReady') handle({ type: 'ready' });
      else if (d.event === 'initialDelivery' || d.event === 'infoDelivery') {
        const i = d.info || {};
        if (!ready && (i.duration || i.playerState !== undefined)) handle({ type: 'ready', d: i.duration || 0 });
        if (i.currentTime !== undefined || i.playerState !== undefined) handle({ type: 'time', t: i.currentTime ?? lastT, d: i.duration ?? lastD, state: i.playerState ?? lastState, rate: i.playbackRate ?? lastRate });
      } else if (d.event === 'onStateChange') handle({ type: 'state', state: d.info });
      else if (d.event === 'onError') handle({ type: 'error', code: d.info });
    }
  }
  let lastT = 0; let lastD = 0; let lastState = -1; let lastRate = 1;
  function handle(m) {
    if (m.type === 'ready') {
      if (!ready) { ready = true; clearTimeout(timer); emit({ type: 'mode', mode: current }); }
      emit({ type: 'ready', d: m.d || lastD });
    } else if (m.type === 'time') {
      lastT = Number(m.t) || 0; lastD = Number(m.d) || lastD; lastState = m.state ?? lastState; lastRate = m.rate ?? lastRate;
      emit({ type: 'time', t: lastT, d: lastD, state: lastState, rate: lastRate });
    } else if (m.type === 'state') {
      lastState = m.state;
      emit({ type: 'state', state: m.state });
    } else if (m.type === 'error') {
      if (!ready && !FATAL.has(Number(m.code))) { next(); return; }
      emit({ type: 'error', code: Number(m.code) });
    }
  }

  function next() {
    clearTimeout(timer);
    clearInterval(poll);
    const i = order.indexOf(current);
    const m = order[i + 1];
    if (!m) { emit({ type: 'fail' }); return; }
    mount(m);
  }

  function mount(m) {
    current = m;
    ready = false;
    if (iframe) iframe.remove();
    iframe = win.document.createElement('iframe');
    iframe.className = 'yt-frame';
    iframe.title = 'Lecture video';
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.setAttribute('allowfullscreen', '');
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    const origin = win.location.origin && win.location.origin !== 'null' ? win.location.origin : `${win.location.protocol}//${win.location.host}`;
    if (m === 'relay') {
      const p = new URLSearchParams({ v: vid, t: String(Math.floor(at)), o: origin });
      iframe.src = `${relayUrl}#${p}`;
    } else {
      const p = new URLSearchParams({ enablejsapi: '1', rel: '0', iv_load_policy: '3', modestbranding: '1', playsinline: '1', start: String(Math.floor(at)), origin });
      iframe.src = `${DIRECT_ORIGIN}/embed/${vid}?${p}`;
      // YouTube's widget only starts talking after a "listening" message.
      iframe.addEventListener('load', () => {
        let n = 0;
        clearInterval(poll);
        poll = setInterval(() => {
          if (ready || n++ > 20) { clearInterval(poll); return; }
          post({ event: 'listening', id: 'oris', channel: 'widget' });
        }, 400);
      });
    }
    container.replaceChildren(iframe);
    timer = setTimeout(() => { if (!ready) next(); }, timeoutMs);
  }

  function post(obj) {
    if (!iframe || !iframe.contentWindow) return;
    if (current === 'relay') iframe.contentWindow.postMessage({ oris: 1, ...obj }, relayOrigin);
    else iframe.contentWindow.postMessage(JSON.stringify(obj), DIRECT_ORIGIN);
  }
  const cmd = (func, args = []) => (current === 'relay'
    ? post({ cmd: func, args })
    : post({ event: 'command', func, args, id: 'oris', channel: 'widget' }));

  win.addEventListener('message', onMessage);
  mount(order[0]);

  return {
    get mode() { return current; },
    get ready() { return ready; },
    play: () => cmd('playVideo'),
    pause: () => cmd('pauseVideo'),
    seek: (t) => { at = t; cmd('seekTo', [Math.max(0, t), true]); },
    rate: (r) => cmd('setPlaybackRate', [r]),
    load: (id, t = 0) => { vid = id; at = t; if (ready) cmd('loadVideoById', [{ videoId: id, startSeconds: Math.floor(t) }]); else mount(current); },
    destroy: () => { clearTimeout(timer); clearInterval(poll); win.removeEventListener('message', onMessage); if (iframe) iframe.remove(); },
    _handle: handle, // for tests
  };
}

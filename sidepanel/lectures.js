// Study → Lectures: a playlist per subject (one lecture per topic, in study order), finding the
// best lectures, importing a full-course playlist, and opening the Oris lecture player.
import { playlistFor, playlistStats, fromSearch, assignImported, fmtTime } from '../lib/lectures.js';
import { topicVideos, findPlaylists, playlistVideos, parseYouTubeUrl } from '../lib/yt.js';
import { searchUrl, buildQuery } from '../lib/youtube.js';
import { subjectColor } from '../lib/study.js';

export function mount(root, ctx) {
  const { el, state, saveLectures, openPlayer, toast } = ctx;
  const body = el('div', { class: 'lectures' });
  root.append(body);
  let pick = '';          // syllabus id shown
  let busy = '';          // status text for long jobs
  let changing = '';      // topic id whose video is being changed
  const options = {};     // topicId -> candidate videos
  let pls = null;         // playlist search results for the current subject
  let link = '';
  let ytHint = '';

  // Subjects: from the study plan if there is one, otherwise every syllabus.
  function subjects() {
    const st = state.study;
    const fromPlan = (st.subjects || []).filter((s) => state.syllabi.some((y) => y.id === s.syllabusId))
      .map((s) => ({ id: s.syllabusId, name: s.name, color: subjectColor(st, s.id) }));
    if (fromPlan.length) return fromPlan;
    return state.syllabi.map((y) => ({ id: y.id, name: y.name, color: 'var(--accent)' }));
  }
  const sylOf = (id) => state.syllabi.find((y) => y.id === id);

  function explain(e) {
    if (e.code === 'yt_not_configured') { ytHint = 'Automatic lecture search isn’t switched on yet. Add your own free YouTube key in Settings, import a playlist link, or paste a video link on each topic.'; return; }
    toast(e.message || String(e), 'error');
  }

  async function findAll(syl) {
    const subj = subjects().find((s) => s.id === syl.id);
    const missing = playlistFor(syl, state.lectures, state.study.deps).filter((r) => r.topic && !r.video);
    let n = 0;
    for (const r of missing) {
      busy = `Finding lectures ${++n} of ${missing.length}…`;
      render();
      try {
        const vids = await topicVideos(r.topic.title, subj ? subj.name : syl.name, state.settings);
        options[r.topic.id] = vids;
        ytHint = '';
        if (vids[0]) await saveLectures((l) => { l.videos[r.topic.id] = fromSearch(vids[0]); });
      } catch (e) { explain(e); if (e.code === 'yt_not_configured' || /quota|limit/i.test(e.message)) break; }
    }
    busy = '';
    render();
  }

  async function searchPlaylists(syl) {
    busy = 'Looking for full-course playlists…';
    render();
    try { ytHint = ''; pls = await findPlaylists((subjects().find((s) => s.id === syl.id) || syl).name, state.settings); if (!pls.length) toast('No playlists found.'); } catch (e) { explain(e); }
    busy = '';
    render();
  }

  async function importPlaylist(syl, id, title = '') {
    busy = `Importing ${title || 'playlist'}…`;
    render();
    try {
      const vids = await playlistVideos(id, state.settings);
      if (!vids.length) throw new Error('That playlist is empty or private.');
      const { assigned, extras } = assignImported(vids, syl, state.lectures);
      await saveLectures((l) => { Object.assign(l.videos, assigned); l.extras[syl.id] = extras; });
      toast(`${vids.length} videos: ${Object.keys(assigned).length} matched to topics, ${extras.length} added at the end`);
      pls = null;
    } catch (e) { explain(e); }
    busy = '';
    render();
  }

  async function useLink(syl, topicId, text) {
    const p = parseYouTubeUrl(text);
    if (!p) { toast('That isn’t a YouTube link.', 'error'); return; }
    if (!topicId && p.playlistId) { await importPlaylist(syl, p.playlistId); return; }
    if (!p.videoId) { toast('Paste a link to a single video for a topic.', 'error'); return; }
    await saveLectures((l) => { l.videos[topicId] = { videoId: p.videoId, title: 'YouTube video', channel: '', seconds: 0, thumb: `https://i.ytimg.com/vi/${p.videoId}/mqdefault.jpg`, source: 'link' }; });
    changing = '';
    toast('Video set for this topic');
    render();
  }

  async function loadOptions(syl, topic) {
    changing = topic.id;
    render();
    if (options[topic.id]) return;
    try { options[topic.id] = await topicVideos(topic.title, (subjects().find((s) => s.id === syl.id) || syl).name, state.settings); } catch (e) { explain(e); options[topic.id] = []; }
    render();
  }

  function row(syl, r) {
    const v = r.video;
    const p = r.progress;
    const pct = p && p.dur ? Math.round((p.done ? 1 : Math.min(1, p.max / p.dur)) * 100) : 0;
    const open = r.topic && changing === r.topic.id;
    const notes = v ? (state.lectures.notes[v.videoId] || []).length : 0;
    return el('li', { class: `lec${p && p.done ? ' done' : ''}` },
      el('div', { class: 'lec-main' },
        v ? el('button', { class: 'lec-thumb', 'aria-label': `Play ${r.topic ? r.topic.title : v.title}`, onclick: () => openPlayer({ videoId: v.videoId, topicId: r.topic ? r.topic.id : '', syllabusId: syl.id }) },
          el('img', { src: v.thumb || `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`, alt: '', loading: 'lazy', onerror: (e) => { e.target.style.visibility = 'hidden'; } }),
          el('span', { class: 'lec-play' }, '▶'),
          v.seconds ? el('span', { class: 'lec-dur' }, fmtTime(v.seconds)) : null) : el('span', { class: 'lec-thumb empty' }, '—'),
        el('div', { class: 'lec-text' },
          el('span', { class: 'lec-topic' }, p && p.done ? '✓ ' : '', r.topic ? r.topic.title : v.title),
          el('span', { class: 'source-meta' }, v ? [v.title !== 'YouTube video' && r.topic ? v.title : '', v.channel, notes ? `${notes} note${notes === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ') : 'No lecture yet'),
          v && pct && !(p && p.done) ? el('span', { class: 'lec-bar' }, el('span', { style: { width: `${pct}%` } })) : null),
        r.topic ? el('button', { class: 'btn ghost small', 'aria-expanded': String(open), onclick: () => (open ? (changing = '', render()) : loadOptions(syl, r.topic)) }, open ? 'Close' : v ? 'Change' : 'Choose') : null),
      open ? el('div', { class: 'lec-change' },
        options[r.topic.id] === undefined ? el('p', { class: 'batch' }, 'Finding lectures…')
          : options[r.topic.id].length ? el('ul', { class: 'lec-options' }, ...options[r.topic.id].map((o) => el('li', {},
            el('button', {
              class: `lec-opt${v && v.videoId === o.id ? ' on' : ''}`,
              onclick: async () => { await saveLectures((l) => { l.videos[r.topic.id] = fromSearch(o, 'picked'); }); changing = ''; render(); },
            },
            el('img', { src: o.thumb, alt: '', loading: 'lazy', onerror: (e) => { e.target.style.visibility = 'hidden'; } }),
            el('span', {}, el('strong', {}, o.title), el('span', { class: 'source-meta' }, [o.channel, fmtTime(o.durationSec)].filter(Boolean).join(' · ')))))))
            : el('p', { class: 'hint' }, ytHint || 'No lectures found automatically.'),
        el('form', { class: 'lec-link', onsubmit: (e) => { e.preventDefault(); useLink(syl, r.topic.id, e.target.elements.link.value); } },
          el('input', { class: 'text-input', name: 'link', placeholder: 'Or paste a YouTube video link', 'aria-label': 'YouTube video link' }),
          el('button', { class: 'btn small', type: 'submit' }, 'Use')),
        el('div', { class: 'row' },
          el('a', { class: 'linkish', href: searchUrl(buildQuery(r.topic.title, syl.subject || syl.name, state.settings.videoLang)), target: '_blank', rel: 'noopener' }, 'Search YouTube yourself'),
          v ? el('button', { class: 'linkish', onclick: async () => { await saveLectures((l) => { delete l.videos[r.topic.id]; }); changing = ''; render(); } }, 'Remove video') : null)) : null);
  }

  function render() {
    const a = document.activeElement;
    if (a && body.contains(a) && a.matches('input')) return;
    const subs = subjects();
    if (!subs.length) {
      body.replaceChildren(el('section', { class: 'panel' }, el('h2', {}, 'Lectures'), el('p', { class: 'empty' }, 'Add a syllabus (Study → Syllabus) or set up your study plan, and Oris builds a lecture playlist for every subject.')));
      return;
    }
    if (!subs.some((s) => s.id === pick)) pick = subs[0].id;
    const syl = sylOf(pick);
    const rows = playlistFor(syl, state.lectures, state.study.deps);
    const st = playlistStats(rows);
    let lastUnit = '';
    const list = el('ul', { class: 'lec-list' });
    for (const r of rows) {
      if (r.unit !== lastUnit) { lastUnit = r.unit; list.append(el('li', { class: 'lec-unit' }, r.unit)); }
      list.append(row(syl, r));
    }
    const first = rows.find((r) => r.video && !(r.progress && r.progress.done));
    body.replaceChildren(...[
      subs.length > 1 ? el('div', { class: 'subj-tabs', role: 'tablist' }, ...subs.map((s) => el('button', { role: 'tab', 'aria-selected': String(s.id === pick), style: { '--subj': s.color }, onclick: () => { pick = s.id; pls = null; render(); } }, s.name))) : null,
      el('section', { class: 'panel lec-head' },
        el('div', { class: 'section-head' },
          el('h2', {}, `${(subs.find((s) => s.id === pick) || {}).name} playlist`),
          el('span', { class: 'pl-points' }, `★ ${state.lectures.points.total || 0}`)),
        el('p', { class: 'source-meta' }, `${st.done} of ${st.withVideo} lectures watched${st.withVideo < st.topics ? ` · ${st.topics - st.withVideo} topic${st.topics - st.withVideo === 1 ? '' : 's'} without a lecture` : ''}${st.seconds ? ` · ${fmtTime(st.seconds)} in total` : ''}`),
        el('span', { class: 'progress' }, el('span', { style: { width: `${st.withVideo ? (st.done / st.withVideo) * 100 : 0}%` } })),
        busy ? el('p', { class: 'batch' }, busy) : el('div', { class: 'row wrap' },
          first ? el('button', { class: 'btn primary small', onclick: () => openPlayer({ videoId: first.video.videoId, topicId: first.topic ? first.topic.id : '', syllabusId: syl.id }) }, st.done ? 'Continue' : 'Start watching') : null,
          st.withVideo < st.topics ? el('button', { class: 'btn small', onclick: () => findAll(syl) }, 'Find lectures for all topics') : null,
          el('button', { class: 'btn ghost small', onclick: () => searchPlaylists(syl) }, 'Find a full-course playlist')),
        ytHint ? el('p', { class: 'hint error-text' }, ytHint) : null,
        pls && pls.length ? el('ul', { class: 'find-list' }, ...pls.map((p) => el('li', { class: 'find-hit' },
          el('div', { class: 'find-main' }, el('span', { class: 'find-title' }, p.title), el('span', { class: 'find-meta' }, el('span', {}, [p.channel, p.count ? `${p.count} videos` : ''].filter(Boolean).join(' · ')))),
          el('button', { class: 'btn small', onclick: () => importPlaylist(syl, p.id, p.title) }, 'Import')))) : null,
        el('form', { class: 'lec-link', onsubmit: (e) => { e.preventDefault(); useLink(syl, '', link || e.target.elements.pl.value); } },
          el('input', { class: 'text-input', name: 'pl', placeholder: 'Paste a YouTube playlist link to import it', 'aria-label': 'YouTube playlist link', oninput: (e) => { link = e.target.value; } }),
          el('button', { class: 'btn small', type: 'submit' }, 'Import'))),
      el('section', { class: 'panel' }, list),
      el('details', { class: 'panel lec-settings' },
        el('summary', {}, 'Player settings'),
        el('label', { class: 'field' }, el('span', {}, 'How videos play'),
          el('select', { class: 'text-input', onchange: (e) => saveLectures((l) => { l.prefs.mode = e.target.value; }) },
            ...[['auto', 'Automatic (recommended)'], ['relay', 'Oris player page only'], ['direct', 'Direct YouTube embed only']].map(([v, l]) => el('option', { value: v, selected: state.lectures.prefs.mode === v }, l)))),
        el('p', { class: 'hint' }, 'YouTube ads play as normal. Oris hides recommendations and distractions around the video, not inside it.')),
    ].filter(Boolean));
  }
  render();
  return { update(changed) { if (changed.lectures || changed.syllabi || changed.study || changed.settings) render(); } };
}

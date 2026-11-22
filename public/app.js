'use strict';

/* ============ Konfigurasi ============ */
const CFG = {
  maxCatalog: 600, // lagu yang diingat untuk pencarian offline
  maxHistory: 100,
  maxRecent: 8,
  imgCache: 'sonara-img-v1', // harus sama dengan sw.js
};

/* ============ Util ============ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (n) => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const fmt = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
};
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const lean = (s) => ({ id: s.id, title: s.title, artist: s.artist, album: s.album || '', dur: s.dur || 0, thumb: s.thumb || '' });
const online = () => navigator.onLine !== false;

function thumb(s, n) {
  if (s.thumb) return /=w\d+-h\d+/.test(s.thumb) ? s.thumb.replace(/=w\d+-h\d+[^"'\s]*$/, `=w${n}-h${n}-l90-rj`) : s.thumb;
  return `https://i.ytimg.com/vi/${s.id}/hqdefault.jpg`;
}

let toastT;
function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => (t.hidden = true), ms);
}

/* ============ Penyimpanan lokal ============ */
const KEY = 'sonara:v1';
const defaults = () => ({
  liked: [], playlists: [], history: [], saved: [], catalog: {}, recent: [],
  prefs: { shuffle: false, repeat: 'off', autoplay: true },
});
function load() {
  try {
    const d = Object.assign(defaults(), JSON.parse(localStorage.getItem(KEY) || '{}'));
    d.prefs = Object.assign(defaults().prefs, d.prefs);
    return d;
  } catch (e) {
    return defaults();
  }
}
let db = load();
let saveT;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* penyimpanan penuh/diblokir */ }
  }, 200);
}
// Ingat semua lagu yang pernah muncul agar bisa dicari saat offline.
function remember(songs) {
  const c = db.catalog;
  for (const s of songs) { delete c[s.id]; c[s.id] = lean(s); }
  const ids = Object.keys(c);
  if (ids.length > CFG.maxCatalog) ids.slice(0, ids.length - CFG.maxCatalog).forEach((k) => delete c[k]);
  save();
}
const isLiked = (id) => db.liked.some((s) => s.id === id);
const isSaved = (id) => db.saved.some((s) => s.id === id);

function localSearch(q) {
  const terms = norm(q).split(/\s+/).filter(Boolean);
  const all = new Map();
  [...db.saved, ...db.liked, ...db.history, ...Object.values(db.catalog)].forEach((s) => { if (!all.has(s.id)) all.set(s.id, s); });
  return [...all.values()].filter((s) => {
    const hay = norm(`${s.title} ${s.artist} ${s.album}`);
    return terms.every((t) => hay.includes(t));
  });
}

async function api(path, params) {
  const u = new URL(path, location.origin);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u);
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

/* ============ Daftar lagu ============ */
const lists = {}; // id <ul> -> { songs, ctx, kind }

function row(s, i) {
  const on = Q.list[Q.i] && Q.list[Q.i].id === s.id;
  return `<li class="row${on ? ' on' : ''}" data-i="${i}" data-id="${esc(s.id)}">
    <button class="row-main" data-act="play" aria-label="Putar ${esc(s.title)}">
      <img class="cv" loading="lazy" decoding="async" alt="" width="56" height="56" src="${esc(thumb(s, 120))}">
      <span class="tx"><b>${esc(s.title)}</b><small>${esc(s.artist)}</small></span>
    </button>
    ${isSaved(s.id) ? `<span class="tag" title="Tersimpan">${icon('check')}</span>` : ''}
    <span class="dur">${s.dur ? fmt(s.dur) : ''}</span>
    <button class="ib" data-act="more" aria-label="Menu untuk ${esc(s.title)}">${icon('more')}</button>
  </li>`;
}

function renderList(el, songs, ctx = {}) {
  lists[el.id] = { songs, ctx, kind: 'songs' };
  el.innerHTML = songs.map((s, i) => row(s, i)).join('');
}

function markPlaying() {
  const cur = Q.list[Q.i];
  $$('li.row[data-id]').forEach((li) => li.classList.toggle('on', !!cur && li.dataset.id === cur.id));
}

document.addEventListener('click', (e) => {
  const li = e.target.closest('li.row');
  if (!li || !li.parentElement) return;
  const L = lists[li.parentElement.id];
  if (!L) return;
  if (L.kind === 'pl') { lib.pl = li.dataset.pl; renderLibrary(); return; }
  const i = +li.dataset.i;
  const s = L.songs[i];
  if (!s) return;
  const act = e.target.closest('[data-act]');
  if (!act) return;
  if (act.dataset.act === 'more') openMenu(s, L.ctx);
  else if (L.ctx.queue) { Q.i = i; playCurrent(); }
  else playQueue(L.songs, i);
});

/* ============ Pencarian ============ */
let searchSeq = 0;
const input = $('#q');

function setState(msg) { $('#searchState').textContent = msg || ''; }

function renderHome() {
  const showingResults = $('#results').children.length > 0 || $('#searchState').textContent;
  $('#home').hidden = !!showingResults && !!input.value.trim();
  $('#recentBox').hidden = !db.recent.length;
  $('#recent').innerHTML = db.recent.map((q) => `<button data-q="${esc(q)}">${esc(q)}</button>`).join('');
  const hist = db.history.slice(0, 10);
  $('#histBox').hidden = !hist.length;
  renderList($('#homeHist'), hist, { home: true });
  $('#homeEmpty').hidden = !!(db.recent.length || hist.length);
}

function addRecent(q) {
  db.recent = [q, ...db.recent.filter((x) => norm(x) !== norm(q))].slice(0, CFG.maxRecent);
  save();
}

function showResults(items, opt = {}) {
  const q = input.value.trim();
  renderList($('#results'), items, { search: true });
  if (!items.length) {
    setState(opt.offline
      ? `Tidak ada hasil offline untuk "${q}". Sambungkan internet untuk mencari lagu baru.`
      : `Tidak ada hasil untuk "${q}". Coba kata kunci lain.`);
  } else if (opt.offline) {
    setState(opt.failed
      ? `Tidak bisa terhubung ke YT Music. Menampilkan ${items.length} lagu dari penyimpanan perangkat.`
      : `Mode offline: ${items.length} lagu dari penyimpanan perangkat.`);
  } else {
    setState('');
  }
  $('#home').hidden = true;
}

async function doSearch(q) {
  q = q.trim();
  hideSuggest();
  if (!q) { clearResults(); return; }
  const seq = ++searchSeq;
  addRecent(q);
  setState('Mencari…');
  $('#results').innerHTML = '';
  $('#home').hidden = true;
  if (!online()) { showResults(localSearch(q), { offline: true }); return; }
  try {
    const { items } = await api('/api/search', { q });
    if (seq !== searchSeq) return;
    remember(items);
    showResults(items);
  } catch (e) {
    if (seq !== searchSeq) return;
    showResults(localSearch(q), { offline: true, failed: true });
  }
}

function clearResults() {
  searchSeq++;
  setState('');
  $('#results').innerHTML = '';
  renderHome();
  $('#home').hidden = false;
}

$('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); input.blur(); doSearch(input.value); });
$('#recent').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-q]');
  if (b) { input.value = b.dataset.q; doSearch(b.dataset.q); }
});
$('#clearRecent').addEventListener('click', () => { db.recent = []; save(); renderHome(); });

let sugT;
const hideSuggest = () => { $('#suggest').hidden = true; $('#suggest').innerHTML = ''; };
input.addEventListener('input', () => {
  clearTimeout(sugT);
  const q = input.value.trim();
  if (!q) { hideSuggest(); clearResults(); return; }
  if (q.length < 2 || !online()) { hideSuggest(); return; }
  sugT = setTimeout(async () => {
    try {
      const { items } = await api('/api/suggest', { q });
      if (input.value.trim() !== q || !items.length) return;
      const ul = $('#suggest');
      ul.innerHTML = items.map((t) => `<li><button type="button" data-q="${esc(t)}">${icon('search')}<span>${esc(t)}</span></button></li>`).join('');
      ul.hidden = false;
    } catch (e) { /* saran bersifat opsional */ }
  }, 250);
});
$('#suggest').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-q]');
  if (b) { input.value = b.dataset.q; doSearch(b.dataset.q); }
});
document.addEventListener('click', (e) => { if (!e.target.closest('#suggest, #searchForm')) hideSuggest(); });

/* ============ Pemutar (YouTube IFrame API) ============ */
const Q = { list: [], i: -1, playing: false, counted: '', fetching: false, errors: 0 };
let yt = null;
let ytPromise = null;

function ensureYT() {
  if (ytPromise) return ytPromise;
  ytPromise = new Promise((resolve, reject) => {
    const make = () => {
      yt = new YT.Player('yt', {
        width: '200', height: '200',
        playerVars: { playsinline: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, iv_load_policy: 3, origin: location.origin },
        events: { onReady: () => resolve(), onStateChange: onState, onError: onErr },
      });
    };
    if (window.YT && YT.Player) return make();
    window.onYouTubeIframeAPIReady = make;
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { ytPromise = null; reject(new Error('yt-api')); };
    document.head.appendChild(s);
  });
  return ytPromise;
}

async function playQueue(list, i) {
  Q.list = list.slice();
  Q.i = i;
  Q.errors = 0;
  await playCurrent();
}

async function playCurrent() {
  const s = Q.list[Q.i];
  if (!s) return;
  Q.counted = '';
  renderPlayerUI();
  if (!online()) { toast('Kamu sedang offline. Memutar lagu butuh koneksi internet.'); setPlaying(false); return; }
  try {
    await ensureYT();
    yt.loadVideoById(s.id);
  } catch (e) {
    toast('Pemutar YouTube tidak bisa dimuat. Periksa koneksi lalu coba lagi.');
    setPlaying(false);
  }
}

function onState(e) {
  const S = YT.PlayerState;
  if (e.data === S.PLAYING) {
    setPlaying(true);
    Q.errors = 0;
    const s = Q.list[Q.i];
    if (s && Q.counted !== s.id) { Q.counted = s.id; addHistory(s); prefetchRelated(s); }
  } else if (e.data === S.PAUSED) {
    setPlaying(false);
  } else if (e.data === S.ENDED) {
    setPlaying(false);
    if (db.prefs.repeat === 'one') { yt.seekTo(0, true); yt.playVideo(); } else next(true);
  }
}

function onErr() {
  Q.errors++;
  if (Q.errors >= 3) { toast('Beberapa lagu berturut-turut gagal diputar. Pemutaran dihentikan.'); setPlaying(false); return; }
  toast('Lagu ini tidak bisa diputar di sini. Lanjut ke berikutnya.');
  setTimeout(() => next(true), 900);
}

function addHistory(s) {
  db.history = [lean(s), ...db.history.filter((x) => x.id !== s.id)].slice(0, CFG.maxHistory);
  remember([s]);
  renderHome();
  if (!$('#v-library').hidden && lib.tab === 'history' && !lib.pl) renderLibrary();
}

async function loadRelated(s) {
  try {
    const { items } = await api('/api/next', { v: s.id });
    const have = new Set(Q.list.map((x) => x.id));
    const fresh = items.filter((x) => !have.has(x.id));
    remember(fresh);
    return fresh;
  } catch (e) { return []; }
}

// Isi antrean otomatis ketika lagu terakhir mulai diputar.
function prefetchRelated(s) {
  if (!db.prefs.autoplay || Q.fetching || Q.i < Q.list.length - 1 || !online()) return;
  Q.fetching = true;
  loadRelated(s).then((more) => { if (more.length) { Q.list.push(...more); renderQueue(); } }).finally(() => { Q.fetching = false; });
}

async function next(auto) {
  if (!Q.list.length) return;
  let i;
  if (db.prefs.shuffle && Q.list.length > 1) {
    do { i = Math.floor(Math.random() * Q.list.length); } while (i === Q.i);
  } else {
    i = Q.i + 1;
  }
  if (i >= Q.list.length) {
    if (db.prefs.repeat === 'all') i = 0;
    else if (db.prefs.autoplay && online()) {
      const more = await loadRelated(Q.list[Q.list.length - 1]);
      if (!more.length) { setPlaying(false); return; }
      Q.list.push(...more);
      i = Q.i + 1;
    } else { setPlaying(false); return; }
  }
  Q.i = i;
  playCurrent();
}

function prev() {
  if (!Q.list.length) return;
  if (yt && yt.getCurrentTime && yt.getCurrentTime() > 3) { yt.seekTo(0, true); return; }
  Q.i = Math.max(0, Q.i - 1);
  playCurrent();
}

function toggle() {
  if (!yt || !Q.list.length) return;
  const st = yt.getPlayerState();
  if (st === 1 || st === 3) yt.pauseVideo(); else yt.playVideo();
}

function setPlaying(p) {
  Q.playing = p;
  const label = p ? 'Jeda' : 'Putar';
  [$('#pPlay'), $('#mPlay')].forEach((b) => { b.innerHTML = icon(p ? 'pause' : 'play'); b.setAttribute('aria-label', label); });
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = p ? 'playing' : 'paused';
}

/* ---- Antrean ---- */
function renderQueue() {
  const ul = $('#queueList');
  const start = Math.max(0, Q.i);
  const end = Math.min(Q.list.length, start + 60);
  lists.queueList = { songs: Q.list, ctx: { queue: true }, kind: 'songs' };
  ul.innerHTML = Q.list.slice(start, end).map((s, k) => row(s, start + k)).join('');
}

function playNext(s) {
  if (!Q.list.length) return playQueue([s], 0);
  Q.list.splice(Q.i + 1, 0, lean(s));
  renderQueue();
  toast('Akan diputar setelah lagu ini.');
}
function addToQueue(s) {
  if (!Q.list.length) return playQueue([s], 0);
  Q.list.push(lean(s));
  renderQueue();
  toast('Ditambahkan ke antrean.');
}

/* ---- UI pemutar ---- */
function renderPlayerUI() {
  const s = Q.list[Q.i];
  if (!s) return;
  $('#mini').hidden = false;
  document.body.classList.add('has-mini');
  $('#mCover').src = thumb(s, 120);
  $('#mTitle').textContent = s.title;
  $('#mArtist').textContent = s.artist;
  $('#pCover').src = thumb(s, 544);
  $('#pTitle').textContent = s.title;
  $('#pArtist').textContent = s.artist;
  $('#tDur').textContent = fmt(s.dur);
  syncFlags();
  setMedia(s);
  markPlaying();
  renderQueue();
}

function syncFlags() {
  const s = Q.list[Q.i];
  const liked = !!s && isLiked(s.id);
  const saved = !!s && isSaved(s.id);
  const like = $('#pLike'), sv = $('#pSave');
  like.innerHTML = icon(liked ? 'heart-fill' : 'heart');
  like.setAttribute('aria-pressed', liked);
  like.setAttribute('aria-label', liked ? 'Hapus dari favorit' : 'Tambah ke favorit');
  sv.innerHTML = icon(saved ? 'check' : 'download');
  sv.setAttribute('aria-pressed', saved);
  sv.setAttribute('aria-label', saved ? 'Hapus dari tersimpan' : 'Simpan ke perangkat');
  const sh = $('#pShuffle'), rp = $('#pRepeat');
  sh.setAttribute('aria-pressed', db.prefs.shuffle);
  rp.setAttribute('aria-pressed', db.prefs.repeat !== 'off');
  rp.innerHTML = icon(db.prefs.repeat === 'one' ? 'repeat-one' : 'repeat');
  rp.setAttribute('aria-label', { off: 'Ulangi: mati', all: 'Ulangi semua', one: 'Ulangi satu lagu' }[db.prefs.repeat]);
}

function openPlayer() {
  const p = $('#player');
  p.hidden = false;
  p.classList.add('closing');
  document.body.classList.add('in-player');
  requestAnimationFrame(() => requestAnimationFrame(() => p.classList.remove('closing')));
  $('#pClose').focus({ preventScroll: true });
}
function closePlayer() {
  const p = $('#player');
  p.classList.add('closing');
  document.body.classList.remove('in-player');
  setTimeout(() => { if (p.classList.contains('closing')) p.hidden = true; }, 280);
}

$('#miniOpen').addEventListener('click', openPlayer);
$('#pClose').addEventListener('click', closePlayer);
$('#mPlay').addEventListener('click', toggle);
$('#pPlay').addEventListener('click', toggle);
$('#mNext').addEventListener('click', () => next(false));
$('#pNext').addEventListener('click', () => next(false));
$('#pPrev').addEventListener('click', prev);
$('#pMore').addEventListener('click', () => { const s = Q.list[Q.i]; if (s) openMenu(s, { player: true }); });
$('#pShuffle').addEventListener('click', () => { db.prefs.shuffle = !db.prefs.shuffle; save(); syncFlags(); });
$('#pRepeat').addEventListener('click', () => {
  db.prefs.repeat = { off: 'all', all: 'one', one: 'off' }[db.prefs.repeat];
  save(); syncFlags();
});
$('#pLike').addEventListener('click', () => { const s = Q.list[Q.i]; if (s) toggleLike(s); });
$('#pSave').addEventListener('click', () => { const s = Q.list[Q.i]; if (s) toggleSaved(s); });
$('#pQueue').addEventListener('click', () => {
  const box = $('#queueBox');
  box.hidden = !box.hidden;
  $('#pQueue').setAttribute('aria-expanded', !box.hidden);
  if (!box.hidden) { renderQueue(); box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
});

/* ---- Seek bar ---- */
const seek = $('#seek');
let dragging = false;
seek.addEventListener('input', () => {
  dragging = true;
  seek.style.setProperty('--p', seek.value / 10 + '%');
  const dur = (yt && yt.getDuration && yt.getDuration()) || (Q.list[Q.i] && Q.list[Q.i].dur) || 0;
  $('#tCur').textContent = fmt((seek.value / 1000) * dur);
});
seek.addEventListener('change', () => {
  const dur = (yt && yt.getDuration && yt.getDuration()) || 0;
  if (yt && dur) yt.seekTo((seek.value / 1000) * dur, true);
  dragging = false;
});

setInterval(() => {
  if (!yt || !yt.getCurrentTime || !Q.list.length) return;
  const cur = yt.getCurrentTime() || 0;
  const dur = yt.getDuration() || (Q.list[Q.i] && Q.list[Q.i].dur) || 0;
  const pct = dur ? Math.min(100, (cur / dur) * 100) : 0;
  $('#mFill').style.width = pct + '%';
  if (!dragging) {
    seek.value = pct * 10;
    seek.style.setProperty('--p', pct + '%');
    $('#tCur').textContent = fmt(cur);
  }
  $('#tDur').textContent = fmt(dur);
  if (dur && 'mediaSession' in navigator && navigator.mediaSession.setPositionState) {
    try { navigator.mediaSession.setPositionState({ duration: dur, position: Math.min(cur, dur), playbackRate: 1 }); } catch (e) { /* abaikan */ }
  }
}, 500);

/* ---- Media Session (tombol layar kunci / headset) ---- */
function setMedia(s) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: s.title, artist: s.artist, album: s.album || '',
    artwork: [{ src: thumb(s, 544), sizes: '544x544', type: 'image/jpeg' }],
  });
}
if ('mediaSession' in navigator) {
  const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) { /* tidak didukung */ } };
  set('play', () => yt && yt.playVideo());
  set('pause', () => yt && yt.pauseVideo());
  set('previoustrack', prev);
  set('nexttrack', () => next(false));
  set('seekto', (d) => yt && d.seekTime != null && yt.seekTo(d.seekTime, true));
  set('seekbackward', () => yt && yt.seekTo(Math.max(0, yt.getCurrentTime() - 10), true));
  set('seekforward', () => yt && yt.seekTo(yt.getCurrentTime() + 10, true));
}

/* ============ Favorit, Tersimpan, Playlist ============ */
function toggleLike(s) {
  if (isLiked(s.id)) { db.liked = db.liked.filter((x) => x.id !== s.id); toast('Dihapus dari favorit.'); }
  else { db.liked.unshift(lean(s)); remember([s]); toast('Ditambahkan ke favorit.'); }
  save(); syncFlags(); refreshLists();
}

async function precacheImages(s) {
  if (!('caches' in window)) return;
  try {
    const c = await caches.open(CFG.imgCache);
    await Promise.all([thumb(s, 120), thumb(s, 544)].map(async (u) => {
      if (await c.match(u)) return;
      const r = await fetch(u, { mode: 'cors', credentials: 'omit' });
      if (r.ok) await c.put(u, r);
    }));
  } catch (e) { /* cover akan dimuat dari jaringan bila perlu */ }
}

function toggleSaved(s) {
  if (isSaved(s.id)) { db.saved = db.saved.filter((x) => x.id !== s.id); toast('Dihapus dari tersimpan.'); }
  else {
    db.saved.unshift(lean(s)); remember([s]);
    precacheImages(s);
    toast('Disimpan. Info dan cover tersedia offline; memutar tetap butuh internet.', 4200);
  }
  save(); syncFlags(); refreshLists();
}

function newPlaylist(first) {
  const name = (prompt('Nama playlist baru') || '').trim().slice(0, 60);
  if (!name) return null;
  const p = { id: 'p' + Date.now().toString(36), name, songs: first ? [lean(first)] : [] };
  db.playlists.push(p);
  save();
  return p;
}

function refreshLists() {
  renderHome();
  if (!$('#v-library').hidden) renderLibrary();
  const hasRes = $('#results').children.length;
  if (hasRes && lists.results) renderList($('#results'), lists.results.songs, lists.results.ctx);
  renderQueue();
  markPlaying();
}

/* ============ Menu lagu (bottom sheet) ============ */
let menu = null; // { song, ctx }
const item = (ic, label, act, extra = '') =>
  `<button class="sheet-item ${extra}" data-act="${act}">${icon(ic)}<span>${esc(label)}</span></button>`;

function openSheet(head, body) {
  $('#sheetHead').innerHTML = head;
  $('#sheetBody').innerHTML = body;
  $('#sheet').hidden = false;
  $('#sheetBack').hidden = false;
  const first = $('#sheetBody button');
  if (first) first.focus({ preventScroll: true });
}
function closeSheet() { $('#sheet').hidden = true; $('#sheetBack').hidden = true; menu = null; }

function openMenu(s, ctx = {}) {
  menu = { song: s, ctx };
  const liked = isLiked(s.id), saved = isSaved(s.id);
  const head = `<img class="cv" alt="" width="48" height="48" src="${esc(thumb(s, 120))}"><span class="tx"><b>${esc(s.title)}</b><small>${esc(s.artist)}</small></span>`;
  const body = [
    item('next', 'Putar berikutnya', 'playnext'),
    item('queue', 'Tambah ke antrean', 'enqueue'),
    item(liked ? 'heart-fill' : 'heart', liked ? 'Hapus dari favorit' : 'Tambah ke favorit', 'like'),
    item(saved ? 'check' : 'download', saved ? 'Hapus dari tersimpan' : 'Simpan ke perangkat', 'save'),
    item('plus', 'Tambah ke playlist', 'addpl'),
    ctx.pl ? item('trash', 'Hapus dari playlist ini', 'rmpl', 'danger') : '',
  ].join('');
  openSheet(head, body);
}

function openPlaylistPicker() {
  const s = menu.song;
  const body = db.playlists
    .map((p) => `<button class="sheet-item" data-act="pick" data-pl="${esc(p.id)}">${icon(p.songs.some((x) => x.id === s.id) ? 'check' : 'library')}<span>${esc(p.name)}</span></button>`)
    .join('') + item('plus', 'Playlist baru', 'newpl');
  $('#sheetBody').innerHTML = body;
}

$('#sheetBack').addEventListener('click', closeSheet);
$('#sheetBody').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || !menu) return;
  const { song: s, ctx } = menu;
  switch (b.dataset.act) {
    case 'playnext': playNext(s); break;
    case 'enqueue': addToQueue(s); break;
    case 'like': toggleLike(s); break;
    case 'save': toggleSaved(s); break;
    case 'addpl': openPlaylistPicker(); return;
    case 'newpl': { const p = newPlaylist(s); if (p) toast(`Dibuat: ${p.name}`); refreshLists(); break; }
    case 'pick': {
      const p = db.playlists.find((x) => x.id === b.dataset.pl);
      if (p && !p.songs.some((x) => x.id === s.id)) { p.songs.push(lean(s)); save(); toast(`Ditambahkan ke ${p.name}.`); }
      else toast('Lagu ini sudah ada di playlist.');
      refreshLists();
      break;
    }
    case 'rmpl': {
      const p = db.playlists.find((x) => x.id === ctx.pl);
      if (p) { p.songs = p.songs.filter((x) => x.id !== s.id); save(); }
      refreshLists();
      break;
    }
    default: break;
  }
  closeSheet();
});

/* ============ Pustaka ============ */
const lib = { tab: 'liked', pl: null };

function empty(title, hint) { return `<div class="empty"><h2>${esc(title)}</h2><p>${esc(hint)}</p></div>`; }
const actions = (list) => `<div class="lib-actions">${list.map(([ic, label, act]) => `<button data-do="${act}">${icon(ic)}${esc(label)}</button>`).join('')}</div>`;

function renderLibrary() {
  $$('#libTabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === lib.tab));
  const head = $('#libHead'), ul = $('#libList'), extra = $('#libExtra');
  head.innerHTML = ''; ul.innerHTML = ''; extra.innerHTML = '';
  delete lists.libList;

  const songsView = (songs, emptyMsg, ctx = {}) => {
    if (!songs.length) { extra.innerHTML = empty(...emptyMsg); return; }
    renderList(ul, songs, ctx);
  };

  if (lib.tab === 'liked') {
    if (db.liked.length) head.innerHTML = actions([['play', 'Putar semua', 'playall'], ['shuffle', 'Acak', 'shuffleall']]);
    songsView(db.liked, ['Belum ada favorit', 'Tekan ikon hati di pemutar atau di menu lagu untuk menyimpannya di sini.']);
  } else if (lib.tab === 'saved') {
    if (db.saved.length) head.innerHTML = actions([['play', 'Putar semua', 'playall']]);
    songsView(db.saved, ['Belum ada lagu tersimpan', 'Pilih "Simpan ke perangkat" di menu lagu. Lagu tersimpan tetap muncul dan bisa dicari saat offline.']);
    extra.insertAdjacentHTML('beforeend', `<p class="note">Cover dan info lagu disimpan di perangkat. Audio tetap diputar dari YouTube, jadi memutar butuh internet.</p>
      <div class="lib-actions"><button data-do="clearcache">${icon('trash')}Bersihkan cache</button></div><p class="note" id="storeInfo"></p>`);
    storageInfo();
  } else if (lib.tab === 'history') {
    if (db.history.length) head.innerHTML = actions([['trash', 'Hapus riwayat', 'clearhist']]);
    songsView(db.history, ['Riwayat kosong', 'Lagu yang kamu putar akan muncul di sini.']);
  } else if (lib.tab === 'playlists') {
    const p = lib.pl && db.playlists.find((x) => x.id === lib.pl);
    if (p) {
      head.innerHTML = `<div class="lib-actions"><button data-do="plback">${icon('back')}Semua playlist</button></div><h2 class="lib-title">${esc(p.name)}</h2>` +
        actions([['play', 'Putar', 'playall'], ['shuffle', 'Acak', 'shuffleall'], ['more', 'Ganti nama', 'rename'], ['trash', 'Hapus', 'delpl']]);
      songsView(p.songs, ['Playlist ini masih kosong', 'Buka menu lagu mana pun lalu pilih "Tambah ke playlist".'], { pl: p.id });
    } else {
      lib.pl = null;
      head.innerHTML = actions([['plus', 'Playlist baru', 'newpl']]);
      if (!db.playlists.length) { extra.innerHTML = empty('Belum ada playlist', 'Buat playlist untuk mengelompokkan lagu favoritmu.'); }
      else {
        lists.libList = { kind: 'pl' };
        ul.innerHTML = db.playlists.map((x) => `<li class="row pl" data-pl="${esc(x.id)}"><button class="row-main" data-act="open"><span class="cv">${icon('library')}</span><span class="tx"><b>${esc(x.name)}</b><small>${x.songs.length} lagu</small></span></button></li>`).join('');
      }
    }
  }
}

async function storageInfo() {
  const el = $('#storeInfo');
  if (!el || !navigator.storage || !navigator.storage.estimate) return;
  try {
    const e = await navigator.storage.estimate();
    el.textContent = `Penyimpanan aplikasi: ${(e.usage / 1048576).toFixed(1)} MB terpakai.`;
  } catch (err) { /* abaikan */ }
}

function currentLibSongs() {
  if (lib.tab === 'liked') return db.liked;
  if (lib.tab === 'saved') return db.saved;
  if (lib.tab === 'history') return db.history;
  const p = db.playlists.find((x) => x.id === lib.pl);
  return p ? p.songs : [];
}

async function libAction(a) {
  const songs = currentLibSongs();
  switch (a) {
    case 'playall': if (songs.length) { db.prefs.shuffle = false; save(); playQueue(songs, 0); } break;
    case 'shuffleall':
      if (songs.length) { db.prefs.shuffle = true; save(); playQueue(songs, Math.floor(Math.random() * songs.length)); }
      break;
    case 'clearhist': if (confirm('Hapus seluruh riwayat?')) { db.history = []; save(); renderHome(); renderLibrary(); } break;
    case 'newpl': { const p = newPlaylist(); if (p) { lib.pl = p.id; renderLibrary(); } break; }
    case 'plback': lib.pl = null; renderLibrary(); break;
    case 'rename': {
      const p = db.playlists.find((x) => x.id === lib.pl);
      const n = p && (prompt('Nama baru', p.name) || '').trim().slice(0, 60);
      if (n) { p.name = n; save(); renderLibrary(); }
      break;
    }
    case 'delpl':
      if (confirm('Hapus playlist ini?')) { db.playlists = db.playlists.filter((x) => x.id !== lib.pl); lib.pl = null; save(); renderLibrary(); }
      break;
    case 'clearcache':
      try {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => /^sonara-(api|img)/.test(k)).map((k) => caches.delete(k)));
        toast('Cache pencarian dan cover dibersihkan.');
        storageInfo();
      } catch (e) { toast('Cache tidak bisa dibersihkan di browser ini.'); }
      break;
    default: break;
  }
}
$('#v-library').addEventListener('click', (e) => {
  const t = e.target.closest('#libTabs button');
  if (t) { lib.tab = t.dataset.tab; lib.pl = null; renderLibrary(); return; }
  const d = e.target.closest('[data-do]');
  if (d) libAction(d.dataset.do);
});

/* ============ Navigasi ============ */
function showTab(name) {
  const lb = name === 'library';
  $('#v-search').hidden = lb;
  $('#v-library').hidden = !lb;
  $$('.tabs button').forEach((b) => (b.dataset.tab === name ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  if (lb) renderLibrary(); else renderHome();
  window.scrollTo({ top: 0 });
}
$('.tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) showTab(b.dataset.tab); });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('#sheet').hidden) closeSheet();
    else if (!$('#player').hidden) closePlayer();
  } else if (e.code === 'Space' && !/^(INPUT|BUTTON|TEXTAREA)$/.test(e.target.tagName) && Q.list.length) {
    e.preventDefault();
    toggle();
  }
});

/* ============ Status jaringan, instal, service worker ============ */
function netState() {
  $('#net').hidden = online();
  if (online()) ensureYT().catch(() => {});
}
addEventListener('online', () => { netState(); toast('Kembali online.'); });
addEventListener('offline', () => { netState(); toast('Kamu offline. Pencarian memakai lagu yang tersimpan di perangkat.'); });

let installEvt = null;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('#installBtn').hidden = false; });
addEventListener('appinstalled', () => { installEvt = null; $('#installBtn').hidden = true; toast('Sonara terpasang.'); });
if (isIOS && !standalone) $('#installBtn').hidden = false;
$('#installBtn').addEventListener('click', async () => {
  if (installEvt) {
    installEvt.prompt();
    await installEvt.userChoice;
    installEvt = null;
    $('#installBtn').hidden = true;
  } else {
    toast('Di Safari: ketuk Bagikan, lalu "Tambah ke Layar Utama".', 5000);
  }
});

if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

/* ============ Mulai ============ */
netState();
renderHome();
syncFlags();
setPlaying(false);
showTab(new URLSearchParams(location.search).get('tab') === 'library' ? 'library' : 'search');
if (online()) setTimeout(() => ensureYT().catch(() => {}), 1200); // muat pemutar lebih awal agar ketukan pertama langsung bunyi

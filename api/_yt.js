'use strict';
// Helper untuk berbicara dengan API internal YouTube Music (innertube).
// Tanpa dependency: memakai fetch bawaan Node 18+.

const BASE = 'https://music.youtube.com/youtubei/v1';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Filter hasil pencarian (parameter yang sama dengan yang dipakai situs YT Music).
const FILTER = {
  song: 'EgWKAQIIAWoMEA4QChADEAQQCRAF',
  video: 'EgWKAQIQAWoMEA4QChADEAQQCRAF',
};

function clientVersion() {
  if (process.env.YTM_CLIENT_VERSION) return process.env.YTM_CLIENT_VERSION;
  const d = new Date(Date.now() - 3 * 86400000);
  const p = (n) => String(n).padStart(2, '0');
  return `1.${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}.01.00`;
}

async function yt(endpoint, body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(`${BASE}/${endpoint}?prettyPrint=false`, {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
        Origin: 'https://music.youtube.com',
        Referer: 'https://music.youtube.com/',
        'X-Origin': 'https://music.youtube.com',
        Cookie: 'SOCS=CAI',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB_REMIX',
            clientVersion: clientVersion(),
            hl: 'id',
            gl: 'ID',
          },
        },
        ...body,
      }),
    });
    if (!res.ok) throw new Error(`YT Music ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Gabungkan runs ({text}) menjadi satu string.
const text = (r) => (r && Array.isArray(r.runs) ? r.runs.map((x) => x.text).join('') : '');

// Telusuri JSON secara rekursif dan kumpulkan semua nilai dengan kunci tertentu.
function collect(node, key, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const n of node) collect(n, key, out);
    return out;
  }
  for (const k of Object.keys(node)) {
    if (k === key) out.push(node[k]);
    else collect(node[k], key, out);
  }
  return out;
}

function toSeconds(str) {
  const m = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(String(str || '').trim());
  if (!m) return 0;
  return m[3] !== undefined ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
}

// Ubah ukuran thumbnail googleusercontent (=w60-h60-...) menjadi ukuran yang diminta.
function sizeThumb(url, n = 544) {
  if (!url) return '';
  return /=w\d+-h\d+/.test(url) ? url.replace(/=w\d+-h\d+[^"'\s]*$/, `=w${n}-h${n}-l90-rj`) : url;
}

function bestThumb(list) {
  if (!Array.isArray(list) || !list.length) return '';
  return list[list.length - 1].url || '';
}

// Pecah runs berdasarkan pemisah " • " menjadi kelompok teks.
function splitRuns(runs) {
  const groups = [[]];
  for (const r of runs || []) {
    if (String(r.text).trim() === '•') groups.push([]);
    else groups[groups.length - 1].push(r.text);
  }
  return groups.map((g) => g.join('').trim()).filter(Boolean);
}

const TYPE_LABELS = new Set(['lagu', 'song', 'video', 'single', 'ep', 'album']);
const isDur = (s) => /^\d+:\d{2}(:\d{2})?$/.test(s);

function parseListItem(r) {
  const cols = r.flexColumns || [];
  const col = (i) => cols[i] && cols[i].musicResponsiveListItemFlexColumnRenderer
    ? cols[i].musicResponsiveListItemFlexColumnRenderer.text
    : null;

  const title = text(col(0));
  const id =
    (r.playlistItemData && r.playlistItemData.videoId) ||
    collect(r.overlay, 'watchEndpoint')[0]?.videoId ||
    collect(col(0), 'watchEndpoint')[0]?.videoId ||
    '';
  if (!id || !title) return null;

  let parts = splitRuns(col(1) && col(1).runs);
  if (parts.length && TYPE_LABELS.has(parts[0].toLowerCase())) parts = parts.slice(1);
  const durText = parts.find(isDur) || '';
  const rest = parts.filter((p) => !isDur(p) && !/\b(x ditonton|views|penonton)\b/i.test(p));

  return {
    id,
    title,
    artist: rest[0] || 'Artis tidak diketahui',
    album: rest[1] || '',
    dur: toSeconds(durText),
    thumb: sizeThumb(bestThumb(collect(r.thumbnail, 'thumbnails')[0])),
  };
}

function parsePanelItem(r) {
  const id = r.videoId;
  const title = text(r.title);
  if (!id || !title) return null;
  const by = splitRuns((r.longBylineText || r.shortBylineText || {}).runs);
  return {
    id,
    title,
    artist: by[0] || 'Artis tidak diketahui',
    album: by[1] && !/^\d{4}$/.test(by[1]) ? by[1] : '',
    dur: toSeconds(text(r.lengthText)),
    thumb: sizeThumb(bestThumb(r.thumbnail && r.thumbnail.thumbnails)),
  };
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((s) => s && !seen.has(s.id) && seen.add(s.id));
}

module.exports = { yt, FILTER, text, collect, parseListItem, parsePanelItem, dedupe, sizeThumb };

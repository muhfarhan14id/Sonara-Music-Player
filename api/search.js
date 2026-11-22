'use strict';
const { yt, FILTER, collect, parseListItem, dedupe } = require('./_yt');

function songsFrom(data) {
  return dedupe(collect(data, 'musicResponsiveListItemRenderer').map(parseListItem));
}

module.exports = async (req, res) => {
  const q = String((req.query && req.query.q) || '').trim().slice(0, 120);
  const type = req.query && req.query.type === 'video' ? 'video' : 'song';
  if (!q) return res.status(400).json({ error: 'Kata kunci pencarian kosong.' });

  try {
    let items = songsFrom(await yt('search', { query: q, params: FILTER[type] }));
    if (!items.length) items = songsFrom(await yt('search', { query: q }));
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({ items });
  } catch (e) {
    return res.status(502).json({ error: 'Gagal mengambil data dari YT Music.' });
  }
};

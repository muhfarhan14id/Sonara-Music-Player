'use strict';
const { yt, collect, text } = require('./_yt');

module.exports = async (req, res) => {
  const q = String((req.query && req.query.q) || '').trim().slice(0, 80);
  if (q.length < 2) return res.status(200).json({ items: [] });

  try {
    const data = await yt('music/get_search_suggestions', { input: q });
    const items = collect(data, 'searchSuggestionRenderer')
      .map((r) => text(r.suggestion))
      .filter(Boolean);
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({ items: [...new Set(items)].slice(0, 8) });
  } catch (e) {
    return res.status(200).json({ items: [] });
  }
};

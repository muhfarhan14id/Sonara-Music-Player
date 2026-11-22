'use strict';
const { yt, collect, parsePanelItem, dedupe } = require('./_yt');

module.exports = async (req, res) => {
  const v = String((req.query && req.query.v) || '').trim();
  if (!/^[\w-]{11}$/.test(v)) return res.status(400).json({ error: 'ID lagu tidak valid.' });

  try {
    const data = await yt('next', {
      videoId: v,
      playlistId: `RDAMVM${v}`,
      isAudioOnly: true,
      tunerSettingValue: 'AUTOMIX_SETTING_NORMAL',
    });
    const items = dedupe(collect(data, 'playlistPanelVideoRenderer').map(parsePanelItem)).filter(
      (s) => s.id !== v
    );
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({ items });
  } catch (e) {
    return res.status(502).json({ error: 'Gagal mengambil lagu berikutnya.' });
  }
};

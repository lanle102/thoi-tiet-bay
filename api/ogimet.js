// Nguồn METAR dự phòng: OGIMET (ogimet.com, dữ liệu WMO GTS công khai). Chỉ dùng khi aviationweather.gov lỗi.
// OGIMET giới hạn tần suất truy cập nên chỉ cho tối đa 6 sân bay mỗi lần và cache 5 phút.
const pad = n => String(n).padStart(2, '0');
const stamp = d => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const ids = String((req.query || {}).ids || '').toUpperCase().split(',').map(s => s.replace(/[^A-Z0-9]/g, '')).filter(s => s.length === 4).slice(0, 6);
  const hours = Math.min(12, Math.max(1, +(req.query || {}).hours || 3));
  if (!ids.length) return res.status(400).json({ error: 'ids không hợp lệ' });
  const end = new Date(), begin = new Date(Date.now() - hours * 3600e3);
  const out = [], errors = [];
  for (const id of ids) {
    try {
      const r = await fetch(`https://www.ogimet.com/cgi-bin/getmetar?icao=${id}&begin=${stamp(begin)}&end=${stamp(end)}`, { headers: { 'User-Agent': 'ThoiTietBay/2.0 (personal PWA)' } });
      const t = await r.text();
      if (!r.ok || /<html/i.test(t)) { errors.push(`${id}: HTTP ${r.status}`); continue; }
      for (const line of t.split('\n')) {
        const m = /^([A-Z0-9]{4}),(\d{4}),(\d{2}),(\d{2}),(\d{2}),(\d{2}),(.*)$/.exec(line.trim());
        if (!m || / NIL=?$/.test(m[7])) continue;
        const obs = Date.UTC(+m[2], +m[3] - 1, +m[4], +m[5], +m[6]) / 1000;
        out.push({ icaoId: m[1], obsTime: obs, rawOb: m[7].replace(/=\s*$/, '').trim(), source: 'OGIMET' });
      }
    } catch (e) { errors.push(`${id}: ${e.message}`); }
  }
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  res.status(200).json({ source: 'OGIMET (ogimet.com)', metars: out, errors });
};

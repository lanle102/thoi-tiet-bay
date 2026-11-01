// Proxy ADS-B công khai (không CORS): adsb.lol → airplanes.live → OpenSky Network.
// Tham số: by=callsign|reg|hex|point ; q=giá trị ; lat,lon,r (NM, ≤ 250) cho point.
const clean = s => String(s || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 10);
async function getJSON(url, ms = 9000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': 'ThoiTietBay/2.0 (personal PWA; https://lanle102.github.io/thoi-tiet-bay/)', 'Accept': 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
function readsb(base, by, q, lat, lon, rad) {
  if (by === 'point') return `${base}/v2/point/${lat}/${lon}/${rad}`;
  if (by === 'hex') return `${base}/v2/hex/${q.toLowerCase()}`;
  if (by === 'reg') return `${base}/v2/reg/${q}`;
  return `${base}/v2/callsign/${q}`;
}
async function opensky(by, q, lat, lon, rad) {
  let url;
  if (by === 'hex') url = `https://opensky-network.org/api/states/all?icao24=${q.toLowerCase()}`;
  else if (by === 'point') { const d = rad / 60, dl = d / Math.max(0.2, Math.cos(lat * Math.PI / 180)); url = `https://opensky-network.org/api/states/all?lamin=${lat - d}&lomin=${lon - dl}&lamax=${lat + d}&lomax=${lon + dl}`; }
  else throw new Error('OpenSky không hỗ trợ tìm theo ' + by);
  const j = await getJSON(url, 20000);
  return { now: (j.time || 0) * 1000, ac: (j.states || []).map(s => ({ hex: s[0], flight: (s[1] || '').trim(), lon: s[5], lat: s[6], alt_baro: s[7] != null ? Math.round(s[7] * 3.28084) : null, alt_geom: s[13] != null ? Math.round(s[13] * 3.28084) : null,
    gs: s[9] != null ? s[9] * 1.94384 : null, track: s[10], baro_rate: s[11] != null ? Math.round(s[11] * 196.85) : null, squawk: s[14], seen_pos: s[3] ? Math.max(0, j.time - s[3]) : null, ground: s[8], country: s[2] })) };
}
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const p = req.query || {};
  const by = ['callsign', 'reg', 'hex', 'point'].includes(p.by) ? p.by : 'callsign';
  const q = clean(p.q);
  const lat = +p.lat, lon = +p.lon, rad = Math.min(250, Math.max(5, +p.r || 40));
  if (by === 'point' ? !(isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) : q.length < 2) return res.status(400).json({ error: 'Tham số không hợp lệ' });
  if (by === 'hex' && !/^[0-9A-F]{6}$/.test(q)) return res.status(400).json({ error: 'Mã hex ICAO gồm 6 ký tự 0-9/A-F' });
  const tried = [];
  const srcs = [['adsb.lol', () => getJSON(readsb('https://api.adsb.lol', by, q, lat, lon, rad))], ['airplanes.live', () => getJSON(readsb('https://api.airplanes.live', by, q, lat, lon, rad))], ['adsb.fi', () => getJSON(by === 'point' ? `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${rad}` : by === 'hex' ? `https://opendata.adsb.fi/api/v2/hex/${q.toLowerCase()}` : by === 'reg' ? `https://opendata.adsb.fi/api/v2/registration/${q}` : `https://opendata.adsb.fi/api/v2/callsign/${q}`)], ['OpenSky Network', () => opensky(by, q, lat, lon, rad)]];
  if (by === 'point') { // gộp mọi nguồn, loại trùng theo hex → nhiều máy bay nhất
    const rs = await Promise.allSettled(srcs.map(([, fn]) => fn()));
    const map = new Map(), used = []; let now = 0;
    rs.forEach((r, i) => {
      const name = srcs[i][0];
      if (r.status !== 'fulfilled') { tried.push(name + ': ' + (r.reason?.name === 'AbortError' ? 'hết thời gian' : r.reason?.message)); return; }
      const ac = (r.value.ac || r.value.aircraft || []).filter(a => a.lat != null && a.hex);
      used.push(name + ' ' + ac.length); now = Math.max(now, r.value.now || 0);
      for (const a of ac) {
        const h = a.hex.toLowerCase(); if (a.ground && a.alt_baro == null) a.alt_baro = 'ground';
        const o = map.get(h);
        if (!o) map.set(h, { ...a, hex: h }); else for (const k in a) if (o[k] == null || o[k] === '') o[k] = a[k];
      }
    });
    if (!used.length) return res.status(200).json({ source: null, ac: [], tried, error: 'Không nguồn ADS-B nào trả dữ liệu' });
    res.setHeader('Cache-Control', 'public, s-maxage=4, stale-while-revalidate=8');
    return res.status(200).json({ source: used.join(' + '), now: now || Date.now(), ac: [...map.values()], tried });
  }
  for (const [name, fn] of srcs) {
    try {
      const j = await fn();
      const ac = (j.ac || j.aircraft || []).filter(a => a.lat != null || by !== 'point');
      if (!ac.length && name !== 'OpenSky Network' && by !== 'point') { tried.push(name + ': không thấy'); continue; }
      res.setHeader('Cache-Control', 'public, s-maxage=4, stale-while-revalidate=8');
      return res.status(200).json({ source: name, now: j.now || Date.now(), ac, tried });
    } catch (e) { tried.push(name + ': ' + (e.name === 'AbortError' ? 'hết thời gian' : e.message)); }
  }
  res.status(200).json({ source: null, ac: [], tried, error: 'Không nguồn ADS-B nào trả dữ liệu' });
};

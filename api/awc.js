// Proxy nhỏ cho API công khai aviationweather.gov (vì API này không trả header CORS).
// Chỉ cho phép các endpoint đọc dữ liệu: metar, taf, airport, stationinfo.
const ALLOWED = new Set(['metar', 'taf', 'airport', 'stationinfo']);
const ALLOWED_PARAMS = new Set(['ids', 'format', 'taf', 'hours', 'date', 'time', 'bbox']);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  const q = req.query || {};
  const type = String(q.type || '');
  if (!ALLOWED.has(type)) { res.status(400).json({ error: 'type không hợp lệ' }); return; }
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (ALLOWED_PARAMS.has(k)) params.set(k, String(v).slice(0, 400));
  }
  if (!params.has('format')) params.set('format', 'json');
  const url = `https://aviationweather.gov/api/data/${type}?${params}`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'ThoiTietBay/1.0 (personal PWA)' } });
    const body = await r.text();
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    res.status(r.status === 204 ? 200 : r.status).send(r.status === 204 ? '[]' : body);
  } catch (e) {
    res.status(502).json({ error: 'Không kết nối được aviationweather.gov', detail: String(e) });
  }
};

// Proxy ADS-B (chạy tại sin1): adsb.lol, adsb.fi, adsb.one, airplanes.live, OpenSky.
// Gọi song song, retry 1 lần, trả khi đã có dữ liệu (không chờ nguồn chậm hết timeout).
// Cache ~8s theo toạ độ làm tròn / theo mã tìm.
const UA = { 'User-Agent': 'ThoiTietBay/2.0 (personal PWA; https://lanle102.github.io/thoi-tiet-bay/)', Accept: 'application/json' };
const clean = s => String(s || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 10);
const mem = new Map(); // key -> { exp, body }
const MEM_MS = 8000;

async function getJSON(url, ms = 8000, retries = 1) {
  let last;
  for (let i = 0; i <= retries; i++) {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), i === 0 ? ms : Math.max(ms, 10000));
    try {
      const r = await fetch(url, { signal: c.signal, headers: UA });
      if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      return await r.json();
    } catch (e) {
      last = e;
      const retryable = !e.status || e.status >= 500 || e.name === 'AbortError' || e.name === 'TypeError';
      if (!retryable || i === retries) throw e;
    } finally { clearTimeout(t); }
  }
  throw last;
}
function readsb(base, by, q, lat, lon, rad) {
  if (by === 'point') return `${base}/v2/point/${lat}/${lon}/${rad}`;
  if (by === 'hex') return `${base}/v2/hex/${q.toLowerCase()}`;
  if (by === 'reg') return `${base}/v2/reg/${q}`;
  return `${base}/v2/callsign/${q}`;
}
function fiUrl(by, q, lat, lon, rad) {
  if (by === 'point') return `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${rad}`;
  if (by === 'hex') return `https://opendata.adsb.fi/api/v2/hex/${q.toLowerCase()}`;
  if (by === 'reg') return `https://opendata.adsb.fi/api/v2/registration/${q}`;
  return `https://opendata.adsb.fi/api/v2/callsign/${q}`;
}
async function opensky(by, q, lat, lon, rad) {
  let url;
  if (by === 'hex') url = `https://opensky-network.org/api/states/all?icao24=${q.toLowerCase()}`;
  else if (by === 'point') { const d = rad / 60, dl = d / Math.max(0.2, Math.cos(lat * Math.PI / 180)); url = `https://opensky-network.org/api/states/all?lamin=${lat - d}&lomin=${lon - dl}&lamax=${lat + d}&lomax=${lon + dl}`; }
  else throw new Error('OpenSky không hỗ trợ tìm theo ' + by);
  const j = await getJSON(url, 12000);
  return { now: (j.time || 0) * 1000, ac: (j.states || []).map(s => ({ hex: s[0], flight: (s[1] || '').trim(), lon: s[5], lat: s[6], alt_baro: s[7] != null ? Math.round(s[7] * 3.28084) : null, alt_geom: s[13] != null ? Math.round(s[13] * 3.28084) : null,
    gs: s[9] != null ? s[9] * 1.94384 : null, track: s[10], baro_rate: s[11] != null ? Math.round(s[11] * 196.85) : null, squawk: s[14], seen_pos: s[3] ? Math.max(0, j.time - s[3]) : null, ground: s[8], country: s[2] })) };
}
function asMs(n) { n = +n || 0; return n ? (n < 1e12 ? n * 1000 : n) : 0; }
function cacheKey(by, q, lat, lon, rad) {
  return by === 'point' ? `p:${lat.toFixed(2)}:${lon.toFixed(2)}:${rad}` : `${by}:${q}`;
}
function takeCache(key) {
  const hit = mem.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) { mem.delete(key); return null; }
  return hit.body;
}
function putCache(key, body) { mem.set(key, { exp: Date.now() + MEM_MS, body }); if (mem.size > 80) for (const [k, v] of mem) if (Date.now() > v.exp) mem.delete(k); }

// Chạy song song; khi đã có ít nhất một nguồn thành công thì chờ thêm `grace` ms rồi trả, không đợi nguồn chậm hết timeout.
function gather(srcs, { grace = 3000, hard = 12000 } = {}) {
  return new Promise(resolve => {
    const results = new Array(srcs.length);
    let settled = 0, got = false, done = false;
    let graceTimer, hardTimer;
    const finish = () => {
      if (done) return; done = true;
      clearTimeout(graceTimer); clearTimeout(hardTimer);
      resolve(results.map((r, i) => r || { status: 'rejected', reason: Object.assign(new Error('chưa kịp trả'), { name: 'AbortError' }) }));
    };
    hardTimer = setTimeout(finish, hard);
    srcs.forEach(([, fn], i) => {
      Promise.resolve().then(fn).then(value => {
        results[i] = { status: 'fulfilled', value };
        settled++; got = true;
        if (!graceTimer) graceTimer = setTimeout(finish, grace);
        if (settled === srcs.length) finish();
      }, reason => {
        results[i] = { status: 'rejected', reason };
        settled++;
        if (settled === srcs.length) finish();
      });
    });
  });
}
function mergeResults(srcs, rs) {
  const map = new Map(), used = [], parts = [], tried = []; let now = 0;
  rs.forEach((r, i) => {
    const name = srcs[i][0];
    if (r.status !== 'fulfilled') {
      const err = r.reason?.name === 'AbortError' ? (r.reason?.message === 'chưa kịp trả' ? 'chưa kịp trả' : 'hết thời gian') : (r.reason?.message || 'lỗi');
      tried.push(name + ': ' + err); parts.push({ name, n: 0, err }); return;
    }
    const ac = (r.value.ac || r.value.aircraft || []).filter(a => a && a.hex && a.lat != null);
    used.push(name + ' ' + ac.length); parts.push({ name, n: ac.length }); now = Math.max(now, asMs(r.value.now) || 0);
    for (const a of ac) {
      const h = String(a.hex).toLowerCase(); if (a.ground && a.alt_baro == null) a.alt_baro = 'ground';
      const o = map.get(h);
      if (!o) map.set(h, { ...a, hex: h }); else for (const k in a) if (o[k] == null || o[k] === '') o[k] = a[k];
    }
  });
  return { used, parts, tried, now, ac: [...map.values()] };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const region = process.env.VERCEL_REGION || '';
  if (region) res.setHeader('x-ttb-region', region);
  const p = req.query || {};
  const by = ['callsign', 'reg', 'hex', 'point'].includes(p.by) ? p.by : 'callsign';
  const q = clean(p.q);
  const lat = +p.lat, lon = +p.lon, rad = Math.min(250, Math.max(5, +p.r || 40));
  if (by === 'point' ? !(isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) : q.length < 2) return res.status(400).json({ error: 'Tham số không hợp lệ' });
  if (by === 'hex' && !/^[0-9A-F]{6}$/.test(q)) return res.status(400).json({ error: 'Mã hex ICAO gồm 6 ký tự 0-9/A-F' });

  const key = cacheKey(by, q, lat, lon, rad);
  const cached = takeCache(key);
  if (cached) {
    res.setHeader('Cache-Control', 'public, s-maxage=8, stale-while-revalidate=16');
    return res.status(200).json({ ...cached, cached: true, region: cached.region || region });
  }

  const srcs = [
    ['adsb.lol', () => getJSON(readsb('https://api.adsb.lol', by, q, lat, lon, rad))],
    ['adsb.fi', () => getJSON(fiUrl(by, q, lat, lon, rad))],
    ['adsb.one', () => getJSON(readsb('https://api.adsb.one', by, q, lat, lon, rad))],
    ['airplanes.live', () => getJSON(readsb('https://api.airplanes.live', by, q, lat, lon, rad))],
    ['OpenSky Network', () => opensky(by, q, lat, lon, rad)]
  ];
  const rs = await gather(srcs);
  const { used, parts, tried, now, ac } = mergeResults(srcs, rs);
  const body = {
    source: used.length ? used.join(' + ') : null,
    now: now || Date.now(),
    ac, tried, parts, region,
    error: used.length ? undefined : 'Không nguồn ADS-B nào trả dữ liệu'
  };
  if (used.length) putCache(key, body);
  res.setHeader('Cache-Control', 'public, s-maxage=8, stale-while-revalidate=16');
  return res.status(200).json(body);
};

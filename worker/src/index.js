// Cloudflare Worker: proxy ADS-B cho «Thời Tiết Bay» (thay /api/adsb trên Vercel – Vercel bị adsb.lol chặn).
// Cùng hợp đồng với api/adsb.js: GET /api/adsb?by=point|reg|callsign|hex&q=..&lat=..&lon=..&r=..
// Trả { source, now, ac, tried, parts, region, error? }. Gọi song song, retry nhanh, gộp theo hex, cache biên ~8s.
import regLib from '../../reg.js';
const { expandReg } = regLib;

const ORIGINS = [/^https:\/\/lanle102\.github\.io$/, /^https:\/\/([a-z0-9-]+\.)*thoi-tiet-bay[a-z0-9-]*\.vercel\.app$/, /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', Accept: 'application/json,text/plain,*/*', 'Accept-Language': 'en-US,en;q=0.9' };
const clean = s => String(s || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12);
const CACHE_S = 8;

function cors(req) {
  const o = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.some(r => r.test(o)) ? o : 'https://lanle102.github.io',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

async function getJSON(url, ms = 12000, retries = 1) {
  let last;
  for (let i = 0; i <= retries; i++) {
    const started = Date.now();
    const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, { signal: c.signal, headers: UA });
      if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      return await r.json();
    } catch (e) {
      last = e; e.ms = Date.now() - started;
      const retryable = !e.status || e.status >= 500 || e.status === 429 || e.name === 'AbortError' || e.name === 'TypeError';
      if (!retryable || i === retries || e.ms > 3000) throw e;
      await new Promise(r => setTimeout(r, 300));
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
  const j = await getJSON(url, 10000, 0);
  return { now: (j.time || 0) * 1000, ac: (j.states || []).map(s => ({ hex: s[0], flight: (s[1] || '').trim(), lon: s[5], lat: s[6], alt_baro: s[7] != null ? Math.round(s[7] * 3.28084) : null, alt_geom: s[13] != null ? Math.round(s[13] * 3.28084) : null,
    gs: s[9] != null ? s[9] * 1.94384 : null, track: s[10], baro_rate: s[11] != null ? Math.round(s[11] * 196.85) : null, squawk: s[14], seen_pos: s[3] ? Math.max(0, j.time - s[3]) : null, ground: s[8], country: s[2] })) };
}
const asMs = n => { n = +n || 0; return n ? (n < 1e12 ? n * 1000 : n) : 0; };

function gather(srcs, { grace = 2500, hard = 15000 } = {}) {
  return new Promise(resolve => {
    const results = Array.from({ length: srcs.length }, () => null);
    let settled = 0, done = false, graceTimer;
    const finish = () => {
      if (done) return; done = true; clearTimeout(graceTimer); clearTimeout(hardTimer);
      resolve(results.map(r => r || { status: 'rejected', reason: Object.assign(new Error('chưa kịp trả'), { name: 'AbortError' }) }));
    };
    const hasAc = () => results.some(r => r && r.status === 'fulfilled' && (r.value.ac || r.value.aircraft || []).some(a => a && a.hex && a.lat != null));
    const hardTimer = setTimeout(finish, hard);
    srcs.forEach(([, fn], i) => {
      Promise.resolve().then(fn).then(value => {
        results[i] = { status: 'fulfilled', value }; settled++;
        if (hasAc() && !graceTimer) graceTimer = setTimeout(finish, grace);
        if (settled === srcs.length) finish();
      }, reason => { results[i] = { status: 'rejected', reason }; settled++; if (settled === srcs.length) finish(); });
    });
  });
}
function mergeResults(srcs, rs) {
  const map = new Map(), used = [], parts = [], tried = []; let now = 0;
  rs.forEach((r, i) => {
    const name = srcs[i][0];
    if (r.status !== 'fulfilled') {
      const err = r.reason?.name === 'AbortError' ? (r.reason?.message === 'chưa kịp trả' ? 'chưa kịp trả' : 'hết thời gian') : (r.reason?.message || 'lỗi');
      tried.push(name + ': ' + err); parts.push({ name, n: 0, err, ms: r.reason?.ms }); return;
    }
    const ac = (r.value.ac || r.value.aircraft || []).filter(a => a && a.hex && a.lat != null);
    used.push(name + ' ' + ac.length); parts.push({ name, n: ac.length, ms: r.value._ms }); now = Math.max(now, asMs(r.value.now) || 0);
    for (const a of ac) {
      const h = String(a.hex).toLowerCase(); if (a.ground && a.alt_baro == null) a.alt_baro = 'ground';
      const o = map.get(h);
      if (!o) map.set(h, { ...a, hex: h }); else for (const k in a) if (o[k] == null || o[k] === '') o[k] = a[k];
    }
  });
  return { used, parts, tried, now, ac: [...map.values()] };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}

async function handleAdsb(req, url, ctx) {
  const ch = cors(req);
  const p = url.searchParams;
  const by = ['callsign', 'reg', 'hex', 'point'].includes(p.get('by')) ? p.get('by') : 'callsign';
  let q = clean(p.get('q'));
  if (by === 'reg') { const exp = expandReg(q); if (exp) q = exp; }
  const lat = +p.get('lat'), lon = +p.get('lon'), rad = Math.round(Math.min(250, Math.max(5, +p.get('r') || 40)));
  if (by === 'point' ? !(p.get('lat') && p.get('lon') && isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) : q.length < 2) return json({ error: 'Tham số không hợp lệ' }, 400, ch);
  if (by === 'hex' && !/^[0-9A-F]{6}$/.test(q)) return json({ error: 'Mã hex ICAO gồm 6 ký tự 0-9/A-F' }, 400, ch);
  const la = by === 'point' ? +lat.toFixed(2) : 0, lo = by === 'point' ? +lon.toFixed(2) : 0;

  // Cache biên theo khoá chuẩn hoá (toạ độ làm tròn 0.01°)
  const key = new Request(`https://cache.ttb/adsb/${by === 'point' ? `p/${la}/${lo}/${rad}` : `${by}/${q}`}`);
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) { const b = await hit.json(); return json({ ...b, cached: true }, 200, { ...ch, 'Cache-Control': `public, max-age=${CACHE_S}` }); }

  const colo = req.cf?.colo || '';
  const srcs = [
    ['adsb.lol', () => getJSON(readsb('https://api.adsb.lol', by, q, la, lo, rad))],
    ['adsb.fi', () => getJSON(fiUrl(by, q, la, lo, rad))],
    ['adsb.one', () => getJSON(readsb('https://api.adsb.one', by, q, la, lo, rad))],
    ['airplanes.live', () => getJSON(readsb('https://api.airplanes.live', by, q, la, lo, rad))],
    ['OpenSky Network', () => opensky(by, q, la, lo, rad)]
  ];
  const timed = srcs.map(([name, fn]) => [name, async () => {
    const t0 = Date.now();
    try { const v = await fn(); v._ms = Date.now() - t0; return v; } catch (e) { e.ms = e.ms || (Date.now() - t0); throw e; }
  }]);
  const rs = await gather(timed);
  const { used, parts, tried, now, ac } = mergeResults(srcs, rs);
  const body = { source: used.length ? used.join(' + ') : null, now: now || Date.now(), ac, tried, parts, region: 'cf-' + colo, via: 'cloudflare' };
  if (!used.length) body.error = 'Không nguồn ADS-B nào trả dữ liệu';
  const incomplete = parts.some(x => x.err === 'chưa kịp trả' || x.err === 'hết thời gian');
  const lolFailed = parts.some(x => x.name === 'adsb.lol' && x.err);
  const cacheable = used.length && !incomplete && !(lolFailed && !ac.length);
  if (cacheable) ctx.waitUntil(cache.put(key, new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${CACHE_S}` } })));
  return json(body, 200, { ...ch, 'Cache-Control': cacheable ? `public, max-age=${CACHE_S}` : 'no-store' });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    if (req.method !== 'GET') return json({ error: 'Chỉ hỗ trợ GET' }, 405, cors(req));
    if (url.pathname === '/api/adsb' || url.pathname === '/adsb') return handleAdsb(req, url, ctx);
    if (url.pathname === '/' || url.pathname === '/health') return json({ ok: true, name: 'thoi-tiet-bay-adsb', colo: req.cf?.colo || '' }, 200, cors(req));
    return json({ error: 'Không có đường dẫn này' }, 404, cors(req));
  }
};

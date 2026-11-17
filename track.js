'use strict';
/* Theo dõi máy bay – ADS-B: proxy /api/adsb gộp adsb.lol + adsb.fi + airplanes.live + OpenSky; trình duyệt gọi thẳng nguồn còn CORS (hiện thử airplanes.live). Thông tin chặng từ adsbdb.com. */
const TR = { map: null, layer: null, trailLayer: null, sel: null, timer: null, mode: null, list: [], trails: LS.get('trails', {}), src: '', now: 0, err: '', parts: [] };
const PLANE = '<svg viewBox="0 0 24 24"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg>';
function trInit() {
  if (TR.map) return;
  TR.map = L.map('tr-map', { zoomControl: false, worldCopyJump: true });
  L.control.zoom({ position: 'bottomright' }).addTo(TR.map);
  attachBasemap(TR.map, 'ADS-B: adsb.lol / adsb.fi / airplanes.live / OpenSky (ODbL/CC)');
  TR.trailLayer = L.layerGroup().addTo(TR.map); TR.layer = L.layerGroup().addTo(TR.map);
  const a = aptInfo(favs[0] || 'VVTS'); TR.map.setView([a.lat ?? 10.8, a.lon ?? 106.65], 8);
  document.getElementById('tr-apt').value = favs[0] || 'VVTS';
  TR.map.on('click', () => { if (TR.sel) { TR.sel = null; trPanel(); trDraw(); } });
}
window.showTrack = () => { trInit(); whenMapReady(TR.map, trFit); if (!TR.mode) trNear(); else trStart(); };
function guessBy(q) {
  if (/^[0-9A-F]{6}$/.test(q) && /\d/.test(q) && !/^[A-Z]{3}\d/.test(q)) return 'hex';
  if (/^[A-Z0-9]{1,2}-[A-Z0-9]{2,5}$/.test(q) || /^N\d{1,5}[A-Z]{0,2}$/.test(q)) return 'reg';
  if (/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(q) && !/^[A-Z]{3}\d/.test(q)) return 'flight';
  return 'callsign';
}
async function flightToCallsign(q) { // số hiệu IATA (VN220) → callsign ICAO (HVN220) qua adsbdb
  try { const r = await fetchT('https://api.adsbdb.com/v0/callsign/' + q, 8000); const j = await r.json(); return j.response?.flightroute?.callsign_icao || null; } catch { return null; }
}
/* Gọi thẳng từ trình duyệt chỉ nguồn còn hy vọng CORS. Kiểm tra 17/11/2026 (Origin https://lanle102.github.io):
   adsb.lol và adsb.fi không gửi Access-Control-Allow-Origin; OpenSky chỉ cho https://opensky-network.org.
   airplanes.live bị Cloudflare 403 từ máy chủ đám mây nên chưa xem được header CORS – thử từ điện thoại/trình duyệt. */
const DIRECT = ['airplanes.live'];
const directState = {};
function canDirect(name) {
  const s = directState[name];
  if (!s || s.ok) return true;
  return Date.now() >= (s.until || 0);
}
function markDirect(name, ok, err) {
  if (ok) { directState[name] = { ok: true }; return; }
  const n = (directState[name] && !directState[name].ok ? directState[name].fail : 0) + 1;
  directState[name] = { ok: false, fail: n, err, until: n >= 2 ? Date.now() + 15 * 60e3 : 0 };
}
function readsbUrl(base, by, q, lat, lon, rad) {
  if (by === 'point') return `${base}/v2/point/${lat}/${lon}/${rad}`;
  if (by === 'hex') return `${base}/v2/hex/${String(q).toLowerCase()}`;
  if (by === 'reg') return `${base}/v2/reg/${q}`;
  return `${base}/v2/callsign/${q}`;
}
function acList(j) {
  return (j.ac || j.aircraft || []).filter(a => a && a.hex && a.lat != null && a.lon != null).map(a => {
    const b = { ...a, hex: String(a.hex).toLowerCase() };
    if (b.ground && b.alt_baro == null) b.alt_baro = 'ground';
    return b;
  });
}
function mergeAc(lists) {
  const map = new Map();
  for (const list of lists) for (const a of list) {
    const h = a.hex, o = map.get(h);
    if (!o) map.set(h, { ...a });
    else for (const k in a) if (o[k] == null || o[k] === '') o[k] = a[k];
  }
  return [...map.values()];
}
function proxyParts(j) {
  if (Array.isArray(j.parts) && j.parts.length) return j.parts.map(p => ({ name: p.name, n: p.n || 0, err: p.err || '', via: 'máy chủ' }));
  const parts = [];
  for (const u of String(j.source || '').split(' + ').map(s => s.trim()).filter(Boolean)) {
    const m = u.match(/^(.*)\s+(\d+)$/);
    if (m) parts.push({ name: m[1], n: +m[2], via: 'máy chủ' });
    else parts.push({ name: u, n: (j.ac || []).length, via: 'máy chủ' });
  }
  for (const t of j.tried || []) {
    const i = t.indexOf(': ');
    parts.push({ name: i >= 0 ? t.slice(0, i) : t, n: 0, err: i >= 0 ? t.slice(i + 2) : t, via: 'máy chủ' });
  }
  return parts;
}
function combineParts(proxy, directs) {
  const by = new Map();
  for (const p of proxy) by.set(p.name, { ...p });
  for (const d of directs) {
    const cur = by.get(d.name);
    if (!d.err) { by.set(d.name, { ...d, via: 'trình duyệt' }); continue; }
    if (!cur) by.set(d.name, { ...d, via: 'trình duyệt' });
    else if (cur.err) { cur.via = 'trình duyệt + máy chủ'; cur.err = `trình duyệt ${d.err}, máy chủ ${cur.err}`; }
  }
  const order = ['adsb.lol', 'adsb.fi', 'airplanes.live', 'OpenSky Network'];
  return order.map(n => by.get(n)).filter(Boolean).concat([...by.values()].filter(p => !order.includes(p.name)));
}
function formatSrc(parts, total) {
  const bits = parts.map(p => p.err && !p.n ? `${p.name}: lỗi ${p.err}` : `${p.name} ${p.n} (${p.via})`);
  return bits.join(' · ') + (total != null ? ` · gộp ${total}` : '');
}
function renderSrc() {
  const el = document.getElementById('tr-src'); if (!el) return;
  if (!TR.mode) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.textContent = TR.src ? ('Nguồn: ' + TR.src) : (TR.err ? ('Nguồn: ' + TR.err) : '');
}
async function fetchDirect(name, url) {
  try {
    const r = await fetchT(url, 6000);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const ac = acList(j);
    markDirect(name, true);
    return { name, n: ac.length, ac, now: j.now || Date.now(), via: 'trình duyệt' };
  } catch (e) {
    const err = e.name === 'AbortError' ? 'hết thời gian' : (e.message === 'Failed to fetch' ? 'bị CORS hoặc mạng chặn' : e.message);
    markDirect(name, false, err);
    return { name, n: 0, ac: [], err, via: 'trình duyệt' };
  }
}
async function adsb(params) {
  const by = params.by, q = params.q || '', lat = params.lat, lon = params.lon, rad = params.r || 50;
  const jobs = [(async () => {
    try {
      const r = await fetchT(BASE + '/api/adsb?' + new URLSearchParams(params), 22000);
      const j = await r.json();
      return { kind: 'proxy', ac: acList({ ac: j.ac || [] }), now: j.now || Date.now(), parts: proxyParts(j), err: j.error || '' };
    } catch (e) {
      const err = e.name === 'AbortError' ? 'hết thời gian' : e.message;
      return { kind: 'proxy', ac: [], now: 0, parts: [], err: 'máy chủ: ' + err };
    }
  })()];
  for (const name of DIRECT) {
    if (!canDirect(name)) {
      const s = directState[name];
      jobs.push(Promise.resolve({ kind: 'direct', name, n: 0, ac: [], err: (s && s.err) || 'tạm dừng', via: 'trình duyệt' }));
      continue;
    }
    const url = name === 'airplanes.live' ? readsbUrl('https://api.airplanes.live', by, q, lat, lon, rad) : null;
    if (url) jobs.push(fetchDirect(name, url).then(x => ({ kind: 'direct', ...x })));
  }
  const rs = await Promise.all(jobs);
  const proxy = rs.find(x => x.kind === 'proxy') || { ac: [], parts: [], now: 0, err: '' };
  const directs = rs.filter(x => x.kind === 'direct');
  const okDirect = directs.filter(d => !d.err);
  const parts = combineParts(proxy.parts, directs);
  const list = mergeAc([proxy.ac, ...okDirect.map(d => d.ac)]);
  TR.parts = parts;
  TR.src = formatSrc(parts, list.length);
  const rawNow = Math.max(proxy.now || 0, ...directs.map(d => d.now || 0));
  TR.now = rawNow ? (rawNow < 1e12 ? rawNow * 1000 : rawNow) : Date.now();
  TR.err = parts.some(p => !p.err) || list.length ? '' : (proxy.err || 'Không nguồn ADS-B nào trả dữ liệu');
  return list;
}

function addTrail(a) {
  if (a.lat == null || !a.hex) return;
  const t = TR.trails[a.hex] ||= []; const last = t[t.length - 1], now = Date.now();
  if (!last || last[0] !== a.lat || last[1] !== a.lon) t.push([a.lat, a.lon, a.alt_baro === 'ground' ? 0 : a.alt_baro ?? null, now]);
  while (t.length && now - t[0][3] > 3 * 3600e3) t.shift(); if (t.length > 1500) t.splice(0, t.length - 1500);
}
function saveTrails() { const keep = {}; const now = Date.now(); for (const [k, v] of Object.entries(TR.trails)) if (v.length && now - v[v.length - 1][3] < 3 * 3600e3) keep[k] = v; TR.trails = keep; LS.set('trails', keep); }
async function trSearch() {
  let q = document.getElementById('tr-q').value.trim().toUpperCase().replace(/\s+/g, ''); if (q.length < 2) { toast('Nhập callsign, số hiệu, số đăng ký hoặc hex'); return; }
  let by = document.getElementById('tr-by').value; if (by === 'auto') by = guessBy(q);
  let note = '';
  if (by === 'flight') { const cs = await flightToCallsign(q); if (cs) { note = `Số hiệu ${q} → callsign ${cs} (adsbdb.com)`; q = cs; } else note = `Không đổi được số hiệu ${q} sang callsign ICAO – thử tìm thẳng`; by = 'callsign'; }
  TR.mode = { by, q, note }; TR.sel = null; await trTick(true);
  if (TR.list.length === 1) { TR.sel = TR.list[0].hex; trPanel(); trDraw(); }
  trStart();
}
async function trNear() {
  const id = document.getElementById('tr-apt').value.trim().toUpperCase() || 'VVTS';
  await loadAirports().catch(() => {}); const a = aptInfo(id);
  if (a.lat == null) { toast('Không tìm thấy sân bay ' + id); return; }
  const r = +document.getElementById('tr-r').value;
  TR.mode = { by: 'point', lat: a.lat, lon: a.lon, r, apt: id }; TR.sel = null;
  trFit();
  await trTick(true); trStart();
}
function trFit() {
  const m = TR.mode; if (!TR.map || m?.by !== 'point') return;
  TR.map.invalidateSize();
  const s = TR.map.getSize(); if (s.x < 40 || s.y < 40) return;
  TR.map.fitBounds(L.latLng(m.lat, m.lon).toBounds(m.r * 1852 * 2), { padding: [20, 20], maxZoom: 11, animate: false });
}
function trStart() { clearInterval(TR.timer); TR.timer = setInterval(() => { if (tab === 'track' && !document.hidden) trTick(); }, 12000); }
async function trTick(fit) {
  const m = TR.mode; if (!m) return;
  try {
    let list = m.by === 'point' ? await adsb({ by: 'point', lat: m.lat.toFixed(4), lon: m.lon.toFixed(4), r: m.r }) : await adsb({ by: m.by, q: m.q });
    if (TR.sel && m.by === 'point' && !list.some(a => a.hex === TR.sel)) { const s = await adsb({ by: 'hex', q: TR.sel }).catch(() => []); list = list.concat(s); }
    const seen = new Set(); TR.list = list.filter(a => a.lat != null && a.lon != null && !seen.has(a.hex) && seen.add(a.hex)); TR.list.forEach(addTrail); saveTrails();
  } catch (e) { TR.err = e.name === 'AbortError' ? 'hết thời gian chờ' : e.message; }
  trDraw(); trPanel(); renderSrc();
  if (fit && TR.list.length && m.by !== 'point') TR.map.setView([TR.list[0].lat, TR.list[0].lon], 8);
}
const altTxt = a => a.alt_baro === 'ground' ? 'trên mặt đất' : a.alt_baro != null ? Math.round(a.alt_baro).toLocaleString('vi-VN') + ' ft' : '—';
function trDraw() {
  if (!TR.map) return; TR.layer.clearLayers(); TR.trailLayer.clearLayers();
  for (const a of TR.list) {
    const sel = a.hex === TR.sel, gnd = a.alt_baro === 'ground' || a.ground, rot = a.track ?? a.true_heading ?? 0;
    const ic = L.divIcon({ className: 'ac-ic' + (sel ? ' sel' : '') + (gnd ? ' gnd' : ''), html: `<div style="transform:rotate(${rot}deg)">${PLANE}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] });
    const mk = L.marker([a.lat, a.lon], { icon: ic, zIndexOffset: sel ? 1000 : 0 }).addTo(TR.layer);
    mk.bindTooltip(`${esc((a.flight || '').trim() || a.r || a.hex)}<br><small>${altTxt(a)}</small>`, { direction: 'top', offset: [0, -10], className: 'stn-label' });
    mk.on('click', e => { L.DomEvent.stopPropagation(e); TR.sel = a.hex; trPanel(); trDraw(); });
  }
  const showTrail = TR.sel ? [TR.sel] : TR.mode?.by !== 'point' ? TR.list.map(a => a.hex) : [];
  for (const h of showTrail) { const t = TR.trails[h]; if (t?.length > 1) L.polyline(t.map(p => [p[0], p[1]]), { color: '#ff9f0a', weight: 3, opacity: .9 }).addTo(TR.trailLayer); }
  if (TR.mode?.by === 'point') L.circle([TR.mode.lat, TR.mode.lon], { radius: TR.mode.r * 1852, color: '#0a84ff', weight: 1, fill: false, dashArray: '4 6' }).addTo(TR.trailLayer);
}
const routeCache = {}, acCache = {};
async function routeInfo(cs) { cs = (cs || '').trim(); if (!cs) return null; if (cs in routeCache) return routeCache[cs];
  try { const j = await (await fetchT('https://api.adsbdb.com/v0/callsign/' + cs, 8000)).json(); routeCache[cs] = j.response?.flightroute || null; } catch { routeCache[cs] = null; } return routeCache[cs]; }
async function acInfo(hex) { if (hex in acCache) return acCache[hex];
  try { const j = await (await fetchT('https://api.adsbdb.com/v0/aircraft/' + hex, 8000)).json(); acCache[hex] = j.response?.aircraft || null; } catch { acCache[hex] = null; } return acCache[hex]; }
function trPanel() {
  const el = document.getElementById('tr-panel'), m = TR.mode;
  const head = `<div class="tr-meta">${m ? (m.by === 'point' ? `Quanh ${m.apt} ${m.r} NM` : `Tìm ${({ callsign: 'callsign', reg: 'số đăng ký', hex: 'hex' })[m.by]} «${esc(m.q)}»`) : ''} · ${TR.list.length} máy bay${TR.now ? ' · lúc ' + fmtUTC(new Date(TR.now), false) + ' (' + fmtLocalNow(TR.now) + ' giờ máy)' : ''}${m?.note ? '<br>' + esc(m.note) : ''}${TR.err ? `<br><span class="errtxt">Không có dữ liệu: ${esc(TR.err)}</span>` : ''}</div>`;
  const a = TR.list.find(x => x.hex === TR.sel);
  if (!a) {
    const rows = TR.list.slice().sort((x, y) => (y.alt_baro === 'ground' ? -1 : y.alt_baro || 0) - (x.alt_baro === 'ground' ? -1 : x.alt_baro || 0)).slice(0, 60).map(a => `<div class="tr-item" data-hex="${a.hex}"><b>${esc((a.flight || '').trim() || '—')}</b><span>${esc(a.r || '')}</span><span>${esc(a.t || '')}</span><span>${altTxt(a)}</span><span>${a.gs != null ? Math.round(a.gs) + ' kt' : ''}</span></div>`).join('');
    el.innerHTML = head + (rows || (m ? '<div class="muted" style="padding:8px">Không thấy máy bay nào' + (m.by !== 'point' ? ' (có thể máy bay đang không phát ADS-B hoặc ngoài vùng phủ)' : '') + '.</div>' : '')) + '<div class="note">ADS-B từ mạng tình nguyện; không phủ toàn cầu, có thể trễ vài giây. Vết bay vẽ từ các lần cập nhật kể từ khi mở (nguồn trace đầy đủ của adsb.lol chặn truy cập tự động).</div>';
    return;
  }
  const kmh = a.gs != null ? Math.round(a.gs * 1.852) : null, alt = a.alt_baro === 'ground' ? null : a.alt_baro;
  const vr = a.baro_rate ?? a.geom_rate;
  const rows = [['Callsign', esc((a.flight || '').trim() || '—')], ['Số đăng ký', esc(a.r || '—')], ['Loại máy bay', esc(a.t || '—') + (a.desc ? ` <small>${esc(a.desc)}</small>` : '')], ['Hex ICAO', esc(a.hex)],
    ['Độ cao', `${altTxt(a)}${alt != null ? ` <small>(${Math.round(alt * 0.3048).toLocaleString('vi-VN')} m, khí áp)</small>` : ''}${a.alt_geom != null ? `<br><small>GNSS ${a.alt_geom.toLocaleString('vi-VN')} ft</small>` : ''}`],
    ['Tốc độ', a.gs != null ? `${Math.round(a.gs)} kt GS <small>(${kmh} km/h)</small>${a.tas ? `<br><small>TAS ${a.tas} kt · IAS ${a.ias ?? '—'} kt${a.mach ? ' · M' + a.mach.toFixed(2) : ''}</small>` : ''}` : '—'],
    ['Hướng bay', a.track != null ? `${Math.round(a.track)}° (${compass(a.track)})` : '—'], ['Tốc độ lên/xuống', vr != null ? `${vr > 0 ? '+' : ''}${vr} ft/phút` : '—'],
    ['Squawk', esc(a.squawk || '—') + (/^(7500|7600|7700)$/.test(a.squawk || '') ? ' <b class="errtxt">KHẨN CẤP</b>' : '')], ['Vị trí', `${a.lat.toFixed(4)}, ${a.lon.toFixed(4)}${a.seen_pos != null ? ` <small>(${Math.round(a.seen_pos)} giây trước)</small>` : ''}`]];
  if (a.wd != null) rows.push(['Gió tại độ cao (máy bay tính)', `${pad3(a.wd)}° ${a.ws} kt${a.oat != null ? ` · OAT ${a.oat}°C` : ''}`]);
  el.innerHTML = head + `<div class="card"><div class="card-head"><h3>${esc((a.flight || '').trim() || a.r || a.hex)}</h3><span class="sub">nguồn gộp</span><button class="linkbtn" id="tr-close" style="margin-left:auto">Đóng</button></div>
    <div id="tr-route" class="note" style="padding:8px 12px"></div><div class="drows">${rows.map(r => `<div class="drow"><div class="k">${r[0]}</div><div class="v">${r[1]}</div></div>`).join('')}</div>
    <div class="note" style="padding:0 12px 10px">Vết bay: ${(TR.trails[a.hex] || []).length} điểm từ các lần cập nhật. <a href="https://globe.adsb.lol/?icao=${a.hex}" target="_blank" rel="noopener">Xem trace đầy đủ trên adsb.lol ↗</a></div>
    <div style="padding:0 12px 12px"><a class="fr24btn" href="https://www.flightradar24.com/${encodeURIComponent((a.flight || '').trim() || a.r || '')}" target="_blank" rel="noopener">Mở trên Flightradar24 ↗</a></div></div>`;
  document.getElementById('tr-close').onclick = () => { TR.sel = null; trPanel(); trDraw(); };
  Promise.all([routeInfo(a.flight), acInfo(a.hex)]).then(([rt, ac]) => {
    const box = document.getElementById('tr-route'); if (!box || TR.sel !== a.hex) return;
    const b = [];
    if (rt) b.push(`Chặng: <b>${esc(rt.origin?.icao_code || '')}</b> ${esc(rt.origin?.municipality || '')} → <b>${esc(rt.destination?.icao_code || '')}</b> ${esc(rt.destination?.municipality || '')} · ${esc(rt.airline?.name || '')} <small>(theo adsbdb.com – lịch tuyến có thể không đúng chuyến hôm nay)</small>`);
    if (ac) b.push(`Máy bay: ${esc(ac.manufacturer || '')} ${esc(ac.type || '')} · ${esc(ac.registered_owner || '')} <small>(adsbdb.com)</small>`);
    box.innerHTML = b.join('<br>') || 'Không có thông tin chặng/máy bay từ adsbdb.com.';
  });
}
document.getElementById('tr-panel').addEventListener('click', e => { const it = e.target.closest('.tr-item'); if (!it) return; TR.sel = it.dataset.hex; const a = TR.list.find(x => x.hex === TR.sel); if (a) TR.map.panTo([a.lat, a.lon]); trPanel(); trDraw(); });
document.getElementById('tr-go').onclick = trSearch;
document.getElementById('tr-q').addEventListener('keydown', e => { if (e.key === 'Enter') trSearch(); });
document.getElementById('tr-near').onclick = trNear;
document.getElementById('tr-locate').onclick = trNear;

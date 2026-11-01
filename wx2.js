'use strict';
/* Thời Tiết Bay v3: SIGMET/AIRMET/G-AIRMET/PIREP, briefing theo quy tắc cho sân bay và chặng bay. Mọi số liệu lấy từ bản tin thật. */
const HZ = { // màu + tên tiếng Việt theo hiện tượng
  TS: ['#e5373b', 'Dông (TS)'], CONVECTIVE: ['#e5373b', 'Đối lưu/dông'], TURB: ['#ff9f0a', 'Nhiễu động (TURB)'], 'TURB-HI': ['#ff9f0a', 'Nhiễu động tầng cao'], 'TURB-LO': ['#ffb340', 'Nhiễu động tầng thấp'],
  ICE: ['#32ade6', 'Đóng băng (ICE)'], VA: ['#8e8e93', 'Tro núi lửa (VA)'], ASH: ['#8e8e93', 'Tro núi lửa'], TC: ['#d63af9', 'Bão nhiệt đới (TC)'], MTW: ['#bf9b30', 'Sóng núi (MTW)'],
  IFR: ['#8e44ad', 'IFR (trần mây/tầm nhìn thấp)'], MT_OBSC: ['#a0522d', 'Núi bị che khuất'], 'MTN OBSCN': ['#a0522d', 'Núi bị che khuất'], LLWS: ['#c0392b', 'Gió đứt tầng thấp'], SFC_WND: ['#16a085', 'Gió bề mặt mạnh'],
  DS: ['#b8860b', 'Bão bụi'], SS: ['#b8860b', 'Bão cát'], RDOACT: ['#2ecc71', 'Mây phóng xạ']
};
const hzColor = h => (HZ[h] || ['#ff2d55'])[0];
const hzName = h => (HZ[h] || [null, h || 'Không rõ'])[1];
const QUAL = { EMBD: 'ẩn trong mây', OBSC: 'bị che khuất', FRQ: 'dày đặc', SQL: 'đường tố', ISOL: 'cô lập', OCNL: 'thỉnh thoảng', SEV: 'mạnh', MOD: 'vừa', HVY: 'nặng' };
const CHNG = { INTSF: 'mạnh lên', WKN: 'yếu đi', NC: 'không đổi' };
const fl = ft => ft == null || ft === '' ? null : (+ft === 0 ? 'mặt đất' : 'FL' + String(Math.round(+ft / 100)).padStart(3, '0'));
const DIRS = { N: 0, NNE: 22, NE: 45, ENE: 67, E: 90, ESE: 112, SE: 135, SSE: 157, S: 180, SSW: 202, SW: 225, WSW: 247, W: 270, WNW: 292, NW: 315, NNW: 337 };

/* ---------- Hình học ---------- */
const R_NM = 3440.065;
function distNm(a, b) { const t = Math.PI / 180, dLa = (b[0] - a[0]) * t, dLo = (b[1] - a[1]) * t; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * t) * Math.cos(b[0] * t) * Math.sin(dLo / 2) ** 2; return 2 * R_NM * Math.asin(Math.sqrt(h)); }
function gcPoints(a, b, stepNm = 20) {
  const t = Math.PI / 180, d = distNm(a, b) / R_NM, n = Math.max(2, Math.ceil(distNm(a, b) / stepNm)); if (d === 0) return [a];
  const [la1, lo1, la2, lo2] = [a[0] * t, a[1] * t, b[0] * t, b[1] * t], out = [];
  for (let i = 0; i <= n; i++) { const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2), y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2), z = A * Math.sin(la1) + B * Math.sin(la2);
    out.push([Math.atan2(z, Math.hypot(x, y)) / t, Math.atan2(y, x) / t]); }
  return out;
}
function unwrapLons(poly) { const xs = []; let prev = poly[0][1]; for (const p of poly) { let x = p[1]; while (x - prev > 180) x -= 360; while (x - prev < -180) x += 360; xs.push(x); prev = x; } return xs; }
function inPoly(pt, poly) { // poly: [[lat,lon],...]; xử lý vùng vắt qua kinh tuyến 180°
  const xs = unwrapLons(poly), c = xs.reduce((a, b) => a + b, 0) / xs.length; let x0 = pt[1], y = pt[0];
  while (x0 - c > 180) x0 -= 360; while (x0 - c < -180) x0 += 360;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = xs[i], xj = xs[j], yi = poly[i][0], yj = poly[j][0];
    if (((yi > y) !== (yj > y)) && (x0 < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function nearPoly(pt, h, nm) { if (h.line) return h.rings.some(r => r.some(p => distNm(pt, p) <= nm)); return h.rings.some(r => inPoly(pt, r) || (nm > 0 && r.some(p => distNm(pt, p) <= nm))); }

/* ---------- Tải dữ liệu nguy hiểm ---------- */
const hz = { list: [], ts: 0, err: {}, src: {} };
const toRing = cs => (cs || []).map(c => [+c.lat, +c.lon]).filter(p => isFinite(p[0]) && isFinite(p[1]));
async function loadHazards(force) {
  if (!force && Date.now() - hz.ts < 5 * 60e3 && hz.list.length) return hz;
  const now = Date.now() / 1000, out = [];
  const [is, us, ga] = await Promise.allSettled([api('isigmet', { format: 'json' }), api('airsigmet', { format: 'json' }), api('gairmet', { format: 'json' })]);
  hz.err = {};
  if (is.status === 'fulfilled') for (const s of is.value) {
    const rings = Array.isArray(s.coords?.[0]) ? s.coords.map(toRing) : [toRing(s.coords)];
    out.push({ kind: 'SIGMET', intl: true, id: `${s.firId} ${s.seriesId}`, fir: s.firName || s.firId, hazard: s.hazard, qual: s.qualifier, from: s.validTimeFrom, to: s.validTimeTo, base: s.base, top: s.top,
      dir: s.dir, spd: s.spd, chng: s.chng, raw: s.rawSigmet, rings: rings.filter(r => r.length > 2), issued: s.receiptTime, header: (s.rawSigmet || '').split('\n')[0] });
  } else hz.err.isigmet = is.reason?.message || 'lỗi';
  if (us.status === 'fulfilled') for (const s of us.value) {
    const typ = s.airSigmetType === 'AIRMET' ? 'AIRMET' : s.airSigmetType === 'OUTLOOK' ? 'OUTLOOK' : 'SIGMET';
    if (typ === 'OUTLOOK') continue;
    out.push({ kind: typ, intl: false, id: `${s.icaoId} ${s.seriesId}`, fir: 'Hoa Kỳ (AWC)', hazard: s.hazard, qual: s.severity != null ? 'mức ' + s.severity : '', from: s.validTimeFrom, to: s.validTimeTo,
      base: s.altitudeLow1 ?? s.altitudeLow2, top: s.altitudeHi2 ?? s.altitudeHi1, dirDeg: s.movementDir, spd: s.movementSpd, raw: s.rawAirSigmet, rings: [toRing(s.coords)].filter(r => r.length > 2), issued: s.receiptTime, header: (s.rawAirSigmet || '').split('\n')[0] });
  } else hz.err.airsigmet = us.reason?.message || 'lỗi';
  if (ga.status === 'fulfilled') for (const g of ga.value) {
    if (/FZLVL/.test(g.hazard)) continue;
    const vt = Date.parse(g.validTime) / 1000;
    out.push({ kind: 'G-AIRMET', intl: false, id: `${g.product} ${g.tag}`, fir: 'Hoa Kỳ (AWC)', hazard: g.hazard, qual: g.severity || '', from: g.issueTime, to: g.expireTime, snap: vt, fh: g.forecastHour,
      base: g.base && /^\d+$/.test(g.base) ? +g.base * 100 : (g.base === 'SFC' ? 0 : null), top: g.top && /^\d+$/.test(g.top) ? +g.top * 100 : null, raw: `G-AIRMET ${g.product} ${g.tag} – ${g.hazard}${g.severity ? ' ' + g.severity : ''}${g.due_to ? ' do ' + g.due_to : ''}, ảnh dự báo ${g.validTime.slice(11, 16)}Z (+${g.forecastHour} giờ)`,
      rings: [toRing(g.coords)].filter(r => r.length > 1), line: g.geom === 'LINE', issued: new Date(g.issueTime * 1000).toISOString() });
  } else hz.err.gairmet = ga.reason?.message || 'lỗi';
  hz.list = out.filter(h => h.rings.length && (!h.to || h.to > now)); hz.ts = Date.now();
  return hz;
}
async function loadPireps(lat, lon, nm = 150, age = 3) {
  const d = nm / 60, dl = d / Math.max(0.2, Math.cos(lat * Math.PI / 180));
  try { return { ok: true, list: await api('pirep', { bbox: [lat - d, lon - dl, lat + d, lon + dl].map(x => x.toFixed(2)).join(','), format: 'json', age }) }; }
  catch (e) { return { ok: false, err: e.message, list: [] }; }
}
async function loadPirepsBbox(s, w, n, e, age = 3) { try { return await api('pirep', { bbox: [s, w, n, e].map(x => x.toFixed(2)).join(','), format: 'json', age }); } catch { return []; } }

/* ---------- Giải mã SIGMET ---------- */
function hzTime(h) { return `${fmtUTC(new Date(h.from * 1000), true)} → ${fmtUTC(new Date(h.to * 1000), true)}`; }
function hzDecoded(h) {
  const parts = [];
  parts.push(`<b>${esc(h.kind)} ${esc(h.id)}</b> · ${esc(h.fir || '')}`);
  let what = hzName(h.hazard); const q = String(h.qual || '').split(/\s+/).map(w => QUAL[w]).filter(Boolean).join(', ');
  if (h.hazard === 'VA' || h.hazard === 'TC') what += h.qual ? ` – ${esc(h.qual)}` : ''; else if (q) what += ` (${q})`;
  parts.push('Hiện tượng: ' + what);
  if (h.base != null || h.top != null) parts.push(`Độ cao: ${h.base != null ? fl(h.base) : '?'} → ${h.top != null ? fl(h.top) : '?'}`);
  if (h.snap) parts.push(`Ảnh dự báo lúc ${fmtUTC(new Date(h.snap * 1000), true)} (phát hành ${fmtUTC(new Date(h.from * 1000), true)})`);
  else parts.push(`Hiệu lực: ${hzTime(h)}${h.from * 1000 > Date.now() ? ' <small>(chưa bắt đầu)</small>' : ''}`);
  if (h.dir || h.dirDeg != null) parts.push(`Di chuyển: ${h.dir ? (h.dir === 'STNR' ? 'đứng yên' : 'về hướng ' + h.dir) : 'từ ' + pad3(h.dirDeg) + '°'}${+h.spd ? ' ' + (+h.spd) + ' kt' : ''}`);
  if (h.chng) parts.push('Cường độ: ' + (CHNG[h.chng] || h.chng));
  return parts.join('<br>');
}
function hzPopup(h) { return `<div class="hzpop"><div class="hzbar" style="background:${hzColor(h.hazard)}"></div>${hzDecoded(h)}<details><summary>Bản tin gốc</summary><pre>${esc(h.raw || '')}</pre></details><small>Nguồn: aviationweather.gov (${h.intl ? 'International SIGMET' : h.kind})</small></div>`; }

/* ---------- Lớp bản đồ ---------- */
let hzLayer = null, pirepLayer = null; const mapHz = { sig: false, air: false, pirep: false };
function drawHazards() {
  if (typeof map === 'undefined' || !map) return;
  if (!hzLayer) hzLayer = L.layerGroup().addTo(map);
  hzLayer.clearLayers();
  for (const h of hz.list) {
    const isAir = h.kind === 'AIRMET' || h.kind === 'G-AIRMET';
    if (isAir ? !mapHz.air : !mapHz.sig) continue;
    for (const r of h.rings) {
      const c = hzColor(h.hazard);
      const shape = h.line ? L.polyline(r, { color: c, weight: 3, dashArray: '6 4' }) : L.polygon(r, { color: c, weight: isAir ? 1.5 : 2, fillColor: c, fillOpacity: isAir ? 0.08 : 0.18, dashArray: isAir ? '5 4' : null });
      shape.bindPopup(hzPopup(h), { maxWidth: 320 }); hzLayer.addLayer(shape);
    }
  }
}
async function drawPireps() {
  if (typeof map === 'undefined' || !map) return;
  if (!pirepLayer) pirepLayer = L.layerGroup().addTo(map);
  pirepLayer.clearLayers(); if (!mapHz.pirep) return;
  const b = map.getBounds(); const list = await loadPirepsBbox(Math.max(-90, b.getSouth()), Math.max(-180, b.getWest()), Math.min(90, b.getNorth()), Math.min(180, b.getEast()));
  const z = map.getZoom();
  for (const p of list) {
    if (p.lat == null || (z < 6 && !p.tbInt1 && !p.icgInt1)) continue;
    const sev = /SEV|EXTRM/.test((p.tbInt1 || '') + (p.icgInt1 || '')) ? '#e5373b' : /MOD/.test((p.tbInt1 || '') + (p.icgInt1 || '')) ? '#ff9f0a' : '#30b0c7';
    const mk = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: 'pirep-ic', html: `<span style="background:${sev}">${p.icgInt1 ? '❄' : p.tbInt1 ? '〰' : 'P'}</span>`, iconSize: [20, 20] }) });
    mk.bindPopup(`<b>PIREP</b> ${esc(p.acType || '')} · ${p.fltLvl != null ? 'FL' + pad3(p.fltLvl) : ''}<br>${fmtUTC(new Date(p.obsTime * 1000), true)} (${ago(p.obsTime)})${pirepText(p) ? '<br>' + pirepText(p) : ''}<pre>${esc(p.rawOb || '')}</pre><small>Nguồn: aviationweather.gov</small>`, { maxWidth: 300 });
    pirepLayer.addLayer(mk);
  }
}
const INT_VN = { LGT: 'nhẹ', 'LGT-MOD': 'nhẹ–vừa', MOD: 'vừa', 'MOD-SEV': 'vừa–mạnh', SEV: 'mạnh', EXTRM: 'cực mạnh', NEG: 'không', SMTH: 'êm', TRC: 'vết' };
function pirepText(p) { const b = []; if (p.tbInt1) b.push(`Nhiễu động ${INT_VN[p.tbInt1] || p.tbInt1}${p.tbBas1 ? ` FL${pad3(p.tbBas1)}–${pad3(p.tbTop1 || p.tbBas1)}` : ''}`); if (p.icgInt1) b.push(`Đóng băng ${INT_VN[p.icgInt1] || p.icgInt1}${p.icgType1 ? ' (' + p.icgType1 + ')' : ''}`); if (p.wxString) b.push(esc(p.wxString)); return b.join(' · '); }
window.initWxMapCtl = () => {
  const box = document.querySelector('.map-ctl');
  box.insertAdjacentHTML('beforeend', `<button id="mc-sig" class="mc">SIGMET</button><button id="mc-air" class="mc">AIRMET</button><button id="mc-pirep" class="mc">PIREP</button>`);
  const tog = async (k, btn) => { mapHz[k] = !mapHz[k]; btn.classList.toggle('on', mapHz[k]);
    if (k === 'pirep') { drawPireps(); return; }
    try { await loadHazards(); drawHazards(); const n = hz.list.filter(h => k === 'air' ? /AIRMET/.test(h.kind) : h.kind === 'SIGMET').length;
      if (mapHz[k]) toast(`${n} ${k === 'air' ? 'AIRMET/G-AIRMET (chỉ Hoa Kỳ)' : 'SIGMET đang hiệu lực'} – bấm vùng màu để xem`); if (hz.err.isigmet && k === 'sig') toast('Lỗi tải SIGMET quốc tế: ' + hz.err.isigmet); }
    catch (e) { toast('Không tải được: ' + e.message); } };
  document.getElementById('mc-sig').onclick = e => tog('sig', e.currentTarget);
  document.getElementById('mc-air').onclick = e => tog('air', e.currentTarget);
  document.getElementById('mc-pirep').onclick = e => tog('pirep', e.currentTarget);
  map.on('moveend', () => { if (mapHz.pirep) { clearTimeout(window._pt); window._pt = setTimeout(drawPireps, 600); } });
};

/* ---------- Briefing theo quy tắc ---------- */
const SEV_ORDER = { info: 0, warn: 1, danger: 2 };
const catRank = c => ({ VFR: 0, VMC: 0, BLU: 0, WHT: 0, MVFR: 1, GRN: 1, IFR: 2, IMC: 2, YLO: 2, AMB: 3, LIFR: 3, RED: 3 })[c] ?? -1;
function metarTag(m) { return `METAR ${m.icaoId} ${(m.rawOb.match(/\b\d{6}Z\b/) || [''])[0]}`; }
function tafTag(t) { return `TAF ${t.icaoId} ${(t.rawTAF.match(/\b\d{6}Z\b/) || [''])[0]}`; }
function sigTag(h) { return `${h.kind} ${h.id}${h.header ? ' – ' + h.header.trim() : ''}`; }
function briefAirport(id, opt = {}) {
  const m = cache.metar[id], t = cache.taf[id], a = aptInfo(id), items = []; // {sev, text, src}
  const add = (sev, text, src) => items.push({ sev, text, src });
  if (!m) add('warn', 'Không có METAR gần đây cho sân bay này.', 'aviationweather.gov');
  else {
    const p = parseReport(m.rawOb), cat = metarCat(m), ageMin = (Date.now() / 1000 - m.obsTime) / 60, tag = metarTag(m);
    const vis = p.vis ? U.visM(p.vis.m, p.vis.plus) : U.visSM(m.visib), ceil = ceilingOf(p.clouds);
    add(catRank(cat) >= 2 ? 'danger' : catRank(cat) === 1 ? 'warn' : 'info', `Hiện tại ${cat}: gió ${p.wind ? windText(p.wind, true) : '—'}, tầm nhìn ${vis}, ${p.cavok ? 'CAVOK' : ceil != null ? 'trần mây ' + ceil.toLocaleString('vi-VN') + ' ft' : 'không có trần mây'}, ${U.temp(p.temp)}/${U.temp(p.dew)}, QNH ${p.qnh != null ? Math.round(p.qnh) + ' hPa' : '—'}.`, tag);
    if (ageMin > 75) add('warn', `METAR đã cũ (${ago(m.obsTime)}).`, tag);
    if (p.wind?.gust >= 25 || p.wind?.spd >= 20) add('warn', `Gió mạnh ${U.wind(p.wind.spd)}${p.wind.gust ? ', giật ' + U.wind(p.wind.gust) : ''}.`, tag);
    if (p.temp != null && p.dew != null && p.temp - p.dew <= 2 && !/FG/.test(m.rawOb)) add('warn', `Chênh lệch nhiệt độ – điểm sương chỉ ${p.temp - p.dew}°C: có thể hình thành sương mù/mây thấp.`, tag);
    const wxs = m.rawOb.split(/\sRMK\s/)[0].split(/\s+/).slice(2).filter(w => !/^\d{6}Z$/.test(w));
    if (wxs.some(w => /^(\+|-|VC)?TS/.test(w)) || p.clouds.some(c => c.type === 'CB')) add('danger', `Có dông/mây CB${p.clouds.find(c => c.type === 'CB') ? ' (CB ở ' + p.clouds.find(c => c.type === 'CB').base + ' ft)' : ''}.`, tag);
    else if (p.clouds.some(c => c.type === 'TCU')) add('warn', 'Có mây tích tháp TCU.', tag);
    if (wxs.some(w => /FZ(RA|DZ|FG)/.test(w))) add('danger', 'Có hiện tượng đóng băng (FZ).', tag);
    if (wxs.some(w => /^\+[A-Z]{2,}$/.test(w))) add('warn', 'Giáng thủy mạnh: ' + p.wx.join(', ') + '.', tag);
    if (wxs.some(w => /^(\+|-|VC)?(MI|BC|PR|DR|BL|SH|TS|FZ)?(RA|DZ|SN)?(FG|SQ|FC|SS|DS|VA|GR)$/.test(w))) add('danger', 'Hiện tượng nguy hiểm: ' + p.wx.join(', ') + '.', tag);
    if (p.ws) add('danger', 'Báo cáo gió đứt: ' + esc(p.ws) + '.', tag);
    const d = apData?.[id];
    if (d && p.wind && !p.wind.vrb && p.wind.spd > 0) {
      let best = null;
      for (const r of d.r || []) for (const [rid, hd] of [[r[4], r[5]], [r[6], r[7]]]) { const H = rwHeading(rid, hd); if (!H) continue; const c = comp(p.wind.dir, p.wind.gust || p.wind.spd, H.h); if (!best || c.head > best.c.head) best = { rid, c }; }
      if (best) { const xw = Math.round(Math.abs(best.c.cross)); add(xw >= 20 ? 'danger' : xw >= 12 ? 'warn' : 'info', `Đường băng thuận gió nhất RWY ${best.rid}: gió ngang ${xw} kt${p.wind.gust ? ' (tính theo gió giật)' : ''}, ${best.c.head >= 0 ? 'gió ngược ' + Math.round(best.c.head) : 'gió xuôi ' + Math.round(-best.c.head)} kt.`, tag + ' + đường băng ' + d.src); }
    }
  }
  if (!t) add('info', 'Không có TAF hiện hành.', 'aviationweather.gov');
  else {
    const tag = tafTag(t), horizon = (opt.until || (Date.now() / 1000 + 12 * 3600));
    const ts = [], gusts = [];
    for (const [i, f] of (t.fcsts || []).entries()) {
      if (f.timeTo < Date.now() / 1000 || f.timeFrom > horizon) continue;
      const kind = f.fcstChange || (i === 0 ? 'BASE' : 'FM');
      const when = `${fmtUTC(new Date(Math.max(f.timeFrom, t.validTimeFrom) * 1000), true)}–${fmtUTC(new Date(f.timeTo * 1000))}`;
      if (/TS/.test(f.wxString || '') || (f.clouds || []).some(c => c.type === 'CB')) ts.push(`${when} (${kind}${f.probability ? ' ' + f.probability + '%' : ''})`);
      if (f.wgst >= 25) gusts.push(`${f.wgst} kt (${when})`);
    }
    let worst = null;
    for (const h of tafHourly(t, Math.max(1, Math.min(30, Math.ceil((horizon - Date.now() / 1000) / 3600))))) {
      if (!h) continue;
      for (const [c, kind] of [[h.cat, 'điều kiện chính'], [h.tempo, 'TEMPO/PROB']]) if (c && (!worst || catRank(c) > catRank(worst.cat))) worst = { cat: c, kind, when: fmtUTC(new Date((h.ts - 1800) * 1000), true) };
    }
    if (worst) add(catRank(worst.cat) >= 2 ? 'danger' : catRank(worst.cat) === 1 ? 'warn' : 'info', `TAF ${opt.until ? 'đến giờ dự kiến + 1 giờ' : '12 giờ tới'}: xấu nhất ${worst.cat} (${worst.kind}, từ khoảng ${worst.when}).`, tag);
    if (ts.length) add('danger', 'TAF dự báo dông/CB: ' + ts.join('; ') + '.', tag);
    if (gusts.length) add('warn', 'TAF dự báo gió giật: ' + gusts.join('; ') + '.', tag);
  }
  if (a.lat != null && hz.ts) {
    for (const h of hz.list) if (nearPoly([a.lat, a.lon], h, opt.radius ?? 25)) add(h.kind === 'SIGMET' && !(h.base >= 20000) ? 'danger' : 'warn', `${h.kind} ${hzName(h.hazard)}${h.base != null || h.top != null ? ' ' + (fl(h.base) || '?') + '–' + (fl(h.top) || '?') : ''}, hiệu lực ${hzTime(h)} – ${inPolyAny([a.lat, a.lon], h) ? 'sân bay nằm trong vùng' : 'trong vòng ' + (opt.radius ?? 25) + ' NM'}.`, sigTag(h));
  }
  items.sort((x, y) => SEV_ORDER[y.sev] - SEV_ORDER[x.sev]);
  return items;
}
const inPolyAny = (pt, h) => !h.line && h.rings.some(r => inPoly(pt, r));
function briefHtml(items) {
  return `<ul class="brief">${items.map(it => `<li class="b-${it.sev}"><span class="bdot"></span><div>${it.text}<div class="bsrc">Nguồn: ${esc(it.src)}</div></div></li>`).join('')}</ul>`;
}
/* ---------- Thẻ briefing trong trang chi tiết ---------- */
window.renderBrief = (id) => {
  const el = document.getElementById('x-brief'); if (!el) return;
  const paint = () => {
    if (current !== id || !document.getElementById('x-brief')) return;
    const items = briefAirport(id);
    document.getElementById('x-brief').innerHTML = `<div class="card"><div class="card-head"><h3>Tóm tắt & cảnh báo</h3>${hz.ts ? '' : '<span class="sub">đang tải SIGMET…</span>'}</div>${briefHtml(items)}</div>`;
  };
  paint();
  if (!hz.ts) loadHazards().then(paint).catch(paint);
};

/* ---------- Chặng bay ---------- */
let routeMap = null, routeLayer = null;
function openRoute() {
  document.getElementById('view-route').classList.add('active'); document.body.classList.add('detail-open');
  const last = LS.get('route', { dep: favs[0] || 'VVTS', arr: favs[1] || 'VVNB', alt: '' });
  ['dep', 'arr', 'alt'].forEach(k => document.getElementById('rt-' + k).value = last[k] || '');
}
function closeRoute() { document.getElementById('view-route').classList.remove('active'); document.body.classList.remove('detail-open'); }
async function buildRoute() {
  const v = k => document.getElementById('rt-' + k).value.trim().toUpperCase();
  const dep = v('dep'), arr = v('arr'), alt = v('alt'), fltMin = Calc.parseHM(document.getElementById('rt-time').value || '');
  const out = document.getElementById('rt-out');
  if (!/^[A-Z0-9]{4}$/.test(dep) || !/^[A-Z0-9]{4}$/.test(arr)) { out.innerHTML = '<div class="err">Nhập mã ICAO 4 ký tự cho sân bay đi và đến.</div>'; return; }
  LS.set('route', { dep, arr, alt });
  out.innerHTML = '<div class="muted" style="padding:12px">Đang tải METAR, TAF, SIGMET, PIREP…</div>';
  const ids = [dep, arr, alt].filter(x => /^[A-Z0-9]{4}$/.test(x));
  await loadAirports().catch(() => {});
  const [wx] = await Promise.allSettled([fetchWx(ids, 6), loadHazards()]);
  await Promise.all(ids.map(i => loadAp(i).catch(() => null)));
  const A = aptInfo(dep), B = aptInfo(arr);
  if (A.lat == null || B.lat == null) { out.innerHTML = '<div class="err">Không tìm thấy toạ độ sân bay.</div>'; return; }
  const dist = distNm([A.lat, A.lon], [B.lat, B.lon]), pts = gcPoints([A.lat, A.lon], [B.lat, B.lon], 15);
  const enroute = hz.list.filter(h => pts.some(p => nearPoly(p, h, 10)));
  const prLists = await Promise.all([0, 0.5, 1].map(f => { const p = pts[Math.round(f * (pts.length - 1))]; return loadPireps(p[0], p[1], Math.min(200, dist / 2 + 50), 3); }));
  const seen = new Set(), pireps = prLists.flatMap(x => x.list).filter(p => { const k = p.rawOb; if (seen.has(k)) return false; seen.add(k); return p.lat != null && pts.some(q => distNm(q, [p.lat, p.lon]) <= 50); });
  const until = isFinite(fltMin) ? Date.now() / 1000 + fltMin * 60 + 3600 : undefined;
  const bDep = briefAirport(dep, { until: Date.now() / 1000 + 3 * 3600 }), bArr = briefAirport(arr, { until }), bAlt = alt ? briefAirport(alt, { until }) : null;
  const hzItems = enroute.map(h => ({ sev: h.kind === 'SIGMET' ? 'danger' : 'warn', text: hzDecoded(h), src: sigTag(h) }));
  const prItems = pireps.filter(p => p.tbInt1 || p.icgInt1 || p.wxString).slice(0, 12).map(p => ({ sev: /SEV|EXTRM/.test((p.tbInt1 || '') + (p.icgInt1 || '')) ? 'danger' : /MOD/.test((p.tbInt1 || '') + (p.icgInt1 || '')) ? 'warn' : 'info', text: `${esc(p.acType || '')} ${p.fltLvl != null ? 'FL' + pad3(p.fltLvl) : ''}: ${pirepText(p) || esc(p.rawOb)}`, src: `PIREP ${fmtUTC(new Date(p.obsTime * 1000), true)}` }));
  const card = (title, sub, html) => `<div class="card"><div class="card-head"><h3>${title}</h3><span class="sub">${sub}</span></div>${html}</div>`;
  const aptBadge = i => { const c = metarCat(cache.metar[i]); return `<span class="badge c-${c}">${c === 'UNK' ? '?' : c}</span>`; };
  out.innerHTML = `<div class="card"><div class="card-head"><h3>${dep} → ${arr}${alt ? ' (dự bị ' + alt + ')' : ''}</h3><span class="sub">${Math.round(dist).toLocaleString('vi-VN')} NM theo đường vòng lớn${isFinite(fltMin) ? ' · bay ' + Calc.fmtHM(fltMin) : ''}</span></div><div id="rt-map"></div>
      <div class="note" style="padding:8px 12px">SIGMET/AIRMET/PIREP trong hành lang ±10 NM (PIREP ±50 NM) quanh đường bay. Dữ liệu: aviationweather.gov, lấy lúc ${fmtUTC(new Date(), true)}.${wx.status === 'rejected' ? ' <b>Lỗi tải METAR/TAF: ' + esc(wx.reason?.message) + '</b>' : ''}</div></div>` +
    card(`Đi ${dep} ${aptBadge(dep)}`, esc(A.name || ''), briefHtml(bDep)) +
    card('Dọc đường bay', `${enroute.length} vùng SIGMET/AIRMET · ${pireps.length} PIREP`, (hzItems.length || prItems.length) ? briefHtml([...hzItems, ...prItems]) : `<ul class="brief"><li class="b-info"><span class="bdot"></span><div>Không có SIGMET/AIRMET/G-AIRMET đang hiệu lực cắt đường bay và không có PIREP đáng chú ý.${Object.keys(hz.err).length ? ' <b>Lưu ý: lỗi tải ' + Object.keys(hz.err).join(', ') + '.</b>' : ''}<div class="bsrc">Nguồn: aviationweather.gov (International SIGMET, SIGMET/AIRMET Hoa Kỳ, G-AIRMET, PIREP)</div></div></li></ul>`) +
    card(`Đến ${arr} ${aptBadge(arr)}`, esc(B.name || ''), briefHtml(bArr)) +
    (alt ? card(`Dự bị ${alt} ${aptBadge(alt)}`, esc(aptInfo(alt).name || ''), briefHtml(bAlt)) : '');
  // bản đồ nhỏ
  if (routeMap) { routeMap.remove(); routeMap = null; }
  routeMap = L.map('rt-map', { zoomControl: false, attributionControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 12, className: 'basemap', attribution: '© OpenStreetMap' }).addTo(routeMap);
  const line = L.polyline(pts, { color: '#0a84ff', weight: 3 }).addTo(routeMap);
  for (const h of enroute) for (const r of h.rings) (h.line ? L.polyline(r, { color: hzColor(h.hazard), weight: 3 }) : L.polygon(r, { color: hzColor(h.hazard), weight: 2, fillOpacity: .2 })).bindPopup(hzPopup(h)).addTo(routeMap);
  for (const p of pireps) L.circleMarker([p.lat, p.lon], { radius: 4, color: '#30b0c7' }).bindPopup(`<pre>${esc(p.rawOb)}</pre>`).addTo(routeMap);
  for (const i of ids) { const q = aptInfo(i); if (q.lat != null) L.circleMarker([q.lat, q.lon], { radius: 7, color: '#fff', weight: 2, fillColor: getComputedStyle(document.documentElement).getPropertyValue('--' + metarCat(cache.metar[i]).toLowerCase()).trim() || '#888', fillOpacity: 1 }).bindTooltip(i, { permanent: true, direction: 'right', className: 'stn-label' }).addTo(routeMap); }
  routeMap.fitBounds(line.getBounds().pad(0.2));
}
window.openRoute = openRoute;
document.getElementById('btn-route').onclick = openRoute;
document.getElementById('btn-route-back').onclick = closeRoute;
document.getElementById('rt-go').onclick = buildRoute;
document.getElementById('rt-swap').onclick = () => { const a = document.getElementById('rt-dep'), b = document.getElementById('rt-arr'); [a.value, b.value] = [b.value, a.value]; };

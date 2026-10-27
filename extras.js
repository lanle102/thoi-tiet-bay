'use strict';
/* Thời Tiết Bay v2: đường băng & gió ngang, thông tin sân bay, NOTAM, đồng bộ, thông báo, tab. */
const BASE = /vercel\.app$/.test(location.hostname) ? '' : PROXY_HOST;
const VAPID_PUB = 'BB9dUYQ-98VX5JlURJ3AgzDJya9GgdGFDFAdkiWQC9AIfeDAZMeyKQogStmLgWPvvFXyLynsKHovBSOOHZY_vo0';
window.extraApt = LS.get('extraApt', {});

/* ---------- Tab ---------- */
let tab = 'list';
document.getElementById('tabbar').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]'); if (!b) return;
  tab = b.dataset.tab;
  document.querySelectorAll('#tabbar button').forEach(x => x.classList.toggle('on', x === b));
  document.getElementById('view-list').hidden = tab !== 'list';
  document.getElementById('view-map').hidden = tab !== 'map';
  if (tab === 'map') window.showMap?.();
});

/* ---------- Dữ liệu sân bay: đường băng + tần số ---------- */
const shardCache = {}, apData = {};
async function loadAp(icao) {
  if (icao in apData) return apData[icao];
  const L = icao[0];
  try { shardCache[L] ||= await fetch('data/ap/' + L + '.json').then(r => r.ok ? r.json() : {}); } catch { shardCache[L] = {}; }
  let d = shardCache[L][icao] ? { ...shardCache[L][icao], src: 'OurAirports' } : null;
  try { // AWC: bổ sung thông tin (và dự phòng đường băng)
    const [a] = await api('airport', { ids: icao, format: 'json' });
    if (a) {
      extraApt[icao] = { name: a.name, iata: a.iataId || '', lat: a.lat, lon: a.lon, elev: a.elev != null ? Math.round(a.elev * 3.28084) : null, country: a.country, magdec: a.magdec };
      LS.set('extraApt', extraApt);
      if (!d && a.runways?.length) d = { r: a.runways.map(w => { const [le, he] = String(w.id).split('/'); const [L1, W1] = String(w.dimension || '').split('x').map(Number); const h = Number(w.alignment); return [L1 || 0, W1 || 0, w.surface, 0, le, isNaN(h) ? null : h, he, isNaN(h) ? null : (h + 180) % 360]; }), src: 'aviationweather.gov' };
      if (d && !d.f?.length && a.freqs) d.f = String(a.freqs).split(';').map(x => { const [t, f] = x.split(','); return [t, t, f]; });
      if (d) d.magdec = a.magdec;
    }
  } catch {}
  apData[icao] = d;
  return d;
}
const SURF = { ASP: 'nhựa', ASPH: 'nhựa', CON: 'bê tông', CONC: 'bê tông', H: 'cứng', GRS: 'cỏ', GRE: 'sỏi', GVL: 'sỏi', TURF: 'cỏ', DIRT: 'đất', WATER: 'mặt nước', PEM: 'nhựa', BIT: 'nhựa' };
const surfVi = s => SURF[String(s || '').toUpperCase().split(/[-\s]/)[0]] || (s || '');
function rwHeading(ident, hdg) { if (hdg != null && !isNaN(hdg)) return { h: +hdg, approx: false }; const n = parseInt(ident, 10); return isNaN(n) ? null : { h: n * 10, approx: true }; }
function comp(wdir, spd, hdg) { const d = ((wdir - hdg + 540) % 360) - 180, r = d * Math.PI / 180; return { head: spd * Math.cos(r), cross: spd * Math.sin(r) }; }
function windCompHtml(c, gust) {
  const hw = Math.round(c.head), xw = Math.round(Math.abs(c.cross));
  let s = hw >= 0 ? `<span class="head">gió ngược ${U.wind(hw)}</span>` : `<span class="tail">gió xuôi ${U.wind(-hw)}</span>`;
  s += ` · gió ngang ${U.wind(xw)}${xw ? (c.cross > 0 ? ' từ phải' : ' từ trái') : ''}`;
  if (gust) s += `<br><small>Khi giật: ${gust.head >= 0 ? 'ngược ' + U.wind(Math.round(gust.head)) : 'xuôi ' + U.wind(Math.round(-gust.head))}, ngang ${U.wind(Math.round(Math.abs(gust.cross)))}</small>`;
  return s;
}
function runwayCard(d, p) {
  const w = p?.wind; const calm = !w || w.spd === 0; const vrb = w?.vrb;
  const rows = (d.r || []).filter(r => r[4] || r[6]);
  if (!rows.length) return '';
  const ends = [];
  rows.forEach((r, i) => {
    for (const [id, hd] of [[r[4], r[5]], [r[6], r[7]]]) { if (!id) continue; const H = rwHeading(id, hd); if (!H) continue; ends.push({ id, ri: i, ...H, len: r[0], wid: r[1], surf: r[2], lit: r[3] }); }
  });
  let best = null;
  if (!calm && !vrb) for (const e of ends) { e.c = comp(w.dir, w.spd, e.h); if (w.gust) e.g = comp(w.dir, w.gust, e.h); if (!best || e.c.head > best.c.head) best = e; }
  // SVG la bàn
  const R = 92, svg = [];
  svg.push(`<circle cx="100" cy="100" r="${R}" fill="none" stroke="var(--line)" stroke-width="2"/>`);
  for (let a = 0; a < 360; a += 30) { const big = a % 90 === 0; svg.push(`<line x1="100" y1="${100 - R}" x2="100" y2="${100 - R + (big ? 10 : 5)}" stroke="var(--muted)" stroke-width="${big ? 2 : 1}" transform="rotate(${a} 100 100)"/>`); }
  [['B', 0], ['Đ', 90], ['N', 180], ['T', 270]].forEach(([t, a]) => { const x = 100 + (R - 20) * Math.sin(a * Math.PI / 180), y = 100 - (R - 20) * Math.cos(a * Math.PI / 180) + 4; svg.push(`<text x="${x}" y="${y}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--muted)">${t}</text>`); });
  const nR = rows.length;
  rows.forEach((r, i) => {
    const H = rwHeading(r[4], r[5]) || rwHeading(r[6] ? String((parseInt(r[6]) + 18) % 36 || 36) : '', null); if (!H) return;
    const off = (i - (nR - 1) / 2) * 14; const isBest = best && best.ri === i;
    svg.push(`<g transform="rotate(${H.h} 100 100)"><rect x="${100 + off - 5}" y="38" width="10" height="124" rx="2" fill="${isBest ? 'var(--vfr)' : 'var(--muted)'}" opacity="${isBest ? 1 : .55}"/>
      <text x="${100 + off}" y="174" text-anchor="middle" font-size="9" font-weight="700" fill="var(--text)" transform="rotate(${-H.h} ${100 + off} 171)">${esc(r[4] || '')}</text>
      <text x="${100 + off}" y="33" text-anchor="middle" font-size="9" font-weight="700" fill="var(--text)" transform="rotate(${-H.h} ${100 + off} 30)">${esc(r[6] || '')}</text></g>`);
  });
  if (!calm && !vrb) svg.push(`<g transform="rotate(${w.dir} 100 100)"><line x1="100" y1="2" x2="100" y2="58" stroke="var(--accent)" stroke-width="4"/><path d="M100 70 91 52h18z" fill="var(--accent)"/></g>`);
  svg.push(`<text x="100" y="104" text-anchor="middle" font-size="11" font-weight="700" fill="var(--accent)">${calm ? 'LẶNG' : vrb ? 'VRB' : pad3(w.dir) + '°'}</text>`);
  svg.push(`<text x="100" y="117" text-anchor="middle" font-size="10" fill="var(--accent)">${calm ? '' : U.wind(w.spd) + (w.gust ? ' G' + U.wind(w.gust).split(' ')[0] : '')}</text>`);
  const list = ends.map(e => `<div class="rwy-end"><b>RWY ${esc(e.id)}</b> <small>${Math.round(e.h)}°${e.approx ? ' (ước tính)' : ''}</small>${best && e === best ? '<span class="best">THUẬN GIÓ</span>' : ''}<br>
    ${calm ? 'Lặng gió' : vrb ? `Gió thay đổi – gió ngang tối đa ${U.wind(w.gust || w.spd)}` : windCompHtml(e.c, e.g)}</div>`).join('');
  const dims = rows.map(r => `${esc(r[4])}/${esc(r[6])}: ${r[0] ? r[0].toLocaleString('vi-VN') + ' ft (' + Math.round(r[0] * 0.3048).toLocaleString('vi-VN') + ' m)' : '?'}${r[1] ? ' × ' + r[1] + ' ft' : ''}${r[2] ? ', ' + esc(surfVi(r[2])) : ''}${r[3] ? ', có đèn' : ''}`).join('<br>');
  return `<div class="card" id="card-rwy"><div class="card-head"><h3>Đường băng & gió ngang</h3><span class="sub">theo METAR hiện tại</span></div>
    <div class="rwy-wrap"><svg class="rwy-svg" viewBox="0 0 200 200">${svg.join('')}</svg><div class="rwy-list">${list}</div></div>
    <div class="note" style="padding:0 12px 10px">${dims}<br>Hướng đường băng theo hướng thật (true); gió METAR cũng theo hướng thật. Nguồn: ${esc(d.src)}.</div></div>`;
}
function dms(v, pos, neg) { const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s = Math.round(((a - d) * 60 - m) * 60); return `${d}°${pad(m)}′${pad(s)}″${v >= 0 ? pos : neg}`; }
function infoCard(icao, d) {
  const a = aptInfo(icao);
  const rows = [['ICAO / IATA', `${icao}${a.iata ? ' / ' + esc(a.iata) : ''}`]];
  if (a.elev != null) rows.push(['Cao độ', `${a.elev.toLocaleString('vi-VN')} ft (${Math.round(a.elev * 0.3048)} m)`]);
  if (a.lat != null) rows.push(['Toạ độ', `${dms(a.lat, 'N', 'S')} ${dms(a.lon, 'E', 'W')}<br><small>${a.lat.toFixed(4)}, ${a.lon.toFixed(4)}</small>`]);
  if (a.tz) rows.push(['Múi giờ', `${esc(a.tz)} (${tzOffsetLabel(a.tz)})`]);
  if (d?.magdec) rows.push(['Độ lệch từ', esc(d.magdec)]);
  const fr = (d?.f || []).map(f => `<div class="freq"><b>${esc(f[2])}</b>${esc(f[0])}${f[1] && f[1] !== f[0] ? ' · ' + esc(f[1]) : ''}</div>`).join('');
  return `<div class="card"><div class="card-head"><h3>Thông tin sân bay</h3></div>
    <div class="drows">${rows.map(r => `<div class="drow"><div class="k">${r[0]}</div><div class="v">${r[1]}</div></div>`).join('')}</div>
    ${fr ? `<div class="card-head" style="border-top:1px solid var(--line)"><h3 style="font-size:14px">Tần số (MHz)</h3><span class="sub">OurAirports – tham khảo, kiểm tra AIP</span></div><div class="freqs">${fr}</div>` : ''}</div>`;
}
/* ---------- NOTAM ---------- */
const notamCache = {};
async function loadNotam(icao) {
  if (notamCache[icao] && Date.now() - notamCache[icao].t < 10 * 60e3) return notamCache[icao];
  let res;
  try {
    const r = await fetchT(BASE + '/api/notam?id=' + icao, 20000);
    const j = await r.json();
    res = r.ok && j.ok !== false ? { ok: true, list: j.notams || [], src: j.source } : { ok: false, err: j.error || 'HTTP ' + r.status };
  } catch (e) { res = { ok: false, err: e.name === 'AbortError' ? 'hết thời gian chờ' : e.message }; }
  res.t = Date.now(); notamCache[icao] = res; return res;
}
function notamLinks(icao) {
  const vn = icao.startsWith('VV');
  return `<a class="linkbtn" href="https://notams.aim.faa.gov/notamSearch/nsapp.html#/" target="_blank" rel="noopener">FAA NOTAM Search ↗</a>` +
    (vn ? `<a class="linkbtn" href="https://aim.vatm.vn/" target="_blank" rel="noopener">AIS Việt Nam (VATM) ↗</a>` : '') +
    `<a class="linkbtn" href="https://www.google.com/search?q=${icao}+NOTAM" target="_blank" rel="noopener">Tìm NOTAM ${icao} ↗</a>`;
}
function notamCard(icao, n) {
  let body;
  if (!n) body = `<div class="raw" style="color:var(--muted)">Đang tải NOTAM…</div>`;
  else if (n.ok && n.list.length) body = n.list.slice(0, 60).map(x => `<div class="notam"><div class="nh"><b>${esc(x.id || '')}</b> ${esc(x.loc || '')} · ${esc(x.start || '')} → ${esc(x.end || '')}</div><pre>${esc(x.text || '')}</pre></div>`).join('');
  else if (n.ok) body = `<div class="raw" style="color:var(--muted)">Không có NOTAM hiện hành.</div>`;
  else body = `<div class="notam"><div style="font-size:13.5px;line-height:1.5">Chưa lấy được NOTAM tự động (${esc(n.err)}).<br>
    <small>Nguồn NOTAM công khai không cần khoá duy nhất là FAA NOTAM Search, nhưng hệ thống chống bot của FAA chặn mọi truy cập từ máy chủ (proxy Vercel). Các API khác (FAA NMS, ICAO API Data Service…) đều cần đăng ký khoá. App không hiện NOTAM giả – bấm để mở nguồn chính thức:</small></div><div style="margin-top:6px">${notamLinks(icao)}</div></div>`;
  return `<div class="card" id="card-notam"><div class="card-head"><h3>NOTAM</h3><span class="sub">${n?.ok ? esc(n.src || '') : ''}</span></div>${body}</div>`;
}
window.renderExtras = (icao, p) => {
  const el = id => document.getElementById(id);
  const paint = () => {
    if (current !== icao || !el('x-rwy')) return;
    const d = apData[icao];
    el('x-rwy').innerHTML = d ? runwayCard(d, p) : (icao in apData ? '' : '<div class="card"><div class="card-head"><h3>Đường băng & gió ngang</h3></div><div class="raw" style="color:var(--muted)">Đang tải…</div></div>');
    el('x-info').innerHTML = infoCard(icao, d);
    el('x-notam').innerHTML = notamCard(icao, notamCache[icao]);
  };
  paint();
  if (!(icao in apData)) loadAp(icao).then(paint);
  if (!notamCache[icao] || Date.now() - notamCache[icao].t > 10 * 60e3) loadNotam(icao).then(paint);
};

/* ---------- Đồng bộ ---------- */
let syncCode = LS.get('syncCode', null), syncT = null, applying = false;
const prefsPayload = () => ({ favs, settings: { ...settings }, updated: LS.get('updated', Date.now()) });
function applyPrefs(d) {
  applying = true;
  if (Array.isArray(d.favs)) favs = d.favs.slice();
  if (d.settings) Object.assign(settings, d.settings);
  LS.set('favs', favs); LS.set('settings', settings); LS.set('updated', d.updated || Date.now());
  applyTheme(); schedule(); renderList(); if (current) renderDetail();
  if (!document.getElementById('sheet-settings').hidden) renderSettings();
  applying = false;
  fetchWx(favs).then(renderList).catch(() => {});
}
async function syncPush() {
  if (!syncCode) return;
  try { await fetchT(`${BASE}/api/sync?code=${syncCode}`, 15000, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: prefsPayload() }) }); LS.set('syncAt', Date.now()); } catch {}
}
async function syncPull(force) {
  if (!syncCode) return;
  try {
    const r = await fetchT(`${BASE}/api/sync?code=${syncCode}`, 15000);
    if (r.status === 404) { toast('Mã đồng bộ không còn tồn tại'); return; }
    const d = await r.json();
    if (force || (d.updated || 0) > LS.get('updated', 0)) { applyPrefs(d); toast('Đã đồng bộ từ máy khác'); }
    else if ((d.updated || 0) < LS.get('updated', 0)) syncPush();
    LS.set('syncAt', Date.now());
  } catch {}
}
window.onPrefsChanged = () => {
  if (applying) return;
  clearTimeout(syncT); syncT = setTimeout(() => { syncPush(); if (settings.notify !== 'off') registerPush(true); }, 1200);
};
function b64u(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64u(s) { return decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))); }
const appUrl = () => location.origin + location.pathname;
function qrImg(text) { try { const q = qrcode(0, 'M'); q.addData(text); q.make(); return `<div class="qr"><img alt="QR" src="${q.createDataURL(5, 2)}"></div>`; } catch { return ''; } }
window.renderSettingsExtras = () => {
  const box = document.createElement('div');
  const iosNoPwa = /iPhone|iPad/.test(navigator.userAgent) && !navigator.standalone;
  let syncHtml;
  if (syncCode) {
    const link = appUrl() + '#sync=' + syncCode;
    syncHtml = `<div class="sitem col"><label>Mã đồng bộ của bạn</label><div class="sync-code">${syncCode}</div>
      <div class="small">Trên máy khác: mở link hoặc quét QR, hoặc nhập mã này. Yêu thích và cài đặt sẽ tự đồng bộ (bản sửa sau cùng được giữ).</div>
      ${qrImg(link)}<div class="small" style="word-break:break-all">${esc(link)}</div>
      <div><button class="linkbtn" id="sy-copy">Sao chép link</button><button class="linkbtn" id="sy-now">Đồng bộ ngay</button><button class="linkbtn" id="sy-off" style="color:var(--ifr)">Ngắt đồng bộ</button></div>
      <div class="small">Lần đồng bộ gần nhất: ${LS.get('syncAt') ? fmtLocalNow(LS.get('syncAt')) : '—'}</div></div>`;
  } else {
    syncHtml = `<div class="sitem col"><label>Đồng bộ giữa điện thoại và máy tính – không cần đăng nhập</label>
      <div><button class="pill" id="sy-new" style="padding:7px 14px;font-size:14px">Tạo mã đồng bộ</button></div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:6px"><input class="sinput" id="sy-input" maxlength="8" placeholder="Nhập mã"><button class="linkbtn" id="sy-join">Kết nối</button></div></div>`;
  }
  const exp = appUrl() + '#import=' + b64u(JSON.stringify({ favs, settings }));
  box.innerHTML = `<div class="sgroup"><h4>Đồng bộ</h4>${syncHtml}
    <div class="sitem col"><label>Xuất/nhập không cần máy chủ</label><div class="small">Mở link này trên máy khác để chép danh sách yêu thích + cài đặt hiện tại (một lần).</div>
    <div><button class="linkbtn" id="sy-exp">Sao chép link xuất</button><button class="linkbtn" id="sy-expqr">Hiện QR</button></div><div id="sy-expbox"></div></div></div>
    <div class="sgroup"><h4>Về thông báo</h4><div class="sitem col"><div class="small">
      Trạng thái: ${'Notification' in window ? ({ granted: 'đã cho phép', denied: 'đã bị chặn trong cài đặt trình duyệt', default: 'chưa hỏi' })[Notification.permission] : 'trình duyệt không hỗ trợ'}${'PushManager' in window ? ' · hỗ trợ thông báo đẩy' : ''}.<br>
      Khi bật, app báo khi sân bay yêu thích đổi hạng bay (hoặc có METAR/TAF mới) – cả lúc app đang mở và qua thông báo đẩy khi đã đóng (máy chủ kiểm tra khoảng mỗi 10 phút).
      ${iosNoPwa ? '<br><b>iPhone:</b> cần mở bằng Safari → Chia sẻ → «Thêm vào MH chính», rồi mở app từ màn hình chính và bật thông báo ở đây (iOS 16.4+).' : ''}
      <br>Widget màn hình chính iOS không làm được bằng ứng dụng web.</div></div></div>`;
  document.getElementById('settings-body').appendChild(box);
};
document.getElementById('sheet-settings').addEventListener('click', async e => {
  const id = e.target.id; if (!id || !id.startsWith('sy-')) return;
  if (id === 'sy-new') {
    try { const r = await fetchT(BASE + '/api/sync', 15000, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: prefsPayload() }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error); syncCode = j.code; LS.set('syncCode', syncCode); LS.set('syncAt', Date.now()); toast('Đã tạo mã ' + syncCode); }
    catch (err) { toast('Không tạo được mã: ' + err.message); }
  } else if (id === 'sy-join') {
    const c = document.getElementById('sy-input').value.trim().toUpperCase();
    if (!/^[A-Z2-9]{8}$/.test(c)) { toast('Mã gồm 8 ký tự'); return; }
    syncCode = c; LS.set('syncCode', c); await syncPull(true);
  } else if (id === 'sy-now') { await syncPull(false); await syncPush(); toast('Đã đồng bộ'); }
  else if (id === 'sy-off') { syncCode = null; LS.set('syncCode', null); toast('Đã ngắt đồng bộ trên máy này'); }
  else if (id === 'sy-copy') { copy(appUrl() + '#sync=' + syncCode); return; }
  else if (id === 'sy-exp') { copy(appUrl() + '#import=' + b64u(JSON.stringify({ favs, settings }))); return; }
  else if (id === 'sy-expqr') { document.getElementById('sy-expbox').innerHTML = qrImg(appUrl() + '#import=' + b64u(JSON.stringify({ favs, settings }))); return; }
  renderSettings();
});
function copy(t) { (navigator.clipboard?.writeText(t) || Promise.reject()).then(() => toast('Đã sao chép link'), () => prompt('Sao chép link:', t)); }

/* ---------- Thông báo ---------- */
function urlB64(b) { const p = '='.repeat((4 - b.length % 4) % 4); const r = atob((b + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map(c => c.charCodeAt(0))); }
async function registerPush(silent) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || Notification.permission !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(VAPID_PUB) }));
    const r = await fetchT(BASE + '/api/push', 15000, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON(), favs, std: settings.std, mode: settings.notify }) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    if (!silent) toast('Đã bật thông báo đẩy');
    return true;
  } catch (e) { if (!silent) toast('Chỉ bật được thông báo khi app đang mở (' + e.message + ')'); return false; }
}
async function unregisterPush() {
  try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) { await fetchT(BASE + '/api/push', 15000, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) }); await sub.unsubscribe(); } } catch {}
}
window.onNotifySetting = async (v) => {
  if (v === 'off') { unregisterPush(); return; }
  if (!('Notification' in window)) { toast('Trình duyệt này không hỗ trợ thông báo'); return; }
  const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (perm !== 'granted') { toast('Thông báo đang bị chặn – hãy cho phép trong cài đặt trình duyệt'); return; }
  await registerPush(false);
  renderSettings();
};
async function notifyLocal(title, body, id) {
  if (settings.notify === 'off') return;
  if (!document.hidden) toast(title);
  if ('Notification' in window && Notification.permission === 'granted') {
    try { const reg = await navigator.serviceWorker?.ready; await reg.showNotification(title, { body, tag: 'ttb-' + id, data: { id }, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' }); } catch { try { new Notification(title, { body }); } catch {} }
  }
}
window.onNewMetar = (id, old, neu) => {
  if (!old || !favs.includes(id) || old.obsTime === neu.obsTime || neu.obsTime < old.obsTime) return;
  const a = metarCat(old), b = metarCat(neu);
  if (a !== b) notifyLocal(`${id}: ${a} → ${b}`, neu.rawOb, id);
  else if (settings.notify === 'all') notifyLocal(`${id}: METAR mới (${b})`, neu.rawOb, id);
};
window.onNewTaf = (id, old, neu) => {
  if (!old || !favs.includes(id) || settings.notify !== 'all' || old.issueTime === neu.issueTime) return;
  notifyLocal(`${id}: có TAF mới`, neu.rawTAF, id);
};

/* ---------- Khởi động ---------- */
window.beforeInit = async () => {
  const h = location.hash;
  let m;
  if ((m = /^#import=(.+)$/.exec(h))) {
    try { const d = JSON.parse(unb64u(m[1])); applyPrefs({ ...d, updated: Date.now() }); toast('Đã nhập danh sách + cài đặt'); syncPush(); } catch { toast('Link nhập không hợp lệ'); }
    history.replaceState(null, '', location.pathname);
  } else if ((m = /^#sync=([A-Za-z2-9]{8})$/.exec(h))) {
    syncCode = m[1].toUpperCase(); LS.set('syncCode', syncCode); history.replaceState(null, '', location.pathname);
    await syncPull(true);
  } else if (syncCode) syncPull(false);
};
window.afterInit = () => {
  if (settings.notify !== 'off' && 'Notification' in window && Notification.permission === 'granted') registerPush(true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && syncCode) syncPull(false); });
  navigator.serviceWorker?.addEventListener('message', e => { if (e.data?.open) openDetail(e.data.open); });
};

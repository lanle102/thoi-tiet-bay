'use strict';
/* Thời Tiết Bay – METAR/TAF PWA. Dữ liệu: aviationweather.gov (qua proxy CORS nhỏ trên Vercel). */
const PROXY_HOST = 'https://thoi-tiet-bay.vercel.app';
const API = /vercel\.app$/.test(location.hostname) ? '/api/awc' : PROXY_HOST + '/api/awc';
const DEFAULT_FAVS = ['VVTS', 'VVNB', 'VVDN', 'VVCR', 'VVPQ'];
const VN_SUGGEST = ['VVTS','VVNB','VVDN','VVCR','VVPQ','VVCI','VVPB','VVCT','VVDL','VVBM','VVVH','VVTH','VVPC','VVCS','VVDH','VVPK','VVRG','VVCA','VVTX','VVVD','VVDB','VVCM','VVVT'];
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- Trạng thái ---------- */
const LS = {
  get(k, d) { try { const v = localStorage.getItem('ttb.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ttb.' + k, JSON.stringify(v)); } catch {} }
};
let favs = LS.get('favs', DEFAULT_FAVS);
const settings = Object.assign({ wind: 'kt', press: 'hPa', temp: 'C', vis: 'm', refresh: 10, theme: 'auto', listTime: 'utc' }, LS.get('settings', {}));
let cache = LS.get('cache', { metar: {}, taf: {}, ts: 0 }); // metar/taf theo ICAO
let airports = null, aptMap = {};
let current = null; // ICAO đang xem
let editing = false;
const ui = { metarRaw: LS.get('metarRaw', false), tafRaw: LS.get('tafRaw', false) };

/* ---------- Giao diện tối/sáng ---------- */
const mq = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const t = settings.theme === 'auto' ? (mq.matches ? 'dark' : 'light') : settings.theme;
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name=theme-color]').content = t === 'dark' ? '#0b1220' : '#f2f3f7';
}
mq.addEventListener?.('change', applyTheme);
applyTheme();

/* ---------- Dữ liệu sân bay ---------- */
async function loadAirports() {
  if (airports) return airports;
  const r = await fetch('airports.json');
  const rows = await r.json();
  airports = rows.map(a => ({ icao: a[0], iata: a[1], name: a[2], city: a[3], country: a[4], lat: a[5], lon: a[6], elev: a[7], tz: a[8],
    _s: norm(a[0] + ' ' + a[1] + ' ' + a[2] + ' ' + a[3]) }));
  aptMap = Object.fromEntries(airports.map(a => [a.icao, a]));
  return airports;
}
function norm(s) { return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase(); }
const VN_NAMES = { VVTS: 'Tân Sơn Nhất', VVNB: 'Nội Bài', VVDN: 'Đà Nẵng', VVCR: 'Cam Ranh', VVPQ: 'Phú Quốc', VVCI: 'Cát Bi', VVPB: 'Phú Bài', VVCT: 'Cần Thơ', VVDL: 'Liên Khương', VVBM: 'Buôn Ma Thuột', VVVH: 'Vinh', VVTH: 'Đồng Hới', VVPC: 'Phù Cát', VVCS: 'Côn Đảo', VVDH: 'Đồng Hới', VVPK: 'Pleiku', VVRG: 'Rạch Giá', VVCA: 'Chu Lai', VVTX: 'Thọ Xuân', VVVD: 'Vân Đồn', VVDB: 'Điện Biên Phủ', VVCM: 'Cà Mau', VVVT: 'Vũng Tàu' };
function aptInfo(icao) {
  const a = aptMap[icao] || {};
  const m = cache.metar[icao], t = cache.taf[icao];
  return {
    icao, iata: a.iata || '', name: VN_NAMES[icao] ? VN_NAMES[icao] : (a.name || cleanName(m?.name || t?.name) || ''),
    full: a.name || cleanName(m?.name || t?.name) || '', city: a.city || '', country: a.country || '',
    lat: a.lat ?? m?.lat ?? t?.lat, lon: a.lon ?? m?.lon ?? t?.lon, elev: a.elev ?? (m?.elev != null ? Math.round(m.elev * 3.28084) : null), tz: a.tz || null
  };
}
function cleanName(n) { return n ? n.replace(/,\s*[A-Z0-9]{1,3},\s*[A-Z]{2}$/, '') : ''; }

/* ---------- Gọi API ---------- */
async function api(type, params) {
  const u = API + '?type=' + type + '&' + new URLSearchParams(params);
  const r = await fetch(u, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const txt = await r.text();
  return txt.trim() ? JSON.parse(txt) : [];
}
async function fetchWx(ids, hours = 3) {
  ids = [...new Set(ids)].filter(Boolean);
  if (!ids.length) return;
  const chunks = []; for (let i = 0; i < ids.length; i += 40) chunks.push(ids.slice(i, i + 40));
  for (const ch of chunks) {
    const [metars, tafs] = await Promise.all([api('metar', { ids: ch.join(','), format: 'json', hours }), api('taf', { ids: ch.join(','), format: 'json' })]);
    const latest = {};
    for (const m of metars) { if (!latest[m.icaoId] || m.obsTime > latest[m.icaoId].obsTime) latest[m.icaoId] = m; }
    for (const id of ch) { if (latest[id]) cache.metar[id] = latest[id]; }
    const hist = {};
    for (const m of metars) (hist[m.icaoId] ||= []).push(m);
    for (const id in hist) cache.metar[id]._hist = hist[id].sort((a, b) => b.obsTime - a.obsTime).slice(0, 8).map(m => ({ rawOb: m.rawOb, obsTime: m.obsTime, fltCat: m.fltCat }));
    const tl = {};
    for (const t of tafs) { if (!tl[t.icaoId] || t.issueTime > tl[t.icaoId].issueTime) tl[t.icaoId] = t; }
    for (const id of ch) { if (tl[id]) cache.taf[id] = tl[id]; }
  }
  cache.ts = Date.now();
  LS.set('cache', cache);
}

/* ---------- Đơn vị ---------- */
const U = {
  wind(kt) { if (kt == null) return '—'; if (settings.wind === 'kmh') return Math.round(kt * 1.852) + ' km/h'; if (settings.wind === 'ms') return Math.round(kt * 0.514444) + ' m/s'; return Math.round(kt) + ' kt'; },
  temp(c) { if (c == null || isNaN(c)) return '—'; return settings.temp === 'F' ? Math.round(c * 9 / 5 + 32) + '°F' : Math.round(c) + '°C'; },
  tempShort(c) { if (c == null || isNaN(c)) return '—'; return settings.temp === 'F' ? Math.round(c * 9 / 5 + 32) + '°' : Math.round(c) + '°'; },
  press(hpa) { if (hpa == null) return '—'; return settings.press === 'inHg' ? (hpa / 33.8639).toFixed(2) + ' inHg' : Math.round(hpa) + ' hPa'; },
  visM(m, plus) { // m: mét
    if (m == null) return '—';
    if (settings.vis === 'SM') { const sm = m / 1609.34; if (plus || m >= 9999) return '≥ 6 SM'; return (sm < 3 ? (Math.round(sm * 4) / 4) : Math.round(sm)) + ' SM'; }
    if (plus || m >= 9999) return '≥ 10 km';
    return m >= 5000 ? (m / 1000).toFixed(m % 1000 ? 1 : 0).replace('.', ',') + ' km' : Math.round(m) + ' m';
  },
  visSM(v) { // giá trị visib từ JSON (SM hoặc "6+")
    if (v == null || v === '') return '—';
    if (String(v).includes('+')) return settings.vis === 'SM' ? '≥ 6 SM' : '≥ 10 km';
    const sm = parseFloat(v); if (isNaN(sm)) return String(v);
    if (settings.vis === 'SM') return (sm < 3 ? Math.round(sm * 4) / 4 : Math.round(sm)) + ' SM';
    let m = sm * 1609.34; m = m >= 5000 ? Math.round(m / 1000) * 1000 : Math.round(m / 100) * 100;
    return U.visM(m);
  }
};

/* ---------- Thời gian ---------- */
function pad(n) { return String(n).padStart(2, '0'); }
function fmtUTC(d, withDay) { return (withDay ? pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1) + ' ' : '') + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + 'Z'; }
function tzOffsetLabel(tz, d = new Date(), lon) {
  if (tz) { try { const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(d).find(x => x.type === 'timeZoneName'); return p.value.replace('GMT', 'UTC').replace(/^UTC$/, 'UTC+0'); } catch {} }
  const o = Math.round((lon || 0) / 15); return 'UTC' + (o >= 0 ? '+' : '') + o + '*';
}
function fmtLocal(d, tz, lon, withDay) {
  if (tz) { try { const P = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
    return (withDay ? P.day + '/' + P.month + ' ' : '') + P.hour + ':' + P.minute; } catch {} }
  const o = Math.round((lon || 0) / 15); const x = new Date(d.getTime() + o * 3600e3);
  return (withDay ? pad(x.getUTCDate()) + '/' + pad(x.getUTCMonth() + 1) + ' ' : '') + pad(x.getUTCHours()) + ':' + pad(x.getUTCMinutes());
}
function ago(sec) {
  const min = Math.max(0, Math.round((Date.now() / 1000 - sec) / 60));
  if (min < 1) return 'vừa xong'; if (min < 60) return min + ' phút trước';
  const h = Math.floor(min / 60), m = min % 60; if (h < 24) return h + ' giờ ' + (m ? m + ' phút ' : '') + 'trước';
  return Math.floor(h / 24) + ' ngày trước';
}
/* Mặt trời mọc/lặn (thuật toán kiểu SunCalc) */
function sunTimes(date, lat, lon) {
  const rad = Math.PI / 180, dayMs = 864e5, J1970 = 2440588, J2000 = 2451545, J0 = 0.0009, e = rad * 23.4397;
  const toDays = d => d.valueOf() / dayMs - 0.5 + J1970 - J2000;
  const fromJ = j => new Date((j + 0.5 - J1970) * dayMs);
  const lw = rad * -lon, phi = rad * lat, d = toDays(date);
  const n = Math.round(d - J0 - lw / (2 * Math.PI));
  const ds = J0 + lw / (2 * Math.PI) + n;
  const M = rad * (357.5291 + 0.98560028 * ds);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const Jnoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const h0 = -0.833 * rad;
  const cosw = (Math.sin(h0) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosw > 1) return { polar: 'night' }; if (cosw < -1) return { polar: 'day' };
  const w = Math.acos(cosw);
  const a = J0 + (w + lw) / (2 * Math.PI) + n;
  const Jset = J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const Jrise = Jnoon - (Jset - Jnoon);
  return { rise: fromJ(Jrise), set: fromJ(Jset), noon: fromJ(Jnoon) };
}

/* ---------- Giải mã METAR ---------- */
const COMPASS = ['Bắc', 'Bắc Đông Bắc', 'Đông Bắc', 'Đông Đông Bắc', 'Đông', 'Đông Đông Nam', 'Đông Nam', 'Nam Đông Nam', 'Nam', 'Nam Tây Nam', 'Tây Nam', 'Tây Tây Nam', 'Tây', 'Tây Tây Bắc', 'Tây Bắc', 'Bắc Tây Bắc'];
const compass = d => COMPASS[Math.round(d / 22.5) % 16];
const WX_DESC = { MI: 'nông', PR: 'một phần', BC: 'từng đám', DR: 'thổi thấp', BL: 'thổi cao', SH: 'rào', TS: 'dông', FZ: 'đóng băng' };
const WX_PHEN = { DZ: 'mưa phùn', RA: 'mưa', SN: 'tuyết', SG: 'hạt tuyết', IC: 'tinh thể băng', PL: 'hạt băng', GR: 'mưa đá', GS: 'mưa đá nhỏ', UP: 'giáng thủy không xác định',
  BR: 'mù ẩm', FG: 'sương mù', FU: 'khói', VA: 'tro núi lửa', DU: 'bụi', SA: 'cát', HZ: 'mù khô', PY: 'bụi nước', PO: 'xoáy bụi/cát', SQ: 'tố (gió giật mạnh)', FC: 'vòi rồng/lốc xoáy', SS: 'bão cát', DS: 'bão bụi' };
function decodeWx(code) {
  const m = /^(\+|-|VC|RE)?(MI|PR|BC|DR|BL|SH|TS|FZ)?((?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)*)$/.exec(code);
  if (!m || (!m[2] && !m[3])) return null;
  const phens = (m[3].match(/../g) || []).map(p => WX_PHEN[p]);
  let s;
  if (m[2] === 'TS') s = 'Dông' + (phens.length ? ' kèm ' + phens.join(', ') : '');
  else if (m[2] === 'SH') s = (phens.length ? phens.join(', ') : 'mưa') + ' rào';
  else if (m[2] === 'FZ') s = (phens.join(', ') || '') + ' đóng băng';
  else s = (phens.join(', ') + (m[2] ? ' ' + WX_DESC[m[2]] : '')).trim();
  if (m[1] === '-') s += ' nhẹ'; else if (m[1] === '+') s += ' mạnh'; else if (m[1] === 'VC') s += ' ở lân cận'; else if (m[1] === 'RE') s += ' (vừa qua)';
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const CLOUD = { FEW: 'Ít mây (1–2/8)', SCT: 'Mây rải rác (3–4/8)', BKN: 'Mây nhiều (5–7/8)', OVC: 'U ám (8/8)' };
const CLOUD_SHORT = { FEW: 'Ít mây', SCT: 'Rải rác', BKN: 'Mây nhiều', OVC: 'U ám', VV: 'Trần mây che khuất' };
function smToM(str) { // "1 1/2", "1/4", "10", "P6", "M1/4"
  let plus = false; str = str.replace(/^P/, () => { plus = true; return ''; }).replace(/^M/, '');
  let v = 0; for (const part of str.trim().split(/\s+/)) { if (part.includes('/')) { const [a, b] = part.split('/'); v += +a / +b; } else v += +part; }
  return { m: v * 1609.34, plus: plus || v > 6 };
}
function parseReport(raw, isTaf) {
  const r = { clouds: [], wx: [], rvr: [], trend: [], rmk: '' };
  if (!raw) return r;
  let body = raw.replace(/=\s*$/, '').trim();
  const ri = body.search(/\sRMK\s/); if (ri >= 0) { r.rmk = body.slice(ri + 5).trim(); body = body.slice(0, ri); }
  const ti = body.search(/\s(NOSIG|BECMG|TEMPO)(\s|$)/);
  if (!isTaf && ti >= 0) { r.trendRaw = body.slice(ti + 1).trim(); body = body.slice(0, ti); }
  const t = body.split(/\s+/);
  for (let i = 0; i < t.length; i++) {
    let x = t[i], m;
    if (i < 3 && /^(METAR|SPECI|TAF|AMD|COR)$/.test(x)) { if (x === 'SPECI') r.speci = true; continue; }
    if (/^[A-Z]{4}$/.test(x) && !r.icao) { r.icao = x; continue; }
    if (/^\d{6}Z$/.test(x)) { r.time = x; continue; }
    if (x === 'AUTO') { r.auto = true; continue; }
    if ((m = /^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS|KMH)$/.exec(x))) {
      const f = m[4] === 'MPS' ? 1.94384 : m[4] === 'KMH' ? 0.539957 : 1;
      r.wind = { dir: m[1] === 'VRB' ? null : +m[1], vrb: m[1] === 'VRB', spd: +m[2] * f, gust: m[3] ? +m[3] * f : null }; continue;
    }
    if ((m = /^(\d{3})V(\d{3})$/.exec(x))) { if (r.wind) { r.wind.from = +m[1]; r.wind.to = +m[2]; } continue; }
    if (x === 'CAVOK') { r.cavok = true; r.vis = { m: 9999, plus: true }; continue; }
    if ((m = /^(\d{4})(NDV)?$/.exec(x)) && !r.vis) { r.vis = { m: +m[1], plus: +m[1] >= 9999 }; continue; }
    if ((m = /^(\d{4})([NSEW]{1,2})$/.exec(x))) { r.visMin = { m: +m[1], dir: m[2] }; continue; }
    if (/^\d$/.test(x) && /^\d\/\dSM$/.test(t[i + 1] || '')) { r.vis = smToM(x + ' ' + t[i + 1].replace('SM', '')); i++; continue; }
    if ((m = /^([PM]?\d+(?:\/\d+)?)SM$/.exec(x))) { r.vis = smToM(m[1]); continue; }
    if ((m = /^R(\d{2}[LCR]?)\/([PM]?\d{4})(?:V([PM]?\d{4}))?(FT)?\/?([UDN])?$/.exec(x))) { r.rvr.push({ rwy: m[1], v: m[2], v2: m[3], ft: !!m[4], tr: m[5] }); continue; }
    if ((m = /^(FEW|SCT|BKN|OVC)(\d{3}|\/\/\/)(CB|TCU|\/\/\/)?$/.exec(x))) { r.clouds.push({ cover: m[1], base: m[2] === '///' ? null : +m[2] * 100, type: m[3] && m[3] !== '///' ? m[3] : null }); continue; }
    if ((m = /^VV(\d{3}|\/\/\/)$/.exec(x))) { r.vv = m[1] === '///' ? null : +m[1] * 100; r.clouds.push({ cover: 'VV', base: r.vv }); continue; }
    if (/^(NSC|NCD|SKC|CLR)$/.test(x)) { r.sky = x; continue; }
    if ((m = /^(M?\d{2})\/(M?\d{2})?$/.exec(x))) { r.temp = +m[1].replace('M', '-'); r.dew = m[2] != null ? +m[2].replace('M', '-') : null; continue; }
    if ((m = /^Q(\d{4})$/.exec(x))) { r.qnh = +m[1]; continue; }
    if ((m = /^A(\d{4})$/.exec(x))) { r.qnh = +m[1] / 100 * 33.8639; r.qnhInHg = +m[1] / 100; continue; }
    if (x === 'NSW') { r.wx.push('Hết hiện tượng thời tiết đáng kể'); continue; }
    if (/^WS/.test(x)) { r.ws = (r.ws ? r.ws + ' ' : '') + x; continue; }
    const w = decodeWx(x); if (w) { r.wx.push(w); continue; }
    (r.other ||= []).push(x);
  }
  return r;
}
function flightCat(visM, ceilFt) {
  const sm = visM == null ? 99 : visM / 1609.34, c = ceilFt == null ? 99999 : ceilFt;
  if (sm < 1 || c < 500) return 'LIFR'; if (sm < 3 || c < 1000) return 'IFR'; if (sm <= 5 || c <= 3000) return 'MVFR'; return 'VFR';
}
function ceilingOf(clouds) { let c = null; for (const k of clouds || []) if ((k.cover === 'BKN' || k.cover === 'OVC' || k.cover === 'OVX' || k.cover === 'VV') && k.base != null) c = c == null ? k.base : Math.min(c, k.base); return c; }
function metarCat(m) {
  if (m?.fltCat) return m.fltCat;
  if (!m) return 'UNK';
  const p = parseReport(m.rawOb); return p.vis || p.clouds.length ? flightCat(p.vis?.m, ceilingOf(p.clouds)) : 'UNK';
}
const CAT_VN = { VFR: 'VFR – bay bằng mắt', MVFR: 'MVFR – VFR hạn chế', IFR: 'IFR – bay bằng thiết bị', LIFR: 'LIFR – IFR thấp', UNK: 'Không rõ' };
const catColor = c => `var(--${(c || 'unk').toLowerCase()})`;
function windArrow(dir) { return `<span class="windarrow" style="transform:rotate(${dir + 180}deg)"><svg viewBox="0 0 24 24"><path d="M12 2 5 20l7-4 7 4z"/></svg></span>`; }
function windText(w, short) {
  if (!w) return '—';
  if (w.spd === 0) return 'Lặng gió';
  let s = (w.vrb ? 'Hướng thay đổi' : (short ? pad3(w.dir) + '°' : `${pad3(w.dir)}° (${compass(w.dir)})`)) + ' ' + U.wind(w.spd);
  if (w.gust) s += (short ? ' G' : ', giật ') + U.wind(w.gust).replace(/ .*/, short ? '' : ' ' + U.wind(w.gust).split(' ')[1]);
  if (!short && w.from != null) s += `<br><small>Thay đổi giữa ${pad3(w.from)}° và ${pad3(w.to)}°</small>`;
  return s;
}
function pad3(n) { return String(n).padStart(3, '0'); }
function cloudText(clouds, sky, cavok) {
  if (cavok) return 'CAVOK – tầm nhìn ≥ 10 km, không mây dưới 5.000 ft, không CB/TCU, không thời tiết đáng kể';
  if (!clouds?.length) return sky === 'NSC' ? 'Không có mây đáng kể (NSC)' : sky === 'NCD' ? 'Không phát hiện mây (NCD)' : sky ? 'Trời quang' : '—';
  return clouds.map(c => c.cover === 'VV' ? `Tầm nhìn thẳng đứng ${c.base != null ? c.base.toLocaleString('vi-VN') + ' ft' : 'không xác định'}`
    : `${CLOUD[c.cover] || c.cover} ở ${c.base != null ? c.base.toLocaleString('vi-VN') + ' ft' : '?'}${c.type === 'CB' ? ' – mây dông CB' : c.type === 'TCU' ? ' – mây tích tháp TCU' : ''}`).join('<br>');
}
function cloudShort(clouds, sky, cavok) {
  if (cavok) return 'CAVOK'; if (!clouds?.length) return sky || 'Quang';
  return clouds.slice(0, 2).map(c => c.cover + (c.base != null ? pad3(c.base / 100) : '') + (c.type || '')).join(' ');
}
function rh(t, d) { if (t == null || d == null) return null; const f = x => Math.exp(17.625 * x / (243.04 + x)); return Math.round(100 * f(d) / f(t)); }
function trendText(tr) {
  if (!tr) return null;
  if (tr === 'NOSIG') return 'NOSIG – không có thay đổi đáng kể trong 2 giờ tới';
  const parts = tr.split(/\s(?=BECMG|TEMPO)/);
  return parts.map(p => {
    const kind = p.startsWith('BECMG') ? 'Chuyển dần (BECMG)' : p.startsWith('TEMPO') ? 'Tạm thời (TEMPO)' : p;
    const r = parseReport('X ' + p.replace(/^(BECMG|TEMPO)/, '').replace(/\b(FM|TL|AT)(\d{4})\b/g, ''));
    const bits = [];
    const tm = p.match(/\b(FM|TL|AT)(\d{2})(\d{2})/g); if (tm) bits.push(tm.map(x => ({ FM: 'từ ', TL: 'đến ', AT: 'lúc ' })[x.slice(0, 2)] + x.slice(2, 4) + ':' + x.slice(4) + 'Z').join(' '));
    if (r.wind) bits.push('gió ' + windText(r.wind, true));
    if (r.vis) bits.push('tầm nhìn ' + U.visM(r.vis.m, r.vis.plus));
    if (r.wx.length) bits.push(r.wx.join(', ').toLowerCase());
    if (r.clouds.length || r.sky || r.cavok) bits.push(cloudShort(r.clouds, r.sky, r.cavok));
    return `<b>${kind}</b>: ${bits.join(' · ') || esc(p)}`;
  }).join('<br>');
}

/* ---------- Danh sách ---------- */
const ICON = {
  wind: '<svg class="ico" viewBox="0 0 24 24"><path d="M3 8h11a3 3 0 1 0-3-3h2a1 1 0 1 1 1 1H3zm0 4h16a3 3 0 1 1-3 3h2a1 1 0 1 0 1-1H3zm0 4h8v2H3z"/></svg>',
  eye: '<svg class="ico" viewBox="0 0 24 24"><path d="M12 5C6 5 2 12 2 12s4 7 10 7 10-7 10-7-4-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/></svg>',
  cloud: '<svg class="ico" viewBox="0 0 24 24"><path d="M7 19a5 5 0 0 1-.6-10A6 6 0 0 1 18 9.5 4.8 4.8 0 0 1 17.5 19z"/></svg>',
  grip: '<svg viewBox="0 0 24 24"><path d="M3 7h18v2H3zm0 4h18v2H3zm0 4h18v2H3z"/></svg>'
};
function renderList() {
  const ul = $('#apt-list');
  $('#list-empty').hidden = favs.length > 0;
  ul.innerHTML = favs.map(id => {
    const a = aptInfo(id), m = cache.metar[id];
    const cat = metarCat(m);
    if (!m) return `<li class="apt" data-id="${id}"><div class="bar" style="background:${catColor('UNK')}"></div><div class="main"><div class="row1"><span class="icao">${id}</span><span class="iata">${esc(a.iata)}</span></div><div class="name">${esc(a.name || a.full)}</div><div class="row3"><span class="age">${cache.ts ? 'Không có METAR gần đây' : 'Đang tải…'}</span></div></div>${editCtl()}</li>`;
    const p = parseReport(m.rawOb);
    const obs = new Date(m.obsTime * 1000);
    const old = Date.now() / 1000 - m.obsTime > 75 * 60;
    const tlabel = settings.listTime === 'utc' ? fmtUTC(obs) : fmtLocal(obs, a.tz, a.lon) + ' LT';
    const wind = p.wind ? (p.wind.spd === 0 ? 'Lặng gió' : (p.wind.vrb ? 'VRB' : pad3(p.wind.dir) + '°') + ' ' + U.wind(p.wind.spd) + (p.wind.gust ? ' G' + U.wind(p.wind.gust).split(' ')[0] : '')) : '—';
    const vis = p.vis ? U.visM(p.vis.m, p.vis.plus) : U.visSM(m.visib);
    return `<li class="apt" data-id="${id}">
      <div class="bar" style="background:${catColor(cat)}"></div>
      <div class="main">
        <div class="row1"><span class="icao">${id}</span><span class="iata">${esc(a.iata)}</span><span class="badge c-${cat}">${cat === 'UNK' ? '?' : cat}</span><span class="temp">${U.tempShort(p.temp ?? m.temp)}</span></div>
        <div class="name">${esc(a.name || a.full)} · <span class="age${old ? ' old' : ''}" data-obs="${m.obsTime}">${tlabel} (${ago(m.obsTime)})</span></div>
        <div class="row3"><span>${p.wind && p.wind.dir != null && p.wind.spd ? windArrow(p.wind.dir) : ICON.wind}${wind}</span><span>${ICON.eye}${vis}</span><span>${ICON.cloud}${cloudShort(p.clouds, p.sky, p.cavok)}</span></div>
        ${p.wx.length ? `<div class="wx-line">${esc(p.wx.join(', '))}</div>` : ''}
      </div>${editCtl()}</li>`;
  }).join('');
  $('#list-meta').innerHTML = cache.ts ? `<span>Cập nhật ${fmtLocalNow(cache.ts)}</span><span>${new Date().toISOString().slice(11, 16)}Z</span>` : '';
}
function fmtLocalNow(ts) { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function editCtl() { return `<div class="edit-ctl"><button class="del" aria-label="Xoá">−</button><div class="handle" aria-label="Kéo để sắp xếp">${ICON.grip}</div></div>`; }

$('#apt-list').addEventListener('click', e => {
  const li = e.target.closest('.apt'); if (!li) return;
  if (e.target.closest('.del')) { favs = favs.filter(x => x !== li.dataset.id); LS.set('favs', favs); renderList(); toast('Đã xoá ' + li.dataset.id); return; }
  if (editing || e.target.closest('.handle')) return;
  openDetail(li.dataset.id);
});
$('#btn-edit').onclick = () => { editing = !editing; $('#view-list').classList.toggle('editing', editing); $('#btn-edit').textContent = editing ? 'Xong' : 'Sửa'; };

/* Kéo để sắp xếp (pointer events – chạy trên cảm ứng và chuột) */
(function dragSort() {
  const ul = $('#apt-list'); let drag = null;
  ul.addEventListener('pointerdown', e => {
    const h = e.target.closest('.handle'); if (!h) return;
    e.preventDefault();
    const li = h.closest('.apt'); const rect = li.getBoundingClientRect();
    drag = { li, startY: e.clientY, offset: 0, h: rect.height + 10 };
    li.classList.add('dragging'); h.setPointerCapture(e.pointerId);
  });
  ul.addEventListener('pointermove', e => {
    if (!drag) return;
    const dy = e.clientY - drag.startY; drag.li.style.transform = `translateY(${dy - drag.offset}px) scale(1.02)`;
    const sib = dy - drag.offset > drag.h / 2 ? drag.li.nextElementSibling : dy - drag.offset < -drag.h / 2 ? drag.li.previousElementSibling : null;
    if (sib) {
      if (dy - drag.offset > 0) { sib.after(drag.li); drag.offset += drag.h; } else { sib.before(drag.li); drag.offset -= drag.h; }
      drag.li.style.transform = `translateY(${dy - drag.offset}px) scale(1.02)`;
    }
  });
  const end = () => { if (!drag) return; drag.li.style.transform = ''; drag.li.classList.remove('dragging'); drag = null;
    favs = [...ul.children].map(li => li.dataset.id); LS.set('favs', favs); };
  ul.addEventListener('pointerup', end); ul.addEventListener('pointercancel', end);
})();

/* Kéo để làm mới */
function pullToRefresh(scroller, ptr, onRefresh) {
  let y0 = null, dy = 0, busy = false;
  scroller.addEventListener('touchstart', e => { if (scroller.scrollTop <= 0 && !busy && !e.target.closest('.handle')) { y0 = e.touches[0].clientY; dy = 0; } }, { passive: true });
  scroller.addEventListener('touchmove', e => {
    if (y0 == null) return; dy = e.touches[0].clientY - y0;
    if (dy > 0 && scroller.scrollTop <= 0) { ptr.classList.add('pulling'); ptr.style.height = Math.min(70, dy * 0.45) + 'px'; ptr.lastElementChild.textContent = dy * 0.45 > 55 ? 'Thả để làm mới' : 'Kéo để làm mới'; }
  }, { passive: true });
  scroller.addEventListener('touchend', async () => {
    if (y0 == null) return; y0 = null; ptr.classList.remove('pulling');
    if (dy * 0.45 > 55) { busy = true; ptr.style.height = '44px'; ptr.classList.add('loading'); ptr.lastElementChild.textContent = 'Đang tải…';
      try { await onRefresh(); } finally { busy = false; ptr.classList.remove('loading'); ptr.style.height = '0'; } }
    else ptr.style.height = '0';
  });
}

/* ---------- Làm mới ---------- */
let refreshing = null;
async function refreshAll(silent) {
  if (refreshing) return refreshing;
  const ids = [...favs]; if (current && !ids.includes(current)) ids.push(current);
  refreshing = (async () => {
    $('#btn-refresh').classList.add('spin');
    try { await fetchWx(ids); renderList(); if (current) renderDetail(); if (!silent) toast('Đã cập nhật'); }
    catch (e) { toast('Lỗi tải dữ liệu: ' + e.message); }
    finally { $('#btn-refresh').classList.remove('spin'); refreshing = null; }
  })();
  return refreshing;
}
let timer = null;
function schedule() { clearInterval(timer); if (settings.refresh > 0) timer = setInterval(() => refreshAll(true), settings.refresh * 60e3); }
document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - cache.ts > 2 * 60e3) refreshAll(true); });
setInterval(() => { // cập nhật "phút trước" và đồng hồ
  document.querySelectorAll('.age[data-obs]').forEach(el => { const o = +el.dataset.obs; el.textContent = el.textContent.replace(/\(.*\)/, '(' + ago(o) + ')'); el.classList.toggle('old', Date.now() / 1000 - o > 75 * 60); });
  if (current) updateClocks();
}, 30e3);

/* ---------- Chi tiết ---------- */
function openDetail(id, push = true) {
  current = id;
  if (push) history.pushState({ id }, '', '#' + id);
  $('#view-detail').classList.add('active'); $('#view-list').classList.add('behind');
  $('#detail-scroller').scrollTop = 0;
  renderDetail();
  const m = cache.metar[id];
  if (!m || !m._hist || Date.now() - cache.ts > 60e3) fetchWx([id], 12).then(() => { renderDetail(); renderList(); }).catch(e => { $('#detail-body').insertAdjacentHTML('afterbegin', `<div class="err">Không tải được dữ liệu: ${esc(e.message)}</div>`); });
}
function closeDetail() { current = null; $('#view-detail').classList.remove('active'); $('#view-list').classList.remove('behind'); renderList(); }
$('#btn-back').onclick = () => { if (history.state?.id) history.back(); else { history.replaceState(null, '', location.pathname); closeDetail(); } };
window.addEventListener('popstate', e => { if (e.state?.id) openDetail(e.state.id, false); else closeDetail(); });
$('#btn-refresh').onclick = () => current && fetchWx([current], 12).then(() => { renderDetail(); renderList(); toast('Đã cập nhật'); }).catch(e => toast('Lỗi: ' + e.message));
$('#btn-fav').onclick = () => { if (!current) return; if (favs.includes(current)) { favs = favs.filter(x => x !== current); toast('Đã bỏ khỏi yêu thích'); } else { favs.push(current); toast('Đã thêm vào yêu thích'); } LS.set('favs', favs); renderDetail(); renderList(); };

function updateClocks() {
  const a = aptInfo(current), now = new Date();
  const u = $('#clk-utc'), l = $('#clk-loc'); if (!u) return;
  u.textContent = fmtUTC(now); l.textContent = fmtLocal(now, a.tz, a.lon);
}
function renderDetail() {
  const id = current, a = aptInfo(id), m = cache.metar[id], t = cache.taf[id];
  $('#d-title').textContent = id;
  $('#btn-fav').classList.toggle('on', favs.includes(id));
  const cat = metarCat(m);
  const p = m ? parseReport(m.rawOb) : null;
  const now = new Date();
  let html = `<div class="hero"><div class="codes"><span class="big">${id}</span><span class="iata">${esc(a.iata)}</span><span class="badge c-${cat}">${cat === 'UNK' ? '—' : cat}</span></div>
    <div class="nm">${esc(a.full || a.name || '')}</div><div class="loc">${esc([a.city, a.country].filter(Boolean).join(', '))}${a.elev != null ? ' · Cao độ ' + a.elev + ' ft' : ''}${a.lat != null ? ` · ${a.lat.toFixed(3)}, ${a.lon.toFixed(3)}` : ''}</div></div>`;
  // Đồng hồ & mặt trời
  let sun = '';
  if (a.lat != null) {
    const s = sunTimes(now, a.lat, a.lon);
    sun = s.polar ? (s.polar === 'day' ? 'Ngày vùng cực' : 'Đêm vùng cực') : `${fmtLocal(s.rise, a.tz, a.lon)} / ${fmtLocal(s.set, a.tz, a.lon)}`;
    var sunUtc = s.rise ? `${fmtUTC(s.rise)} / ${fmtUTC(s.set)}` : '';
  }
  html += `<div class="chips">
    <div class="chip"><div class="k">Giờ UTC</div><div class="v" id="clk-utc">${fmtUTC(now)}</div><div class="s">${now.toISOString().slice(0, 10)}</div></div>
    <div class="chip"><div class="k">Giờ địa phương</div><div class="v" id="clk-loc">${fmtLocal(now, a.tz, a.lon)}</div><div class="s">${tzOffsetLabel(a.tz, now, a.lon)}${a.tz ? '' : ' (ước tính)'}</div></div>
    <div class="chip"><div class="k">☀ Mọc / Lặn</div><div class="v">${sun || '—'}</div><div class="s">${sunUtc || ''}</div></div>
    <div class="chip"><div class="k">Nhiệt độ / Điểm sương</div><div class="v">${p ? U.temp(p.temp) + ' / ' + U.temp(p.dew) : '—'}</div><div class="s">${p && rh(p.temp, p.dew) != null ? 'Độ ẩm ~' + rh(p.temp, p.dew) + '%' : ''}</div></div>
  </div>`;
  // METAR
  if (m) {
    const old = Date.now() / 1000 - m.obsTime > 75 * 60;
    html += `<div class="card"><div class="card-head"><h3>${p.speci ? 'SPECI' : 'METAR'}</h3><span class="sub age${old ? ' old' : ''}" data-obs="${m.obsTime}">${fmtUTC(new Date(m.obsTime * 1000), true)} (${ago(m.obsTime)})</span>
      <div class="seg" data-k="metarRaw"><button class="${ui.metarRaw ? '' : 'on'}" data-v="0">Giải mã</button><button class="${ui.metarRaw ? 'on' : ''}" data-v="1">Bản thô</button></div></div>`;
    if (ui.metarRaw) html += `<div class="raw">${esc(m.rawOb)}</div>`;
    else {
      const rows = [];
      rows.push(['Hạng bay', `<span class="badge c-${cat}">${cat}</span> ${CAT_VN[cat] ? CAT_VN[cat].split('– ')[1] || '' : ''}`]);
      rows.push(['Gió', p.wind ? (p.wind.dir != null && p.wind.spd ? windArrow(p.wind.dir) : '') + windText(p.wind) : '—']);
      rows.push(['Tầm nhìn', p.vis ? U.visM(p.vis.m, p.vis.plus) + (p.visMin ? `<br><small>Tối thiểu ${U.visM(p.visMin.m)} về phía ${esc(p.visMin.dir)}</small>` : '') : U.visSM(m.visib)]);
      if (p.rvr.length) rows.push(['Tầm nhìn đường băng', p.rvr.map(r => `RWY ${r.rwy}: ${rvrTxt(r.v, r.ft)}${r.v2 ? ' – ' + rvrTxt(r.v2, r.ft) : ''}${r.tr ? ' (' + ({ U: 'tăng', D: 'giảm', N: 'không đổi' })[r.tr] + ')' : ''}`).join('<br>')]);
      rows.push(['Thời tiết', p.wx.length ? esc(p.wx.join(', ')) : (p.cavok ? 'Không có' : 'Không có hiện tượng đáng kể')]);
      rows.push(['Mây', cloudText(p.clouds, p.sky, p.cavok) + (ceilingOf(p.clouds) != null ? `<br><small>Trần mây: ${ceilingOf(p.clouds).toLocaleString('vi-VN')} ft</small>` : '')]);
      rows.push(['Nhiệt độ', U.temp(p.temp)]);
      rows.push(['Điểm sương', U.temp(p.dew) + (rh(p.temp, p.dew) != null ? ` <small>· độ ẩm ~${rh(p.temp, p.dew)}%</small>` : '')]);
      rows.push(['Áp suất QNH', p.qnh != null ? U.press(p.qnh) + (settings.press === 'hPa' ? ` <small>(${(p.qnhInHg ?? p.qnh / 33.8639).toFixed(2)} inHg)</small>` : ` <small>(${Math.round(p.qnh)} hPa)</small>`) : U.press(m.altim)]);
      if (p.ws) rows.push(['Gió đứt', esc(p.ws)]);
      if (p.trendRaw) rows.push(['Xu hướng', trendText(p.trendRaw)]);
      if (p.rmk) rows.push(['Ghi chú (RMK)', `<span style="font-family:var(--mono);font-size:13px">${esc(p.rmk)}</span>`]);
      if (p.auto) rows.push(['Nguồn', 'Trạm tự động (AUTO)']);
      html += `<div class="drows">${rows.map(r => `<div class="drow"><div class="k">${r[0]}</div><div class="v">${r[1]}</div></div>`).join('')}</div>`;
    }
    html += `</div>`;
  } else html += `<div class="card"><div class="card-head"><h3>METAR</h3></div><div class="raw" style="color:var(--muted)">${cache.ts ? 'Không có METAR trong 12 giờ qua cho sân bay này.' : 'Đang tải…'}</div></div>`;
  // TAF
  if (t) {
    const iss = new Date(t.issueTime);
    html += `<div class="card"><div class="card-head"><h3>TAF</h3><span class="sub">Phát hành ${fmtUTC(iss, true)} (${ago(iss / 1000)})</span>
      <div class="seg" data-k="tafRaw"><button class="${ui.tafRaw ? '' : 'on'}" data-v="0">Giải mã</button><button class="${ui.tafRaw ? 'on' : ''}" data-v="1">Bản thô</button></div></div>`;
    if (ui.tafRaw) html += `<div class="raw">${esc(t.rawTAF).replace(/\s(?=(FM\d{6}|TEMPO|BECMG|PROB\d{2}|RMK)\b)/g, '\n  ').replace(/PROB(\d{2})\n\s+TEMPO/g, 'PROB$1 TEMPO')}</div>`;
    else html += `<div class="note" style="padding:8px 12px 0">Hiệu lực ${fmtUTC(new Date(t.validTimeFrom * 1000), true)} → ${fmtUTC(new Date(t.validTimeTo * 1000), true)}</div>` + tafPeriods(t, a);
    html += `</div>`;
  } else html += `<div class="card"><div class="card-head"><h3>TAF</h3></div><div class="raw" style="color:var(--muted)">${cache.ts ? 'Sân bay này không có TAF hiện hành.' : 'Đang tải…'}</div></div>`;
  // Lịch sử
  if (m?._hist?.length > 1) {
    html += `<div class="card"><div class="card-head"><h3>METAR gần đây</h3></div><div class="hist">${m._hist.map(h => { const c = h.fltCat || metarCat(h); return `<div><span class="badge c-${c}">${c}</span><span>${esc(h.rawOb)}</span></div>`; }).join('')}</div></div>`;
  }
  html += `<p class="note">Giờ trong METAR/TAF là UTC (Z). Giờ mọc/lặn là giờ địa phương${a.tz ? ' (' + esc(a.tz) + ')' : ''}. Nguồn: aviationweather.gov.</p>`;
  $('#detail-body').innerHTML = html;
}
function rvrTxt(v, ft) { const pre = v[0] === 'P' ? 'trên ' : v[0] === 'M' ? 'dưới ' : ''; const n = +v.replace(/[PM]/, ''); return pre + n.toLocaleString('vi-VN') + (ft ? ' ft' : ' m'); }
$('#detail-body').addEventListener('click', e => {
  const b = e.target.closest('.seg button'); if (!b) return;
  const k = b.parentElement.dataset.k; ui[k] = b.dataset.v === '1'; LS.set(k, ui[k]); renderDetail();
});

function tafPeriods(t, a) {
  const fc = t.fcsts || [];
  let state = { visib: null, clouds: [], wxString: null, wdir: null, wspd: null, wgst: null };
  const out = [];
  fc.forEach((f, i) => {
    const kind = f.fcstChange || (i === 0 ? 'BASE' : 'FM');
    const prob = f.probability;
    const merged = {
      visib: f.visib ?? state.visib, clouds: f.clouds?.length ? f.clouds : (f.vertVis != null ? [{ cover: 'VV', base: f.vertVis }] : state.clouds),
      wxString: f.wxString ?? state.wxString
    };
    if (f.vertVis != null) merged.clouds = [...(f.clouds || []), { cover: 'VV', base: f.vertVis }];
    if (kind === 'BASE' || kind === 'FM' || kind === 'BECMG') {
      state = { ...state, ...Object.fromEntries(Object.entries({ visib: f.visib, wxString: f.wxString, wdir: f.wdir, wspd: f.wspd, wgst: f.wgst }).filter(([, v]) => v != null)) };
      if (f.clouds?.length || f.vertVis != null) state.clouds = merged.clouds;
    }
    const visM = merged.visib == null ? null : String(merged.visib).includes('+') ? 99999 : parseFloat(merged.visib) * 1609.34;
    const cat = flightCat(visM, ceilingOf(merged.clouds));
    const label = kind === 'BASE' ? 'CHÍNH' : kind === 'PROB' ? `PROB${prob}` : (prob ? `PROB${prob} ` : '') + kind;
    const typeVN = { BASE: 'Dự báo chính', FM: 'Từ', TEMPO: 'Tạm thời', BECMG: 'Chuyển dần', PROB: `Xác suất ${prob}%` }[kind] || kind;
    const from = new Date(f.timeFrom * 1000), to = new Date(f.timeTo * 1000);
    const lines = [];
    if (f.wspd != null) lines.push('Gió ' + (f.wspd === 0 ? 'lặng' : (f.wdir === 'VRB' || f.wdir == null ? 'thay đổi' : `${pad3(f.wdir)}° (${compass(+f.wdir)})`) + ' ' + U.wind(f.wspd) + (f.wgst ? ', giật ' + U.wind(f.wgst) : '')));
    if (f.visib != null) lines.push('Tầm nhìn ' + U.visSM(f.visib));
    if (f.wxString) lines.push(f.wxString.split(' ').map(w => decodeWx(w) || w).join(', '));
    if (f.clouds?.length) lines.push(f.clouds.map(c => (CLOUD_SHORT[c.cover] || c.cover) + ' ' + (c.base != null ? c.base.toLocaleString('vi-VN') + ' ft' : '') + (c.type === 'CB' ? ' (CB)' : c.type === 'TCU' ? ' (TCU)' : '')).join(', '));
    if (f.vertVis != null) lines.push('Tầm nhìn thẳng đứng ' + f.vertVis + ' ft');
    if (f.wshearHgt != null) lines.push(`Gió đứt ở ${f.wshearHgt * 100} ft: ${pad3(f.wshearDir)}° ${U.wind(f.wshearSpd)}`);
    if (f.altim != null) lines.push('QNH ' + U.press(f.altim));
    if (f.notDecoded) lines.push(`<span style="font-family:var(--mono)">${esc(f.notDecoded)}</span>`);
    if (!lines.length && (kind === 'BASE' || kind === 'FM')) lines.push('CAVOK / không mây đáng kể');
    const tm = `${fmtUTC(from, true)} → ${fmtUTC(to, true)}` + (f.timeBec ? ` <small>(chuyển xong ${fmtUTC(new Date(f.timeBec * 1000))})</small>` : '');
    const nowIn = Date.now() >= from && Date.now() < to && (kind === 'BASE' || kind === 'FM' || kind === 'BECMG');
    out.push(`<div class="period"><div class="pbar" style="background:${catColor(cat)}"></div><div class="pbody">
      <div class="ptitle"><span class="ptype">${label}</span><span>${typeVN}</span><span class="badge c-${cat}">${cat}</span>${nowIn ? '<span class="ptime">• hiện tại</span>' : ''}</div>
      <div class="ptime">${tm} <small>· LT ${fmtLocal(from, a.tz, a.lon, true)}–${fmtLocal(to, a.tz, a.lon)}</small></div>
      <div class="pline">${lines.join('<br>')}</div></div></div>`);
  });
  return out.join('') || `<div class="raw">${esc(t.rawTAF)}</div>`;
}

/* ---------- Tìm kiếm ---------- */
function openSearch() { $('#sheet-search').hidden = false; $('#search-input').value = ''; renderSearch(''); setTimeout(() => $('#search-input').focus(), 50); loadAirports().then(() => renderSearch($('#search-input').value)); }
function closeSearch() { $('#sheet-search').hidden = true; }
$('#btn-add').onclick = openSearch; $('#btn-empty-add').onclick = openSearch; $('#btn-search-close').onclick = closeSearch;
$('#sheet-search').addEventListener('click', e => { if (e.target.id === 'sheet-search') closeSearch(); });
$('#search-input').addEventListener('input', e => renderSearch(e.target.value));
function renderSearch(q) {
  q = q.trim(); const nq = norm(q);
  let res;
  if (!q) { res = VN_SUGGEST.map(id => aptMap[id] || { icao: id, iata: '', name: VN_NAMES[id] || '', city: '', country: 'VN' }); $('#search-hint').textContent = 'Gợi ý: sân bay Việt Nam'; }
  else {
    const all = airports || [];
    const up = q.toUpperCase();
    const exact = all.filter(a => a.icao === up || a.iata === up);
    const pre = all.filter(a => !exact.includes(a) && (a.icao.startsWith(up) || a.iata.startsWith(up)));
    const word = nq.length >= 2 ? all.filter(a => !exact.includes(a) && !pre.includes(a) && a._s.includes(nq)) : [];
    res = [...exact, ...pre, ...word].slice(0, 40);
    if (/^[A-Z0-9]{4}$/.test(up) && !res.some(a => a.icao === up)) res.unshift({ icao: up, iata: '', name: 'Mã ICAO ' + up + ' (ngoài danh bạ – thử tải)', city: '', country: '' });
    $('#search-hint').textContent = res.length ? res.length + ' kết quả' : 'Không tìm thấy';
  }
  $('#search-results').innerHTML = res.map(a => `<li data-id="${a.icao}"><span class="sc">${a.icao}</span><div class="sn"><div>${esc(VN_NAMES[a.icao] && a.country === 'VN' ? VN_NAMES[a.icao] + ' – ' + (a.name || '') : a.name)}</div><div>${esc([a.iata, a.city, a.country].filter(Boolean).join(' · '))}</div></div><button class="addbtn${favs.includes(a.icao) ? ' on' : ''}" aria-label="Yêu thích">${favs.includes(a.icao) ? '★' : '☆'}</button></li>`).join('');
}
$('#search-results').addEventListener('click', e => {
  const li = e.target.closest('li'); if (!li) return; const id = li.dataset.id;
  if (e.target.closest('.addbtn')) {
    if (favs.includes(id)) favs = favs.filter(x => x !== id); else { favs.push(id); toast('Đã thêm ' + id); fetchWx([id]).then(renderList).catch(() => {}); }
    LS.set('favs', favs); renderList(); renderSearch($('#search-input').value); return;
  }
  closeSearch(); openDetail(id);
});

/* ---------- Cài đặt ---------- */
const SETTINGS_DEF = [
  ['Đơn vị', [['wind', 'Tốc độ gió', [['kt', 'kt'], ['kmh', 'km/h'], ['ms', 'm/s']]], ['press', 'Áp suất', [['hPa', 'hPa'], ['inHg', 'inHg']]],
    ['temp', 'Nhiệt độ', [['C', '°C'], ['F', '°F']]], ['vis', 'Tầm nhìn', [['m', 'm/km'], ['SM', 'SM']]]]],
  ['Hiển thị', [['theme', 'Giao diện', [['auto', 'Tự động'], ['light', 'Sáng'], ['dark', 'Tối']]], ['listTime', 'Giờ ở danh sách', [['utc', 'UTC'], ['local', 'Địa phương']]]]],
  ['Làm mới', [['refresh', 'Tự làm mới', [[0, 'Tắt'], [5, '5′'], [10, '10′'], [15, '15′'], [30, '30′']]]]]
];
function renderSettings() {
  $('#settings-body').innerHTML = SETTINGS_DEF.map(([g, items]) => `<div class="sgroup"><h4>${g}</h4>${items.map(([k, label, opts]) => `<div class="sitem"><label>${label}</label><div class="seg" data-set="${k}">${opts.map(([v, t]) => `<button data-v="${v}" class="${String(settings[k]) === String(v) ? 'on' : ''}">${t}</button>`).join('')}</div></div>`).join('')}</div>`).join('') +
    `<div class="sgroup"><h4>Hạng bay</h4><div class="legend"><span><span class="badge c-VFR">VFR</span> trần &gt; 3.000 ft, tầm nhìn &gt; 5 SM</span><span><span class="badge c-MVFR">MVFR</span> 1.000–3.000 ft / 3–5 SM</span><span><span class="badge c-IFR">IFR</span> 500–999 ft / 1–3 SM</span><span><span class="badge c-LIFR">LIFR</span> &lt; 500 ft / &lt; 1 SM</span></div></div>
    <div class="sgroup"><h4>Thông tin</h4><div class="sitem"><label style="font-size:13px;color:var(--muted);line-height:1.5">Dữ liệu METAR/TAF từ Aviation Weather Center (NOAA) – aviationweather.gov. Mẹo: trên iPhone mở bằng Safari → Chia sẻ → «Thêm vào MH chính» để dùng như ứng dụng.<br>Danh sách yêu thích và cài đặt lưu trên thiết bị này.</label></div>
    <div class="sitem"><label>Khôi phục danh sách mặc định (VN)</label><button class="pill" id="btn-reset" style="padding:6px 12px;font-size:13px">Khôi phục</button></div></div>`;
}
$('#btn-settings').onclick = () => { renderSettings(); $('#sheet-settings').hidden = false; };
$('#btn-settings-close').onclick = () => { $('#sheet-settings').hidden = true; };
$('#sheet-settings').addEventListener('click', e => {
  if (e.target.id === 'sheet-settings') { $('#sheet-settings').hidden = true; return; }
  if (e.target.id === 'btn-reset') { favs = [...DEFAULT_FAVS]; LS.set('favs', favs); renderList(); refreshAll(true); toast('Đã khôi phục'); return; }
  const b = e.target.closest('.seg[data-set] button'); if (!b) return;
  const k = b.parentElement.dataset.set; settings[k] = k === 'refresh' ? +b.dataset.v : b.dataset.v; LS.set('settings', settings);
  applyTheme(); schedule(); renderSettings(); renderList(); if (current) renderDetail();
});

/* ---------- Tiện ích ---------- */
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2200); }

/* ---------- Khởi động ---------- */
(async function init() {
  pullToRefresh($('#list-scroller'), $('#ptr'), () => refreshAll(true));
  pullToRefresh($('#detail-scroller'), $('#ptr2'), () => current ? fetchWx([current], 12).then(() => { renderDetail(); renderList(); }) : null);
  renderList();
  try { await loadAirports(); } catch {}
  renderList();
  const hashId = location.hash.slice(1).toUpperCase();
  if (/^[A-Z0-9]{3,4}$/.test(hashId)) { history.replaceState(null, '', location.pathname); openDetail(hashId); }
  if (!cache.ts || !Object.keys(cache.metar).length) $('#apt-list').innerHTML = favs.map(() => '<li class="skeleton"></li>').join('');
  await refreshAll(true);
  schedule();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();

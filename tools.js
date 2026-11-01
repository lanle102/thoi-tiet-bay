'use strict';
/* Công cụ (chạy offline): máy tính giờ phút, quy đổi đơn vị, hiệu năng (ISA). Công thức trong calc.js (có kiểm thử). */
const TS = LS.get('tools', { t: 'time', rows: [{ op: '+', v: '1:45' }, { op: '+', v: '2:30' }], tz: 'VVTS' });
const nf = (v, d = 0) => !isFinite(v) ? '—' : v.toLocaleString('vi-VN', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const num = s => { const v = parseFloat(String(s ?? '').replace(',', '.')); return isFinite(v) ? v : NaN; };
const saveT = () => LS.set('tools', TS);
window.showTools = () => renderTools();
document.getElementById('tool-tabs').addEventListener('click', e => { const b = e.target.closest('button[data-t]'); if (!b) return; TS.t = b.dataset.t; saveT(); renderTools(); });
function renderTools() {
  document.querySelectorAll('#tool-tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === TS.t));
  const el = document.getElementById('tools-body');
  el.innerHTML = TS.t === 'time' ? timeHtml() : TS.t === 'unit' ? unitHtml() : perfHtml();
  el.querySelectorAll('input,select').forEach(i => i.addEventListener('input', () => calcAll()));
  calcAll();
}
const card = (title, body, note) => `<div class="card tool"><div class="card-head"><h3>${title}</h3></div><div class="tbody">${body}</div>${note ? `<div class="note tnote">${note}</div>` : ''}</div>`;
const field = (id, label, val = '', ph = '', mode = 'decimal', cls = '') => `<label class="tf ${cls}"><span>${label}</span><input id="${id}" class="tinput" value="${esc(val)}" placeholder="${esc(ph)}" inputmode="${mode}" autocomplete="off"></label>`;
const out = (id, label) => `<div class="tout"><span>${label}</span><b id="${id}">—</b></div>`;
/* ---- Giờ phút ---- */
function timeHtml() {
  const rows = TS.rows.map((r, i) => `<div class="hm-row" data-i="${i}"><button class="opbtn" data-op="${i}">${r.op === '-' ? '−' : '+'}</button><input class="tinput hm" data-v="${i}" value="${esc(r.v)}" placeholder="H:MM" inputmode="decimal"><button class="delbtn" data-del="${i}" aria-label="Xoá">×</button></div>`).join('');
  const now = new Date(), d = now.toISOString().slice(0, 10), t = now.toISOString().slice(11, 16);
  return card('Cộng / trừ dồn giờ phút', `<div id="hm-rows">${rows}</div><div class="tbtns"><button class="linkbtn" id="hm-add">+ Thêm dòng</button><button class="linkbtn" id="hm-clear">Xoá hết</button></div>${out('hm-total', 'Tổng')}${out('hm-dec', 'Giờ thập phân')}`,
      'Nhập 1:30, 0130, 1,5 (giờ thập phân) hoặc 2 (giờ). Bấm +/− để đổi dấu từng dòng.') +
    card('HH:MM ⇄ giờ thập phân', `<div class="tgrid">${field('cv-hm', 'HH:MM', '1:20', '1:20')}${field('cv-dec', 'Giờ thập phân', '', '1,33')}</div>`, 'Nhập một ô, ô kia tự tính (làm tròn đến phút / 0,01 giờ).') +
    card('UTC ⇄ giờ địa phương', `<div class="tgrid"><label class="tf"><span>Ngày (UTC)</span><input id="tz-date" type="date" class="tinput" value="${d}"></label>${field('tz-time', 'Giờ UTC (HH:MM)', t, '14:30')}
      ${field('tz-apt', 'Sân bay ICAO hoặc múi giờ IANA', TS.tz, 'VVTS / Asia/Tokyo', 'text')}${field('tz-loc', 'hoặc nhập giờ địa phương', '', 'HH:MM')}</div>${out('tz-out', 'Kết quả')}`, 'Dùng múi giờ thật (IANA, có giờ mùa hè) của sân bay; tính offline.') +
    card('Giờ đến dự kiến (ETA)', `<div class="tgrid">${field('eta-dep', 'Giờ cất cánh UTC (HH:MM)', t, '02:10')}${field('eta-ete', 'Thời gian bay (HH:MM)', '', '1:55')}${field('eta-dist', 'hoặc quãng đường (NM)', '', '620')}${field('eta-gs', 'Ground speed (kt)', '', '440')}${field('eta-apt', 'Sân bay đến (để đổi giờ địa phương)', '', 'VVNB', 'text')}</div>${out('eta-ete-out', 'Thời gian bay')}${out('eta-out', 'ETA')}`,
      'Nếu nhập cả quãng đường và ground speed, thời gian bay = quãng đường ÷ GS.');
}
function tzOf(s) {
  s = String(s || '').trim(); if (!s) return null;
  if (/^[A-Za-z0-9]{4}$/.test(s)) { const a = aptInfo(s.toUpperCase()); return a.tz ? { tz: a.tz, label: s.toUpperCase() + (a.name ? ' – ' + a.name : '') } : null; }
  try { new Intl.DateTimeFormat('en', { timeZone: s }); return { tz: s, label: s }; } catch { return null; }
}
const hhmm = d => pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
function localStr(date, tz) { const off = Calc.tzOffsetMin(tz, date); const l = new Date(date.getTime() + off * 60e3); return `${hhmm(l)} ngày ${pad(l.getUTCDate())}/${pad(l.getUTCMonth() + 1)} (${Calc.fmtOffset(off)})`; }
function calcTime() {
  const $v = id => document.getElementById(id);
  const tot = Calc.sumHM(TS.rows); $v('hm-total').textContent = Calc.fmtHM(tot); $v('hm-dec').textContent = nf(Calc.minToDec(tot, 2), 2) + ' giờ';
  const tzR = tzOf($v('tz-apt').value); TS.tz = $v('tz-apt').value; saveT();
  const dt = $v('tz-date').value, ut = Calc.parseHM($v('tz-time').value), lt = Calc.parseHM($v('tz-loc').value);
  if (!tzR) $v('tz-out').textContent = 'Không nhận ra sân bay/múi giờ';
  else if (isFinite(lt) && document.activeElement === $v('tz-loc')) { // địa phương → UTC
    const base = new Date(dt + 'T00:00:00Z'); let guess = new Date(base.getTime() + lt * 60e3); const off = Calc.tzOffsetMin(tzR.tz, guess); guess = new Date(guess.getTime() - off * 60e3);
    $v('tz-out').innerHTML = `${hhmm(guess)}Z ngày ${pad(guess.getUTCDate())}/${pad(guess.getUTCMonth() + 1)} <small>(${esc(tzR.label)}, ${Calc.fmtOffset(off)})</small>`;
  } else if (isFinite(ut) && dt) { const d = new Date(new Date(dt + 'T00:00:00Z').getTime() + ut * 60e3); $v('tz-out').innerHTML = `${localStr(d, tzR.tz)} <small>${esc(tzR.label)}</small>`; }
  const dep = Calc.parseHM($v('eta-dep').value), dist = num($v('eta-dist').value), gs = num($v('eta-gs').value);
  let ete = Calc.parseHM($v('eta-ete').value); if (isFinite(dist) && isFinite(gs) && gs > 0) ete = Math.round(Calc.flightTimeMin(dist, gs));
  $v('eta-ete-out').textContent = isFinite(ete) ? Calc.fmtHM(ete) + ` (${nf(Calc.minToDec(ete), 2)} giờ)` : '—';
  if (isFinite(dep) && isFinite(ete)) {
    const today = new Date(); const d0 = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()); const eta = new Date(d0 + (dep + ete) * 60e3);
    const tz2 = tzOf($v('eta-apt').value); const days = Math.floor((dep + ete) / 1440);
    $v('eta-out').innerHTML = `${Calc.fmtHM(dep + ete, { wrap: true, pad: true })}Z${days > 0 ? ` <small>(+${days} ngày)</small>` : ''}${tz2 ? `<br><small>Giờ địa phương ${esc(tz2.label)}: ${localStr(eta, tz2.tz)}</small>` : ''}`;
  } else $v('eta-out').textContent = '—';
}
document.getElementById('tools-body').addEventListener('click', e => {
  const t = e.target;
  if (t.dataset.op != null) { const r = TS.rows[+t.dataset.op]; r.op = r.op === '-' ? '+' : '-'; saveT(); renderTools(); }
  else if (t.dataset.del != null) { TS.rows.splice(+t.dataset.del, 1); if (!TS.rows.length) TS.rows.push({ op: '+', v: '' }); saveT(); renderTools(); }
  else if (t.id === 'hm-add') { TS.rows.push({ op: '+', v: '' }); saveT(); renderTools(); setTimeout(() => { const i = document.querySelectorAll('.hm'); i[i.length - 1]?.focus(); }, 30); }
  else if (t.id === 'hm-clear') { TS.rows = [{ op: '+', v: '' }]; saveT(); renderTools(); }
});
document.getElementById('tools-body').addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.v != null) { TS.rows[+t.dataset.v].v = t.value; saveT(); }
  if (t.id === 'cv-hm') { const m = Calc.parseHM(t.value); document.getElementById('cv-dec').value = isFinite(m) ? String(Calc.minToDec(m, 2)).replace('.', ',') : ''; }
  if (t.id === 'cv-dec') { const h = num(t.value); document.getElementById('cv-hm').value = isFinite(h) ? Calc.fmtHM(Calc.decToMin(h)) : ''; }
  if (t.classList.contains('uin')) unitFrom(t);
});
/* ---- Quy đổi đơn vị ---- */
const UNITS = [['len', 'Độ cao / chiều dài', [['ft', 'ft'], ['m', 'm']]], ['spd', 'Tốc độ', [['kt', 'kt'], ['kmh', 'km/h'], ['mph', 'mph'], ['ms', 'm/s']]], ['dist', 'Quãng đường', [['NM', 'NM'], ['km', 'km'], ['SM', 'SM']]],
  ['press', 'Áp suất', [['hPa', 'hPa'], ['inHg', 'inHg'], ['mmHg', 'mmHg']]], ['temp', 'Nhiệt độ', [['C', '°C'], ['F', '°F'], ['K', 'K']]], ['mass', 'Khối lượng', [['kg', 'kg'], ['lb', 'lb']]], ['vol', 'Thể tích', [['L', 'lít'], ['USgal', 'US gal'], ['IMPgal', 'Imp gal']]]];
function unitHtml() {
  return UNITS.map(([k, name, us]) => card(name, `<div class="tgrid">${us.map(([u, l]) => `<label class="tf"><span>${l}</span><input class="tinput uin" data-k="${k}" data-u="${u}" inputmode="decimal" autocomplete="off"></label>`).join('')}</div>`)).join('') +
    card('Nhiên liệu theo tỷ trọng', `<div class="tgrid">${field('fu-q', 'Lượng', '1000')}<label class="tf"><span>Đơn vị</span><select id="fu-u" class="tinput"><option value="L">lít</option><option value="USgal">US gal</option><option value="kg">kg</option><option value="lb">lb</option></select></label>
      <label class="tf"><span>Loại nhiên liệu</span><select id="fu-t" class="tinput"><option value="jeta1">Jet A-1 (0,800 kg/L)</option><option value="avgas">Avgas 100LL (0,720 kg/L)</option><option value="custom">Tự nhập tỷ trọng</option></select></label>${field('fu-d', 'Tỷ trọng (kg/L)', '0.800')}</div>
      ${out('fu-L', 'Lít')}${out('fu-G', 'US gal')}${out('fu-kg', 'kg')}${out('fu-lb', 'lb')}`, 'Tỷ trọng điển hình ở 15 °C: Jet A-1 0,775–0,840 kg/L; Avgas ~0,72 kg/L. Dùng tỷ trọng thực tế trên phiếu nạp nhiên liệu.');
}
function unitFrom(inp) {
  const k = inp.dataset.k, v = num(inp.value);
  document.querySelectorAll(`.uin[data-k="${k}"]`).forEach(o => { if (o === inp) return; o.value = isFinite(v) ? +Calc.convert(k, v, inp.dataset.u, o.dataset.u).toFixed(k === 'press' && o.dataset.u !== 'hPa' ? 3 : 2) : ''; });
}
function calcFuel() {
  const $v = id => document.getElementById(id); const t = $v('fu-t').value;
  if (t !== 'custom' && document.activeElement === $v('fu-t')) $v('fu-d').value = Calc.DENSITY[t].kgL.toFixed(3);
  const f = Calc.fuel(num($v('fu-q').value), $v('fu-u').value, num($v('fu-d').value));
  ['L', 'G', 'kg', 'lb'].forEach((k, i) => $v('fu-' + k).textContent = f && isFinite(f.L) ? nf([f.L, f.USgal, f.kg, f.lb][i], 1) : '—');
}
/* ---- Hiệu năng ---- */
function perfHtml() {
  const a = aptInfo(favs[0] || 'VVTS'), m = cache.metar[favs[0] || 'VVTS'], p = m ? parseReport(m.rawOb) : {};
  const src = m ? `Giá trị mặc định lấy từ ${metarTag(m)} và cao độ sân bay ${a.icao}.` : '';
  return card('Cao độ áp suất & mật độ', `<div class="tgrid">${field('pa-elev', 'Cao độ sân bay / độ cao (ft)', a.elev ?? 0)}${field('pa-qnh', 'QNH (hPa, hoặc inHg nếu < 40)', p.qnh != null ? Math.round(p.qnh) : 1013)}${field('pa-oat', 'Nhiệt độ ngoài OAT (°C)', p.temp ?? 15)}</div>
      ${out('pa-out', 'Cao độ áp suất')}${out('pa-isa', 'Nhiệt độ ISA / chênh lệch')}${out('da-out', 'Cao độ mật độ')}`, 'PA = cao độ + 145 366,45 × (1 − (QNH/1013,25)^0,190284). DA tính từ mật độ không khí khô theo ISA; kèm quy tắc nhanh 118,8 ft/°C. ' + src) +
    card('TAS ⇄ IAS/CAS (ISA, có tính nén)', `<div class="tgrid">${field('ts-ias', 'IAS/CAS (kt)', '250')}${field('ts-pa', 'Cao độ áp suất (ft)', '10000')}${field('ts-oat', 'OAT (°C, để trống = ISA)', '')}${field('ts-tas', 'hoặc TAS (kt) → CAS', '')}</div>${out('ts-out', 'Kết quả')}`, 'Coi IAS ≈ CAS (bỏ qua sai số đồng hồ/vị trí). Công thức khí động học nén được, tầng đối lưu (< 36 089 ft).') +
    card('Gió thành phần', `<div class="tgrid">${field('wc-dir', 'Hướng gió (°)', p.wind?.dir ?? '')}${field('wc-spd', 'Tốc độ gió (kt)', p.wind?.spd != null ? Math.round(p.wind.spd) : '')}${field('wc-gst', 'Gió giật (kt, tuỳ chọn)', p.wind?.gust ? Math.round(p.wind.gust) : '')}${field('wc-rwy', 'Đường băng (số hoặc hướng °)', '25')}</div>${out('wc-out', 'Gió ngược/xuôi')}${out('wc-x', 'Gió ngang')}`, 'Nhập số đường băng (vd 25 = 250°) hoặc hướng đường băng chính xác (vd 254). Hướng gió METAR là hướng thật.') +
    card('Tốc độ hạ theo góc', `<div class="tgrid">${field('dr-gs', 'Ground speed (kt)', '140')}${field('dr-ang', 'Góc hạ (°)', '3')}${field('dr-h', 'Độ cao cần hạ (ft, tuỳ chọn)', '')}</div>${out('dr-out', 'Tốc độ hạ')}${out('dr-grad', 'Độ dốc')}${out('dr-dist', 'Quãng đường bắt đầu hạ')}`, 'ROD (ft/phút) = GS × 6 076,12 × tan(góc) ÷ 60. Góc 3° ≈ 318 ft/NM ≈ 5,3 × GS.');
}
function rwyHdg(s) { const v = num(s); if (!isFinite(v)) return NaN; return v <= 36 && !/\d{3}/.test(String(s)) ? (v % 36 || 36) * 10 : v; }
function calcPerf() {
  const $v = id => document.getElementById(id), g = id => num($v(id).value);
  let q = g('pa-qnh'); if (q < 40) q = Calc.convert('press', q, 'inHg', 'hPa');
  const pa = Calc.pressureAltitude(g('pa-elev'), q), oat = g('pa-oat'), isa = Calc.isaTempC(pa);
  $v('pa-out').textContent = isFinite(pa) ? nf(pa) + ' ft' : '—';
  $v('pa-isa').textContent = isFinite(pa) ? `${nf(isa, 1)} °C · ISA${oat - isa >= 0 ? '+' : ''}${nf(oat - isa, 1)}` : '—';
  $v('da-out').innerHTML = isFinite(pa) && isFinite(oat) ? `${nf(Calc.densityAltitude(pa, oat))} ft <small>(quy tắc nhanh ${nf(Calc.densityAltitudeRule(pa, oat))} ft)</small>` : '—';
  const pa2 = g('ts-pa'), o2 = $v('ts-oat').value.trim() === '' ? null : g('ts-oat');
  if (isFinite(g('ts-tas')) && document.activeElement === $v('ts-tas') || (isFinite(g('ts-tas')) && !isFinite(g('ts-ias')))) { const r = Calc.tasToCas(g('ts-tas'), pa2, o2); $v('ts-out').innerHTML = `CAS ${nf(r.cas)} kt · Mach ${nf(r.mach, 3)}`; }
  else if (isFinite(g('ts-ias')) && isFinite(pa2)) { const r = Calc.casToTas(g('ts-ias'), pa2, o2); $v('ts-out').innerHTML = `TAS ${nf(r.tas)} kt <small>(${nf(r.tas * 1.852)} km/h)</small> · Mach ${nf(r.mach, 3)}${o2 == null ? ' <small>(OAT ISA ' + nf(Calc.isaTempC(pa2), 1) + ' °C)</small>' : ''}`; }
  else $v('ts-out').textContent = '—';
  const h = rwyHdg($v('wc-rwy').value), d = g('wc-dir'), s = g('wc-spd'), gs = g('wc-gst');
  if (isFinite(h) && isFinite(d) && isFinite(s)) {
    const c = Calc.windComponents(d, s, h), cg = isFinite(gs) ? Calc.windComponents(d, gs, h) : null;
    $v('wc-out').innerHTML = `${c.head >= 0 ? 'Gió ngược' : 'Gió xuôi'} ${nf(Math.abs(c.head), 1)} kt${cg ? ` <small>(giật: ${nf(Math.abs(cg.head), 1)} kt)</small>` : ''} <small>· đường băng ${nf(h)}°</small>`;
    $v('wc-x').innerHTML = `${nf(Math.abs(c.cross), 1)} kt ${c.cross > 0 ? 'từ phải' : c.cross < 0 ? 'từ trái' : ''}${cg ? ` <small>(giật: ${nf(Math.abs(cg.cross), 1)} kt)</small>` : ''}`;
  } else { $v('wc-out').textContent = '—'; $v('wc-x').textContent = '—'; }
  const dgs = g('dr-gs'), ang = g('dr-ang'), dh = g('dr-h');
  $v('dr-out').innerHTML = isFinite(dgs) && isFinite(ang) ? `${nf(Calc.descentRate(dgs, ang))} ft/phút <small>(${nf(Calc.descentRate(dgs, ang) * 0.3048 / 60, 1)} m/s)</small>` : '—';
  $v('dr-grad').innerHTML = isFinite(ang) ? `${nf(Calc.descentGradient(ang))} ft/NM <small>(${nf(Math.tan(ang * Math.PI / 180) * 100, 2)} %)</small>` : '—';
  $v('dr-dist').textContent = isFinite(dh) && isFinite(ang) ? nf(dh / Calc.descentGradient(ang), 1) + ' NM' + (isFinite(dgs) ? ` · ${nf(dh / Calc.descentRate(dgs, ang), 1)} phút` : '') : '—';
}
function calcAll() { try { if (TS.t === 'time') calcTime(); else if (TS.t === 'unit') calcFuel(); else calcPerf(); } catch (e) { console.error(e); } }

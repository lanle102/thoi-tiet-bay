/* Thời Tiết Bay – công thức tính toán thuần (dùng chung cho app và kiểm thử Node). Chạy offline. */
(function (root, factory) { const C = factory(); if (typeof module === 'object' && module.exports) module.exports = C; else root.Calc = C; })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const FT = 0.3048, NM = 1852, SM = 1609.344, LB = 0.45359237, USGAL = 3.785411784, INHG = 33.8638866667; // hPa trên 1 inHg
  const P0 = 1013.25, T0 = 288.15, A0 = 661.4786; // hPa, K, kt (tốc độ âm thanh mực biển ISA)
  /* ---- Giờ phút ---- */
  // Nhận "1:30", "-0:45", "130"/"0130" (HHMM), "1.5" / "1,5" (giờ thập phân), "2" (giờ). Trả về phút (số) hoặc NaN.
  function parseHM(s) {
    s = String(s ?? '').trim().replace(/\s+/g, ''); if (!s) return NaN;
    let sign = 1; if (/^[+-]/.test(s)) { if (s[0] === '-') sign = -1; s = s.slice(1); }
    let m;
    if ((m = /^(\d+):(\d{1,2})$/.exec(s))) { if (+m[2] >= 60) return NaN; return sign * (+m[1] * 60 + +m[2]); }
    if ((m = /^(\d+)h(\d{1,2})?m?$/i.exec(s))) return sign * (+m[1] * 60 + +(m[2] || 0));
    if (/^\d+[.,]\d+$/.test(s)) return sign * Math.round(parseFloat(s.replace(',', '.')) * 60 * 1e6) / 1e6;
    if (/^\d{3,4}$/.test(s)) { const h = +s.slice(0, -2), mm = +s.slice(-2); if (mm >= 60) return NaN; return sign * (h * 60 + mm); }
    if (/^\d{1,2}$/.test(s)) return sign * +s * 60;
    return NaN;
  }
  function fmtHM(min, opt = {}) {
    if (!isFinite(min)) return '—';
    const neg = min < 0; let t = Math.round(Math.abs(min));
    if (opt.wrap) { t = ((Math.round(min) % 1440) + 1440) % 1440; }
    const h = Math.floor(t / 60), m = t % 60;
    return (neg && !opt.wrap ? '−' : '') + (opt.pad ? String(h).padStart(2, '0') : h) + ':' + String(m).padStart(2, '0');
  }
  const minToDec = (min, d = 2) => +(min / 60).toFixed(d);
  const decToMin = h => Math.round(h * 60);
  // Cộng/trừ dồn: items = [{op:'+'|'-', v:'1:30'}]
  function sumHM(items) { let t = 0; for (const it of items) { const v = parseHM(it.v); if (!isFinite(v)) continue; t += (it.op === '-' ? -1 : 1) * v; } return t; }
  // Độ lệch múi giờ (phút) của tz tại thời điểm d
  function tzOffsetMin(tz, d) {
    const P = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d).map(x => [x.type, x.value]));
    const asUTC = Date.UTC(+P.year, +P.month - 1, +P.day, +P.hour % 24, +P.minute, +P.second);
    return Math.round((asUTC - Math.floor(d.getTime() / 1000) * 1000) / 60000);
  }
  function fmtOffset(min) { const s = min < 0 ? '−' : '+'; const a = Math.abs(min); return 'UTC' + s + Math.floor(a / 60) + (a % 60 ? ':' + String(a % 60).padStart(2, '0') : ''); }
  // ETA: thời gian bay (phút) từ quãng đường (NM) và ground speed (kt)
  const flightTimeMin = (distNm, gsKt) => gsKt > 0 ? distNm / gsKt * 60 : NaN;
  /* ---- Đơn vị ---- */
  const conv = {
    len: { ft: FT, m: 1 }, spd: { kt: NM / 3600, kmh: 1000 / 3600, mph: SM / 3600, ms: 1 }, dist: { NM: NM, km: 1000, SM: SM },
    press: { hPa: 1, inHg: INHG, mmHg: 1.33322387415 }, mass: { kg: 1, lb: LB }, vol: { L: 1, USgal: USGAL, IMPgal: 4.54609 }
  };
  function convert(kind, v, from, to) {
    if (kind === 'temp') { const c = from === 'C' ? v : from === 'F' ? (v - 32) * 5 / 9 : v - 273.15; return to === 'C' ? c : to === 'F' ? c * 9 / 5 + 32 : c + 273.15; }
    const t = conv[kind]; return v * t[from] / t[to];
  }
  const DENSITY = { jeta1: { name: 'Jet A-1', kgL: 0.8, range: '0,775–0,840 kg/L ở 15 °C' }, avgas: { name: 'Avgas 100LL', kgL: 0.72, range: '~0,72 kg/L ở 15 °C' } };
  function fuel(qty, unit, kgL) { // trả về {L, USgal, kg, lb}
    let L;
    if (unit === 'L') L = qty; else if (unit === 'USgal') L = qty * USGAL; else if (unit === 'kg') L = qty / kgL; else if (unit === 'lb') L = qty * LB / kgL; else return null;
    const kg = L * kgL; return { L, USgal: L / USGAL, kg, lb: kg / LB };
  }
  /* ---- Khí quyển chuẩn ISA & hiệu năng ---- */
  const isaTempC = paFt => 15 - 0.0019812 * paFt; // tầng đối lưu
  const pressRatio = paFt => Math.pow(1 - 6.8755856e-6 * paFt, 5.2558797);
  function pressureAltitude(elevFt, qnhHpa) { return elevFt + 145366.45 * (1 - Math.pow(qnhHpa / P0, 0.190284)); }
  function densityAltitude(paFt, oatC) {
    const sigma = pressRatio(paFt) * T0 / (oatC + 273.15);
    return (1 - Math.pow(sigma, 0.2349690)) / 6.8755856e-6;
  }
  const densityAltitudeRule = (paFt, oatC) => paFt + 118.8 * (oatC - isaTempC(paFt));
  // CAS → TAS (có tính nén), nhiệt độ ngoài thực tế oatC (mặc định ISA)
  function casToTas(casKt, paFt, oatC) {
    if (oatC == null || isNaN(oatC)) oatC = isaTempC(paFt);
    const qc = P0 * (Math.pow(1 + 0.2 * Math.pow(casKt / A0, 2), 3.5) - 1);
    const p = P0 * pressRatio(paFt);
    const mach = Math.sqrt(5 * (Math.pow(qc / p + 1, 2 / 7) - 1));
    return { tas: mach * A0 * Math.sqrt((oatC + 273.15) / T0), mach };
  }
  function tasToCas(tasKt, paFt, oatC) {
    if (oatC == null || isNaN(oatC)) oatC = isaTempC(paFt);
    const a = A0 * Math.sqrt((oatC + 273.15) / T0), mach = tasKt / a, p = P0 * pressRatio(paFt);
    const qc = p * (Math.pow(1 + 0.2 * mach * mach, 3.5) - 1);
    return { cas: A0 * Math.sqrt(5 * (Math.pow(qc / P0 + 1, 2 / 7) - 1)), mach };
  }
  // Gió thành phần: dương = gió ngược (headwind) / gió ngang từ phải
  function windComponents(windDir, windSpd, rwyHdg) {
    const d = ((windDir - rwyHdg + 540) % 360) - 180, r = d * Math.PI / 180;
    return { head: windSpd * Math.cos(r), cross: windSpd * Math.sin(r), angle: d };
  }
  // Tốc độ hạ (ft/phút) cho góc hạ (độ) và ground speed (kt); độ dốc ft/NM
  const descentGradient = deg => NM / FT * Math.tan(deg * Math.PI / 180);
  const descentRate = (gsKt, deg) => gsKt * descentGradient(deg) / 60;
  return { parseHM, fmtHM, minToDec, decToMin, sumHM, tzOffsetMin, fmtOffset, flightTimeMin, convert, DENSITY, fuel, isaTempC, pressRatio,
    pressureAltitude, densityAltitude, densityAltitudeRule, casToTas, tasToCas, windComponents, descentGradient, descentRate, K: { FT, NM, SM, LB, USGAL, INHG } };
});

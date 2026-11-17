'use strict';
/* Nhận số đăng ký tàu bay: VNA651 → VN-A651, 9VNCM → 9V-NCM, N353LD giữ nguyên.
   Tiền tố quốc gia (ICAO), dài hơn được xét trước. N, JA, HL không dùng gạch. */
const REG_PREFIXES = [
  'RDPL', 'A9C', 'A4O',
  '3A', '3B', '3C', '3D',
  '4K', '4L', '4O', '4R', '4W', '4X',
  '5A', '5B', '5H', '5N', '5R', '5T', '5U', '5V', '5W', '5X', '5Y',
  '6O', '6V', '6W', '6Y',
  '7O', '7P', '7Q', '7T',
  '8P', '8Q', '8R',
  '9A', '9G', '9H', '9J', '9K', '9L', '9M', '9N', '9Q', '9U', '9V', '9X', '9Y',
  'A2', 'A3', 'A5', 'A6', 'A7',
  'AP',
  'C2', 'C3', 'C5', 'C6', 'C9', 'CC', 'CN', 'CP', 'CS', 'CX',
  'D2', 'D4', 'D6', 'DQ',
  'E3', 'E5', 'E7', 'EC', 'EI', 'EK', 'EP', 'ES', 'ET', 'EW', 'EY',
  'H4', 'HA', 'HB', 'HC', 'HH', 'HI', 'HK', 'HP', 'HR', 'HS', 'HZ',
  'J2', 'J3', 'J5', 'J6', 'J7', 'J8', 'JU', 'JY',
  'LN', 'LV', 'LX', 'LY', 'LZ',
  'OB', 'OD', 'OE', 'OH', 'OK', 'OM', 'OO', 'OY',
  'P2', 'P4', 'PH', 'PJ', 'PK', 'PP', 'PR', 'PS', 'PT', 'PU', 'PZ',
  'RA', 'RC', 'RF', 'RP',
  'S2', 'S5', 'S7', 'S9', 'SE', 'SP', 'ST', 'SU', 'SX',
  'T7', 'T8', 'TC', 'TF', 'TG', 'TI', 'TJ', 'TL', 'TN', 'TR', 'TS', 'TT', 'TU', 'TY', 'TZ',
  'UK', 'UN', 'UP', 'UR',
  'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'VH', 'VN', 'VP', 'VQ', 'VT',
  'XA', 'XB', 'XC', 'XT', 'XU', 'XY', 'XZ',
  'YA', 'YI', 'YJ', 'YK', 'YL', 'YN', 'YR', 'YS', 'YU', 'YV',
  'Z2', 'Z3', 'Z8', 'ZK', 'ZP', 'ZS', 'ZT', 'ZU',
  'B', 'C', 'D', 'F', 'G', 'I', 'M', 'Z'
].slice().sort((a, b) => b.length - a.length || a.localeCompare(b));

function normalizeReg(q) {
  return String(q || '').toUpperCase()
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\s.]+/g, '');
}

function expandReg(q) {
  q = normalizeReg(q);
  if (!q) return null;
  if (q.includes('-')) return /^[A-Z0-9]{1,4}-[A-Z0-9]{2,5}$/.test(q) ? q : null;
  if (/^N\d{1,5}[A-Z]{0,2}$/.test(q) && q.length >= 2 && q.length <= 7) return q;
  if (/^JA(\d{4}|\d{3}[A-Z]|\d{2}[A-Z]{2})$/.test(q)) return q;
  if (/^HL\d{4}$/.test(q)) return q;
  for (const p of REG_PREFIXES) {
    if (!q.startsWith(p) || q.length <= p.length) continue;
    const rest = q.slice(p.length);
    if (!/^[A-Z0-9]{2,5}$/.test(rest)) continue;
    // VN220, BA15: số hiệu chuyến, không phải VN-220
    if (p.length === 2 && /^\d{1,4}[A-Z]?$/.test(rest)) continue;
    if (p.length === 1) {
      if (p === 'B') {
        if (!/^(\d{4,5}|[0-9][0-9A-Z]{3}|[HLK][A-Z]{2})$/.test(rest)) continue; // B-1893, B-222Y, B-Hxx
      } else if (p === 'C') {
        if (!/^[FGI][A-Z]{3}$/.test(rest)) continue;
      } else if (!/^[A-Z]{3,4}$/.test(rest)) continue;
    }
    // HVN651, TGW427, CCA123, LNI971 trông như callsign ICAO; chỉ tách khi đúng dạng số đăng ký (VN-A651, RP-C1234).
    if (/^[A-Z]{3}\d/.test(p + rest)) {
      const ok = (p === 'VN' && /^[A-Z]\d{3,4}$/.test(rest)) || (p === 'RP' && /^[A-Z]\d{3,5}$/.test(rest));
      if (!ok) continue;
    }
    return p + '-' + rest;
  }
  return null;
}

function guessBy(q) {
  q = normalizeReg(q);
  const reg = expandReg(q);
  if (/^[0-9A-F]{6}$/.test(q) && /\d/.test(q) && !reg && !/^[A-Z]{3}\d/.test(q)) return 'hex';
  if (reg) return 'reg';
  if (/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(q) && !/^[A-Z]{3}\d/.test(q)) return 'flight';
  return 'callsign';
}

if (typeof module === 'object' && module.exports) module.exports = { REG_PREFIXES, normalizeReg, expandReg, guessBy };
else if (typeof window !== 'undefined') {
  window.normalizeReg = normalizeReg;
  window.expandReg = expandReg;
  window.guessBy = guessBy;
}

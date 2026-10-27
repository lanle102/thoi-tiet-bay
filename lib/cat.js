// Tính hạng bay phía máy chủ (giống app).
function parse(raw) {
  const r = { clouds: [] }; if (!raw) return r;
  let body = raw.split(/\s(?:RMK|NOSIG|BECMG|TEMPO)\b/)[0];
  for (const x of body.split(/\s+/)) {
    let m;
    if (x === 'CAVOK') r.vis = 9999;
    else if ((m = /^(\d{4})(NDV)?$/.exec(x)) && r.vis == null) r.vis = +m[1];
    else if ((m = /^(P?)(\d+)SM$/.exec(x))) r.vis = +m[2] * 1609.34 + (m[1] ? 1 : 0);
    else if ((m = /^(FEW|SCT|BKN|OVC)(\d{3})/.exec(x))) r.clouds.push({ cover: m[1], base: +m[2] * 100 });
    else if ((m = /^VV(\d{3})$/.exec(x))) r.clouds.push({ cover: 'VV', base: +m[1] * 100 });
  }
  return r;
}
function cat(m, std) {
  std = std || 'faa';
  if (!m) return 'UNK';
  if (std === 'faa' && m.fltCat) return m.fltCat;
  const p = parse(m.rawOb), v = p.vis ?? 9999;
  let ceil = null, low = null;
  for (const c of p.clouds) { if (['BKN', 'OVC', 'VV'].includes(c.cover)) ceil = ceil == null ? c.base : Math.min(ceil, c.base); if (c.cover !== 'FEW') low = low == null ? c.base : Math.min(low, c.base); }
  if (std === 'icao') return v >= 5000 && (ceil == null || ceil >= 1500) ? 'VMC' : 'IMC';
  if (std === 'nato') { const b = low ?? 99999; if (v >= 8000 && b >= 2500) return 'BLU'; if (v >= 5000 && b >= 1500) return 'WHT'; if (v >= 3700 && b >= 700) return 'GRN'; if (v >= 1600 && b >= 300) return 'YLO'; if (v >= 800 && b >= 200) return 'AMB'; return 'RED'; }
  const sm = v / 1609.34, c = ceil ?? 99999;
  if (sm < 1 || c < 500) return 'LIFR'; if (sm < 3 || c < 1000) return 'IFR'; if (sm <= 5 || c <= 3000) return 'MVFR'; return 'VFR';
}
module.exports = { cat };

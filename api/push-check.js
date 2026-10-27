// Được gọi định kỳ (GitHub Actions mỗi ~10 phút): kiểm tra METAR/TAF mới, gửi thông báo đẩy.
const webpush = require('web-push');
const { readJSON, writeJSON, listPaths, remove } = require('../lib/store');
const { cat } = require('../lib/cat');
async function awc(type, ids) {
  const r = await fetch(`https://aviationweather.gov/api/data/${type}?ids=${ids.join(',')}&format=json`, { headers: { 'User-Agent': 'ThoiTietBay/1.0' } });
  if (!r.ok) throw new Error(type + ' HTTP ' + r.status);
  const t = await r.text(); return t.trim() ? JSON.parse(t) : [];
}
module.exports = async function handler(req, res) {
  const k = req.headers['x-cron-key'] || (req.query || {}).key;
  if (!process.env.CRON_SECRET || k !== process.env.CRON_SECRET) return res.status(401).json({ error: 'unauthorized' });
  webpush.setVapidDetails('https://lanle102.github.io/thoi-tiet-bay/', process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);
  const paths = await listPaths('push/');
  const subs = [];
  for (const p of paths) { const s = await readJSON(p); if (s) subs.push([p, s]); }
  const ids = [...new Set(subs.flatMap(([, s]) => s.favs))];
  const metar = {}, taf = {};
  for (let i = 0; i < ids.length; i += 40) {
    const ch = ids.slice(i, i + 40);
    const [ms, ts] = await Promise.all([awc('metar', ch), awc('taf', ch)]);
    for (const m of ms) if (!metar[m.icaoId] || m.obsTime > metar[m.icaoId].obsTime) metar[m.icaoId] = m;
    for (const t of ts) if (!taf[t.icaoId] || t.issueTime > taf[t.icaoId].issueTime) taf[t.icaoId] = t;
  }
  let sent = 0, removed = 0;
  for (const [p, s] of subs) {
    const msgs = []; const st = s.state || {};
    for (const id of s.favs) {
      const m = metar[id], t = taf[id], old = st[id] || {};
      const c = m ? cat(m, s.std) : old.cat;
      const now = { cat: c, obs: m ? m.obsTime : old.obs, taf: t ? t.issueTime : old.taf };
      if (old.cat !== undefined) {
        if (c && old.cat && c !== old.cat) msgs.push(`${id}: ${old.cat} → ${c}  ${m ? m.rawOb.replace(/^(METAR|SPECI) /, '') : ''}`);
        else if (s.mode === 'all') {
          if (now.obs && now.obs !== old.obs) msgs.push(`${id} METAR mới (${c}): ${m.rawOb.replace(/^(METAR|SPECI) /, '')}`);
          if (now.taf && now.taf !== old.taf) msgs.push(`${id}: có TAF mới`);
        }
      }
      st[id] = now;
    }
    if (msgs.length) {
      try {
        await webpush.sendNotification(s.subscription, JSON.stringify({ title: msgs.length === 1 ? 'Thời Tiết Bay' : `Thời Tiết Bay – ${msgs.length} cập nhật`, body: msgs.slice(0, 6).join('\n'), id: s.favs.find(f => msgs.some(m => m.startsWith(f))) }), { TTL: 3600 });
        sent++;
      } catch (e) { if (e.statusCode === 404 || e.statusCode === 410) { await remove(p); removed++; continue; } }
    }
    s.state = st; s.checked = Date.now();
    await writeJSON(p, s);
  }
  res.status(200).json({ subs: subs.length, airports: ids.length, sent, removed });
};

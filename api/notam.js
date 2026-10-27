// NOTAM: lấy từ FAA NOTAM Search (notams.aim.faa.gov) – công khai, không cần khoá.
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const id = String((req.query || {}).id || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  if (id.length < 3) { res.status(400).json({ error: 'id không hợp lệ' }); return; }
  const body = new URLSearchParams({ searchType: '0', designatorsForLocation: id, notamsOnly: 'false', radius: '10', sortColumns: '5 false', sortDirection: 'true', offset: '0' });
  try {
    const all = []; let offset = 0, total = 0;
    for (let page = 0; page < 6; page++) {
      body.set('offset', String(offset));
      const r = await fetch('https://notams.aim.faa.gov/notamSearch/search', {
        method: 'POST', body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'User-Agent': 'Mozilla/5.0 (ThoiTietBay PWA)', 'Referer': 'https://notams.aim.faa.gov/notamSearch/nsapp.html', 'Accept': 'application/json, text/plain, */*' }
      });
      if (!r.ok) { res.status(200).json({ ok: false, error: 'FAA NOTAM Search trả về HTTP ' + r.status }); return; }
      const j = await r.json();
      total = j.totalNotamCount || 0;
      const list = j.notamList || [];
      all.push(...list.map(n => ({ id: n.notamNumber, loc: n.facilityDesignator || n.icaoId, start: n.startDate, end: n.endDate, issued: n.issueDate,
        text: n.icaoMessage && n.icaoMessage.trim() ? n.icaoMessage : n.traditionalMessage, keyword: n.keyword, cancelled: n.cancelledOrExpired })));
      offset += list.length;
      if (!list.length || offset >= total) break;
    }
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=1800');
    res.status(200).json({ source: 'FAA NOTAM Search', total, notams: all });
  } catch (e) { res.status(200).json({ ok: false, error: 'Không kết nối được FAA NOTAM Search' }); }
};

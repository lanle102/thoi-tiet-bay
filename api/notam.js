// NOTAM: 1) FAA NOTAM API chính thức (external-api.faa.gov, cần FAA_NOTAM_CLIENT_ID + FAA_NOTAM_CLIENT_SECRET đăng ký tại api.faa.gov);
//        2) FAA NOTAM Search công khai (thường bị chặn 403 từ máy chủ đám mây). Không bao giờ tạo NOTAM giả.
async function faaApi(id) {
  const out = []; let page = 1, total = 0;
  do {
    const r = await fetch(`https://external-api.faa.gov/notamapi/v1/notams?icaoLocation=${id}&pageSize=200&pageNum=${page}`, {
      headers: { client_id: process.env.FAA_NOTAM_CLIENT_ID, client_secret: process.env.FAA_NOTAM_CLIENT_SECRET, Accept: 'application/json' } });
    if (!r.ok) throw new Error('FAA NOTAM API trả về HTTP ' + r.status);
    const j = await r.json(); total = j.totalCount || 0;
    for (const it of j.items || []) {
      const n = it.properties?.coreNOTAMData?.notam || {};
      const tr = (it.properties?.coreNOTAMData?.notamTranslation || []).find(x => x.type === 'ICAO') || {};
      out.push({ id: n.number, loc: n.icaoLocation || n.location, start: n.effectiveStart, end: n.effectiveEnd, issued: n.issued, text: tr.formattedText || n.text, keyword: n.classification });
    }
    page++;
  } while (out.length < total && page <= 5);
  return { source: 'FAA NOTAM API (api.faa.gov)', total, notams: out };
}
async function faaSearch(id) {
  const body = new URLSearchParams({ searchType: '0', designatorsForLocation: id, notamsOnly: 'false', radius: '10', sortColumns: '5 false', sortDirection: 'true', offset: '0' });
  const r = await fetch('https://notams.aim.faa.gov/notamSearch/search', { method: 'POST', body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'User-Agent': 'Mozilla/5.0 (ThoiTietBay PWA)', 'Referer': 'https://notams.aim.faa.gov/notamSearch/nsapp.html', 'Accept': 'application/json, text/plain, */*' } });
  if (!r.ok) throw new Error('FAA NOTAM Search trả về HTTP ' + r.status);
  const j = await r.json();
  return { source: 'FAA NOTAM Search', total: j.totalNotamCount || 0, notams: (j.notamList || []).map(n => ({ id: n.notamNumber, loc: n.facilityDesignator || n.icaoId, start: n.startDate, end: n.endDate, issued: n.issueDate,
    text: n.icaoMessage && n.icaoMessage.trim() ? n.icaoMessage : n.traditionalMessage, keyword: n.keyword })) };
}
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const id = String((req.query || {}).id || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  if (id.length < 3) { res.status(400).json({ error: 'id không hợp lệ' }); return; }
  const errors = [];
  const hasKey = !!(process.env.FAA_NOTAM_CLIENT_ID && process.env.FAA_NOTAM_CLIENT_SECRET);
  if (hasKey) { try { const d = await faaApi(id); res.setHeader('Cache-Control', 'public, s-maxage=900'); return res.status(200).json(d); } catch (e) { errors.push(e.message); } }
  else errors.push('Chưa cấu hình khoá FAA NOTAM API (FAA_NOTAM_CLIENT_ID / FAA_NOTAM_CLIENT_SECRET)');
  try { const d = await faaSearch(id); res.setHeader('Cache-Control', 'public, s-maxage=900'); return res.status(200).json(d); } catch (e) { errors.push(e.message); }
  res.setHeader('Cache-Control', 'public, s-maxage=300');
  res.status(200).json({ ok: false, configured: hasKey, error: errors.join('; ') });
};

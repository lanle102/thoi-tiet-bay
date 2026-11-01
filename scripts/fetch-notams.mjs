// Lấy NOTAM công khai từ FAA NOTAM Search (notams.aim.faa.gov) cho danh sách sân bay, ghi JSON tĩnh vào notams/.
// Chạy bằng GitHub Actions. Nếu FAA chặn (HTTP 403) thì không ghi gì và báo lỗi – app sẽ hiện "không có NOTAM" + link chính thức.
import fs from 'node:fs';
const IDS = (process.env.NOTAM_IDS || 'VVTS,VVNB,VVDN,VVCR,VVPQ,VVCI,VVPB,VVCT,VVDL,VVBM,VVVH,VVTH,VVPC,VVCS,VVDH,VVPK,VVRG,VVCA,VVTX,VVVD,VVDB,VVCM,VVVT,VVLT,RJTT,RJAA,RKSI,VHHH,VTBS,WSSS,RCTP,ZGGG,KJFK,KLAX').split(',');
fs.mkdirSync('notams', { recursive: true });
let ok = 0; const errs = [];
for (const id of IDS) {
  try {
    const body = new URLSearchParams({ searchType: '0', designatorsForLocation: id, notamsOnly: 'false', radius: '10', sortColumns: '5 false', sortDirection: 'true', offset: '0' });
    const r = await fetch('https://notams.aim.faa.gov/notamSearch/search', { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'User-Agent': 'Mozilla/5.0 (ThoiTietBay PWA; GitHub Actions)', 'Referer': 'https://notams.aim.faa.gov/notamSearch/nsapp.html', 'Accept': 'application/json, text/plain, */*' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const notams = (j.notamList || []).map(n => ({ id: n.notamNumber, loc: n.facilityDesignator || n.icaoId, start: n.startDate, end: n.endDate, issued: n.issueDate, text: n.icaoMessage && n.icaoMessage.trim() ? n.icaoMessage : n.traditionalMessage, keyword: n.keyword }));
    fs.writeFileSync(`notams/${id}.json`, JSON.stringify({ source: 'FAA NOTAM Search (bản lưu do GitHub Actions lấy)', fetched: new Date().toISOString(), total: j.totalNotamCount || notams.length, notams }));
    ok++;
  } catch (e) { errs.push(id + ': ' + e.message); }
  await new Promise(r => setTimeout(r, 1500));
}
console.log('NOTAM ok', ok, '/', IDS.length, errs.slice(0, 5).join('; '));
if (!ok) process.exitCode = 1;

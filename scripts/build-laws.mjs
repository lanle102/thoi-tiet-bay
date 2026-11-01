// Xây kho luật tĩnh cho tab «Luật» (chạy hằng ngày bằng GitHub Actions). Chỉ lấy tài liệu được phép phát hành miễn phí:
//  - eCFR Title 14 (Part 1, 61, 91, 121, 135) – api.ecfr.gov, văn bản Chính phủ Hoa Kỳ (public domain)
//  - FAA AIM – faa.gov, tài liệu Chính phủ Hoa Kỳ (public domain)
//  - Luật Hàng không dân dụng Việt Nam số 130/2025/QH15 – Công báo (congbao.chinhphu.vn); văn bản QPPL không thuộc đối tượng bảo hộ quyền tác giả (Điều 15 Luật SHTT)
// ICAO Annex/Doc và EASA Easy Access Rules: chỉ tên + link (xem LINKS_ONLY), không chép nội dung.
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
const OUT = path.resolve(process.argv[2] || 'laws'); const CH = path.join(OUT, 'c');
const UA = { 'User-Agent': 'ThoiTietBay-LawBuilder/1.0 (+https://github.com/lanle102/thoi-tiet-bay)', 'Accept-Encoding': 'gzip' };
const prev = fs.existsSync(path.join(OUT, 'index.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8')) : null;
const ent = s => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&sect;/g, '§');
const strip = s => ent(s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|h\d|tr|div|P|FP|HD\d?)>/g, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url, { headers: UA }); if (r.ok) return r; throw new Error('HTTP ' + r.status); }
    catch (e) { if (i === tries - 1) throw new Error(url + ': ' + e.message); await new Promise(r => setTimeout(r, 3000 * (i + 1))); }
  }
}
const sources = [], errors = [];
async function ecfr() {
  const t = await (await get('https://www.ecfr.gov/api/versioner/v1/titles.json')).json();
  const t14 = t.titles.find(x => x.number === 14); const date = t14.up_to_date_as_of;
  for (const part of ['1', '61', '91', '121', '135']) {
    try {
      const xml = await (await get(`https://www.ecfr.gov/api/versioner/v1/full/${date}/title-14.xml?part=${part}`)).text();
      const head = strip((/<HEAD>([\s\S]*?)<\/HEAD>/.exec(xml) || [])[1] || 'Part ' + part);
      const items = [];
      for (const m of xml.matchAll(/<DIV8 N="([^"]+)"[^>]*TYPE="SECTION"[^>]*>([\s\S]*?)<\/DIV8>/g)) {
        const title = strip((/<HEAD>([\s\S]*?)<\/HEAD>/.exec(m[2]) || [])[1] || '§ ' + m[1]);
        const body = strip(m[2].replace(/<HEAD>[\s\S]*?<\/HEAD>/, '').replace(/<CITA[\s\S]*?<\/CITA>/g, '').replace(/<EDNOTE[\s\S]*?<\/EDNOTE>/g, ''));
        if (/\[Reserved\]/i.test(title) && body.length < 30) continue;
        items.push({ id: `14 CFR ${m[1]}`, t: title.replace(/^§\s*/, '§ '), x: body, u: `https://www.ecfr.gov/current/title-14/section-${m[1]}` });
      }
      for (const m of xml.matchAll(/<DIV9 N="([^"]+)"[^>]*TYPE="APPENDIX"[^>]*>([\s\S]*?)<\/DIV9>/g)) {
        const title = strip((/<HEAD>([\s\S]*?)<\/HEAD>/.exec(m[2]) || [])[1] || m[1]);
        items.push({ id: `14 CFR Part ${part} ${title.split(/\s+[-—]/)[0]}`, t: title, x: strip(m[2].replace(/<HEAD>[\s\S]*?<\/HEAD>/, '')).slice(0, 60000), u: `https://www.ecfr.gov/current/title-14/part-${part}` });
      }
      sources.push({ id: 'cfr' + part, group: 'FAA', title: `14 CFR ${head.replace(/\s+/g, ' ')}`, lang: 'en', asOf: date, url: `https://www.ecfr.gov/current/title-14/part-${part}`,
        license: 'Văn bản Chính phủ Hoa Kỳ – phạm vi công cộng (public domain). Nguồn: eCFR (api.ecfr.gov). eCFR là bản tổng hợp chính thức nhưng không phải bản pháp lý chính thức; bản pháp lý là Federal Register/CFR in.', items });
      console.log('eCFR part', part, items.length);
    } catch (e) { errors.push('eCFR part ' + part + ': ' + e.message); }
  }
}
async function aim() {
  const base = 'https://www.faa.gov/air_traffic/publications/atpubs/aim_html/';
  const idx = await (await get(base)).text();
  const pages = [...new Set([...idx.matchAll(/href="\.\/(chap\d+_section_\d+\.html)"/g)].map(m => m[1]))].filter(p => !/chap0_/.test(p));
  const eff = ((/Effective[^<]{0,80}?(\w+ \d{1,2}, \d{4})/i.exec(idx) || [])[1]) || '';
  const items = [];
  for (const p of pages) {
    try {
      const h = await (await get(base + p)).text();
      const main = (/<main[\s\S]*?<\/main>/.exec(h) || [h])[0];
      const parts = main.split(/<h4 class="paragraph-title" id="([^"]+)">/);
      for (let i = 1; i < parts.length; i += 2) {
        const id = parts[i], seg = parts[i + 1]; const title = strip(seg.split('</h4>')[0]); const body = strip(seg.split('</h4>').slice(1).join(' '));
        items.push({ id: 'AIM ' + id, t: title, x: body.slice(0, 40000), u: base + p + '#' + id });
      }
    } catch (e) { errors.push('AIM ' + p + ': ' + e.message); }
  }
  if (items.length) sources.push({ id: 'aim', group: 'FAA', title: 'FAA Aeronautical Information Manual (AIM)' + (eff ? ' – hiệu lực ' + eff : ''), lang: 'en', asOf: new Date().toISOString().slice(0, 10), url: base,
    license: 'Tài liệu Chính phủ Hoa Kỳ (FAA) – phạm vi công cộng.', items });
  console.log('AIM', items.length);
}
async function vnLaw() {
  const page = await (await get('https://congbao.chinhphu.vn/van-ban/luat-so-130-2025-qh15-468690.htm')).text();
  const pdfUrl = (/href="(https:\/\/congbaocdn\.chinhphu\.vn\/[^"]+\.pdf)"/.exec(page) || [])[1];
  if (!pdfUrl) throw new Error('không thấy file PDF trên Công báo');
  const buf = Buffer.from(await (await get(pdfUrl)).arrayBuffer()); const tmp = path.join(OUT, '.vn.pdf'); fs.writeFileSync(tmp, buf);
  let txt = execFileSync('pdftotext', ['-enc', 'UTF-8', tmp, '-']).toString('utf8'); fs.unlinkSync(tmp);
  txt = txt.replace(/^\s*CÔNG BÁO\/Số[^\n]*$/gm, '').replace(/^\s*\d+\s*$/gm, '').replace(/^Ký bởi:[^\n]*$|^Cơ quan:[^\n]*$|^Ngày ký:[^\n]*$/gm, '').replace(/\f/g, '\n');
  const lines = txt.split('\n').map(s => s.trim()).filter(Boolean);
  const items = []; let cur = null, chap = '';
  for (const l of lines) {
    if (/^Chương [IVXLC]+$/.test(l)) { chap = l; continue; }
    const m = /^Điều (\d+)\.\s*(.*)$/.exec(l);
    if (m) { cur = { id: 'Luật HKDD VN 2025 – Điều ' + m[1], t: `Điều ${m[1]}. ${m[2]}`, x: '', u: 'https://congbao.chinhphu.vn/van-ban/luat-so-130-2025-qh15-468690.htm', ch: chap }; items.push(cur); continue; }
    if (cur) cur.x += (/^(\d+\.|[a-zđ]\))\s/.test(l) || /[.:;]$/.test(cur.x) ? '\n' : ' ') + l;
  }
  // tiêu đề Điều có thể xuống dòng: ghép phần chữ thường đầu thân vào tiêu đề nếu tiêu đề chưa kết thúc
  for (const it of items) { it.x = it.x.trim(); const mm = /^([^\n]*?)(?=\n|$)/.exec(it.x); if (mm && /^[a-zà-ỹđ]/.test(it.x) && mm[1].length < 120) { it.t += ' ' + mm[1]; it.x = it.x.slice(mm[1].length).trim(); } if (it.ch) { it.x = `(${it.ch}) ` + it.x; delete it.ch; } }
  sources.push({ id: 'vnlaw', group: 'Việt Nam', title: 'Luật Hàng không dân dụng Việt Nam số 130/2025/QH15 (hiệu lực 01/07/2026)', lang: 'vi', asOf: '2025-12-10', url: 'https://congbao.chinhphu.vn/van-ban/luat-so-130-2025-qh15-468690.htm',
    license: 'Văn bản quy phạm pháp luật – không thuộc đối tượng bảo hộ quyền tác giả (Điều 15 Luật Sở hữu trí tuệ). Nguồn: Công báo nước CHXHCN Việt Nam số 39, ngày 22/01/2026. Văn bản trích từ PDF, có thể lỗi ngắt dòng – đối chiếu bản gốc.', items });
  console.log('VN law', items.length);
}
const LINKS_ONLY = [
  { group: 'ICAO (bản quyền – chỉ tên + link)', items: [
    ['Annex 2 – Rules of the Air', 'https://store.icao.int/en/annexes/annex-2'], ['Annex 3 – Meteorological Service for International Air Navigation', 'https://store.icao.int/en/annexes/annex-3'],
    ['Annex 6 – Operation of Aircraft', 'https://store.icao.int/en/annexes/annex-6'], ['Annex 11 – Air Traffic Services', 'https://store.icao.int/en/annexes/annex-11'], ['Annex 1 – Personnel Licensing', 'https://store.icao.int/en/annexes/annex-1'],
    ['Doc 4444 – PANS-ATM', 'https://store.icao.int/en/procedures-for-air-navigation-services-air-traffic-management-doc-4444'], ['Doc 8168 – PANS-OPS', 'https://store.icao.int/en/search?q=8168'],
    ['ICAO – Tài liệu công khai miễn phí (eLibrary/Documents)', 'https://www.icao.int/publications/Pages/default.aspx']] },
  { group: 'EASA (chỉ trích dẫn + link – điều khoản EASA không cho phép tái phân phối nguyên văn trong app)', items: [
    ['Easy Access Rules for Air Operations (Reg. (EU) 965/2012)', 'https://www.easa.europa.eu/en/document-library/easy-access-rules/easy-access-rules-air-operations'],
    ['Easy Access Rules for Aircrew (Part-FCL, Reg. (EU) 1178/2011)', 'https://www.easa.europa.eu/en/document-library/easy-access-rules/easy-access-rules-aircrew-regulation-eu-no-11782011'],
    ['Easy Access Rules for Standardised European Rules of the Air (SERA)', 'https://www.easa.europa.eu/en/document-library/easy-access-rules/easy-access-rules-standardised-european-rules-air-sera'],
    ['Văn bản gốc trên EUR-Lex (miễn phí)', 'https://eur-lex.europa.eu/eli/reg/2012/965/oj']] },
  { group: 'Việt Nam – văn bản khác (link)', items: [
    ['Cục Hàng không Việt Nam – Văn bản pháp quy', 'https://caa.gov.vn/van-ban.htm'], ['AIP Việt Nam (VATM)', 'https://vnaic.vn/'], ['Cơ sở dữ liệu quốc gia về văn bản pháp luật', 'https://vbpl.vn/']] }
];
fs.mkdirSync(CH, { recursive: true });
for (const [name, fn] of [['eCFR', ecfr], ['AIM', aim], ['Luật VN', vnLaw]]) { try { await fn(); } catch (e) { errors.push(name + ': ' + e.message); console.error(name, e.message); } }
// Giữ lại nguồn cũ nếu lần này lỗi
if (prev) for (const s of prev.sources) if (!sources.some(x => x.id === s.id)) { s.stale = true; sources.push({ ...s, keep: true }); }
const index = { built: new Date().toISOString(), sources: [], linksOnly: LINKS_ONLY, errors };
const keepFiles = new Set();
for (const s of sources) {
  if (s.keep) { const { keep, ...meta } = s; index.sources.push(meta); meta.chunks.forEach(f => keepFiles.add(f)); continue; }
  const chunks = []; let buf = [], size = 0, n = 0;
  const flush = () => { if (!buf.length) return; const f = `c/${s.id}-${n++}.json`; fs.writeFileSync(path.join(OUT, f), JSON.stringify(buf)); chunks.push(f); keepFiles.add(f); buf = []; size = 0; };
  for (const it of s.items) { buf.push(it); size += it.x.length + it.t.length; if (size > 350000) flush(); }
  flush();
  const { items, ...meta } = s; index.sources.push({ ...meta, count: items.length, chunks });
}
for (const f of fs.readdirSync(CH)) if (!keepFiles.has('c/' + f)) fs.unlinkSync(path.join(CH, f));
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1));
console.log('Xong:', index.sources.map(s => `${s.id}=${s.count}`).join(' '), 'lỗi:', errors.length);

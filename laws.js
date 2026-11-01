'use strict';
/* Kho luật hàng không: JSON tĩnh (laws/index.json + laws/c/*.json, GitHub Actions cập nhật hằng ngày), tìm toàn văn trên máy, hỏi AI có trích dẫn. */
// Trên Vercel (không tự deploy từ GitHub) đọc kho từ GitHub Pages để luôn có bản cập nhật hằng ngày (Pages cho phép CORS).
const LAW_BASE = /vercel\.app$/.test(location.hostname) ? 'https://lanle102.github.io/thoi-tiet-bay/laws/' : 'laws/';
const LW = { idx: null, items: [], loaded: false, loading: null, filter: LS.get('lawFilter', 'all'), q: '', err: '' };
const lnorm = s => String(s).toLowerCase().replace(/[^\x00-\x7f]/g, c => c === 'đ' ? 'd' : (c.normalize('NFD')[0] || c));
const STOP = new Set(['the', 'of', 'and', 'or', 'an', 'to', 'in', 'for', 'is', 'be', 'on', 'by', 'what', 'la', 'va', 'cua', 'cho', 'co', 'khong', 'nao', 'gi', 'nhu', 'thi', 'duoc', 'trong', 'voi', 'mot', 'cac', 'nhung', 'bao', 'nhieu', 've']);
async function lawLoad() {
  if (LW.loaded) return; if (LW.loading) return LW.loading;
  LW.loading = (async () => {
    try {
      LW.idx = await (await fetch(LAW_BASE + 'index.json', { cache: 'no-cache' })).json();
      const files = LW.idx.sources.flatMap(s => s.chunks.map(f => [s, f])); let done = 0;
      const parts = await Promise.all(files.map(async ([s, f]) => { const arr = await (await fetch(LAW_BASE + f)).json(); done++; const st = document.getElementById('lw-status'); if (st) st.textContent = `Đang tải kho… ${done}/${files.length}`; return arr.map(it => ({ ...it, s: s.id })); }));
      LW.items = parts.flat(); for (const it of LW.items) { it.nt = lnorm(it.id + ' ' + it.t); it.nx = lnorm(it.x); }
      LW.loaded = true; LW.err = '';
    } catch (e) { LW.err = navigator.onLine ? 'Lỗi tải kho: ' + e.message : 'Đang ngoại tuyến và chưa có bản lưu của kho luật'; }
    LW.loading = null; renderLaws();
  })();
  return LW.loading;
}
window.showLaws = () => { renderLaws(); lawLoad(); };
const srcOf = id => LW.idx?.sources.find(s => s.id === id);
function lawTerms(q) {
  const nq = lnorm(q.trim());
  const phrases = [...nq.matchAll(/"([^"]+)"/g)].map(m => m[1].trim()).filter(Boolean);
  const terms = nq.replace(/"[^"]*"/g, ' ').split(/[^a-z0-9.§]+/).map(t => t.replace(/^\.+|\.+$/g, '')).filter(t => t.length >= 2 && !STOP.has(t));
  return [...phrases, ...terms];
}
function lawSearch(q, limit = 40) {
  const all = lawTerms(q); if (!all.length) return [];
  const res = [];
  for (const it of LW.items) {
    if (LW.filter !== 'all' && srcOf(it.s)?.group !== LW.filter) continue;
    let score = 0, hit = 0;
    for (const t of all) {
      const inT = it.nt.includes(t); let c = 0, p = -1; while ((p = it.nx.indexOf(t, p + 1)) >= 0 && c < 30) c++;
      if (inT || c) hit++; score += (inT ? 12 : 0) + Math.log2(1 + c) * 3 * (t.length > 4 ? 1.3 : 1);
      if (/^\d+\.\d+/.test(t) && it.nt.includes(t)) score += 40;
    }
    if (!hit) continue;
    score *= hit === all.length ? 2 : hit / all.length; score /= 1 + Math.log10(1 + it.x.length / 3000) * 0.4;
    res.push({ it, score, terms: all });
  }
  return res.sort((a, b) => b.score - a.score).slice(0, limit);
}
function hilite(html, t) { // tô sáng không phân biệt dấu (giữ nguyên độ dài chuỗi khi chuẩn hoá)
  const n = lnorm(html); let out = '', i = 0, p;
  while ((p = n.indexOf(t, i)) >= 0) { const pre = html.slice(i, p); if (/&[a-z#0-9]*$/.test(pre) || /<[^>]*$/.test(pre)) { out += html.slice(i, p + t.length); i = p + t.length; continue; } out += pre + '<mark>' + html.slice(p, p + t.length) + '</mark>'; i = p + t.length; }
  return out + html.slice(i);
}
function snippet(it, terms, len = 260) {
  let pos = -1; for (const t of terms) { const p = it.nx.indexOf(t); if (p >= 0 && (pos < 0 || p < pos)) pos = p; }
  const st = Math.max(0, pos - 80); let h = esc((st ? '…' : '') + it.x.slice(st, st + len) + (st + len < it.x.length ? '…' : ''));
  for (const t of terms) h = hilite(h, t); return h;
}
const hiliteAll = (h, terms) => terms.reduce((a, t) => hilite(a, t), h).replace(/\n/g, '<br>');
function renderLaws() {
  const el = document.getElementById('laws-body'); if (!el) return;
  const idx = LW.idx, groups = idx ? [...new Set(idx.sources.map(s => s.group))] : [];
  const stat = LW.loaded ? `${LW.items.length.toLocaleString('vi-VN')} điều/mục · kho cập nhật ${new Date(idx.built).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} (giờ VN) · đã lưu để tra offline` : LW.err || 'Đang tải kho…';
  el.innerHTML = `<div class="card"><div class="tbody">
      <div class="lw-search"><input id="lw-q" class="tinput" type="search" placeholder='Tìm: "VFR weather minimums", 91.155, cấp phép bay…' value="${esc(LW.q)}" autocomplete="off"></div>
      <div class="chips-row">${['all', ...groups].map(g => `<button class="chipbtn${LW.filter === g ? ' on' : ''}" data-f="${esc(g)}">${g === 'all' ? 'Tất cả' : esc(g)}</button>`).join('')}</div>
      <div class="small" id="lw-status">${esc(stat)}</div></div></div>
    <div class="card"><div class="card-head"><h3>Hỏi AI về luật</h3><span class="sub">tìm trong kho trước, bắt buộc trích điều khoản</span></div><div class="tbody">
      <div class="lw-search"><input id="lw-ask" class="tinput" placeholder="Vd: VFR weather minimums in Class C airspace?" autocomplete="off"><button class="pill sm" id="lw-ask-go">Hỏi</button></div><div id="lw-ans"></div></div></div>
    <div id="lw-res"></div>
    ${idx ? `<div class="card"><div class="card-head"><h3>Nguồn toàn văn trong kho</h3></div><div class="tbody small">${idx.sources.map(s => `<div class="lw-src"><b>${esc(s.title)}</b> – ${s.count} mục · ${s.lang === 'vi' ? 'tiếng Việt' : 'tiếng Anh'} · bản ${esc(s.asOf)}${s.stale ? ' <span class="errtxt">(lần cập nhật gần nhất lỗi – đang giữ bản cũ)</span>' : ''}<br><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a><br><small>${esc(s.license)}</small></div>`).join('')}</div></div>
    ${idx.linksOnly.map(g => `<div class="card"><div class="card-head"><h3 style="font-size:14.5px">${esc(g.group)}</h3></div><div class="tbody small">${g.items.map(([t, u]) => `<div class="lw-link">🔗 <a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a></div>`).join('')}<div class="note" style="padding:6px 0 0">Chỉ có tên + link: app không chép nội dung các tài liệu này (bản quyền/không cho tái phân phối), nên không tìm toàn văn và AI không trả lời dựa trên chúng.</div></div></div>`).join('')}
    ${idx.errors?.length ? `<p class="note">Lỗi lần cập nhật gần nhất: ${esc(idx.errors.join('; '))}</p>` : ''}` : ''}
    <p class="note">Chỉ tham khảo – luôn kiểm tra văn bản gốc. Diễn giải của AI không có giá trị pháp lý.</p>`;
  const qi = document.getElementById('lw-q'); let tm;
  qi.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { LW.q = qi.value; showRes(); }, 200); });
  document.getElementById('lw-ask-go').onclick = lawAsk;
  document.getElementById('lw-ask').addEventListener('keydown', e => { if (e.key === 'Enter') lawAsk(); });
  showRes();
}
function showRes() {
  const box = document.getElementById('lw-res'); if (!box) return;
  if (!LW.q.trim()) { box.innerHTML = ''; return; }
  if (!LW.loaded) { box.innerHTML = '<div class="muted" style="padding:8px">Đang tải kho…</div>'; return; }
  const r = lawSearch(LW.q);
  box.innerHTML = `<div class="small" style="padding:4px 4px 8px">${r.length ? r.length + ' kết quả' + (r.length === 40 ? ' (hiện 40 đầu)' : '') : 'Không tìm thấy trong kho – thử từ khoá khác (tiếng Anh cho FAA, tiếng Việt cho luật VN).'}</div>` +
    r.map(({ it, terms }) => `<div class="card lw-item"><div class="lw-h"><span class="lw-tag">${esc(srcOf(it.s)?.group || '')}</span><b>${esc(it.id)}</b></div><div class="lw-t">${esc(it.t)}</div><div class="lw-snip">${snippet(it, terms)}</div>
      <details><summary>Xem toàn văn</summary><div class="lw-full">${hiliteAll(esc(it.x), terms)}</div><a class="linkbtn" href="${esc(it.u)}" target="_blank" rel="noopener">Văn bản gốc ↗</a></details></div>`).join('');
}
document.getElementById('laws-body').addEventListener('click', e => { const b = e.target.closest('.chipbtn'); if (!b) return; LW.filter = b.dataset.f; LS.set('lawFilter', LW.filter); renderLaws(); });
async function lawAsk() {
  const q = document.getElementById('lw-ask').value.trim(), box = document.getElementById('lw-ans'); if (q.length < 4) return;
  if (!LW.loaded) { box.innerHTML = '<div class="muted">Đang tải kho…</div>'; await lawLoad(); }
  const top = lawSearch(q, 6).filter(r => r.score > 3);
  if (!top.length) { box.innerHTML = '<div class="warnbox">Không tìm thấy căn cứ trong kho luật đã tải cho câu hỏi này. Thử từ khoá cụ thể hơn (vd "VFR weather minimums", "91.155", "cấp phép bay").</div>'; return; }
  const cites = top.map((r, i) => ({ n: i + 1, it: r.it, terms: r.terms, src: srcOf(r.it.s) }));
  const data = cites.map(c => { let p = -1; for (const t of c.terms) { const k = c.it.nx.indexOf(t); if (k >= 0 && (p < 0 || k < p)) p = k; } p = Math.max(0, p - 600); return `[${c.n}] ${c.it.id} – ${c.it.t}\nNguồn: ${c.src?.title} (bản ${c.src?.asOf}) ${c.it.u}\n${c.it.x.slice(p, p + 3500)}`; }).join('\n\n');
  const list = `<div class="lw-cites"><b>Đoạn trích dùng làm căn cứ:</b>${cites.map(c => `<div>[${c.n}] <a href="${esc(c.it.u)}" target="_blank" rel="noopener">${esc(c.it.id)}</a> – ${esc(c.it.t)}</div>`).join('')}</div>`;
  box.innerHTML = '<div class="muted">Đang hỏi AI…</div>' + list;
  const st = await aiStatus();
  if (!st.enabled) { box.innerHTML = `<div class="muted">Không dùng được AI (${st.offline ? 'ngoại tuyến' : 'máy chủ chưa cấu hình khoá AI'}) – dưới đây là các điều khoản liên quan nhất trong kho (chế độ tìm kiếm, không AI).</div>` + list; return; }
  const r = await askAI(data, q, 'law');
  box.innerHTML = r.ok ? `<div class="ai-mode">Chế độ AI · ${esc(r.provider)} · ${esc(r.model)}</div><div class="ai-text">${mdLite(r.text)}</div>${list}` : `<div class="muted">AI lỗi: ${esc(r.error)} – xem các điều khoản liên quan dưới đây (chế độ tìm kiếm, không AI).</div>${list}`;
}

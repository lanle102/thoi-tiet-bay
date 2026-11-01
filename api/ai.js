// AI tóm tắt/giải thích/cảnh báo thời tiết & trả lời luật – CHỈ dựa trên dữ liệu thật do app gửi kèm.
// Nhà cung cấp (theo thứ tự): OPENAI_API_KEY (+ OPENAI_BASE_URL, tương thích OpenAI) → AI_GATEWAY_API_KEY → OIDC của Vercel (AI Gateway).
// AI_MODEL: tên model (mặc định gpt-4.1-mini / openai/gpt-4.1-mini).
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = []; for await (const c of req) chunks.push(c); const t = Buffer.concat(chunks).toString('utf8'); return t ? JSON.parse(t) : {};
}
function cors(res) { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.setHeader('Cache-Control', 'no-store'); }
const hits = new Map();
function provider(req) {
  if (process.env.OPENAI_API_KEY) return { name: 'OpenAI-compatible', url: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '') + '/chat/completions', key: process.env.OPENAI_API_KEY, model: process.env.AI_MODEL || 'gpt-4.1-mini' };
  const gw = process.env.AI_GATEWAY_API_KEY || req.headers['x-vercel-oidc-token'] || process.env.VERCEL_OIDC_TOKEN;
  if (gw) return { name: 'Vercel AI Gateway', url: 'https://ai-gateway.vercel.sh/v1/chat/completions', key: gw, model: process.env.AI_MODEL || 'openai/gpt-4.1-mini' };
  return null;
}
const SYSTEM = {
  wx: `Bạn là trợ lý khí tượng hàng không cho phi công, trả lời HOÀN TOÀN bằng tiếng Việt.
LUẬT BẮT BUỘC:
- Chỉ dùng dữ liệu trong phần DỮ LIỆU (METAR, TAF, SIGMET, AIRMET, G-AIRMET, PIREP, NOTAM…) do người dùng gửi. Tuyệt đối không bịa, không ước đoán số liệu (gió, tầm nhìn, mây, nhiệt độ, áp suất, giờ, độ cao) không có trong dữ liệu.
- Mỗi nhận định phải kèm nguồn và giờ bản tin trong ngoặc, ví dụ (METAR VVTS 010200Z) hoặc (TAF VVNB 312300Z) hoặc (SIGMET WSVS31 VVHM 010100Z).
- Nếu một loại dữ liệu không có hoặc lỗi, nói rõ "không có dữ liệu …", không suy diễn.
- Giữ nguyên đơn vị như bản tin (kt, m, SM, ft, hPa…). Giờ bản tin là UTC (Z).
- Định dạng: 1) Tóm tắt (2–4 câu) 2) Giải thích các yếu tố chính 3) Cảnh báo/rủi ro (gió ngang, dông/CB, tầm nhìn thấp, trần mây thấp, gió đứt, nhiễu động, đóng băng, tro núi lửa, SIGMET…) 4) Lưu ý: chỉ tham khảo, không thay thế briefing chính thức.
- Ngắn gọn, dùng gạch đầu dòng, không dùng bảng.`,
  law: `Bạn là trợ lý tra cứu luật hàng không, trả lời HOÀN TOÀN bằng tiếng Việt.
LUẬT BẮT BUỘC:
- Chỉ trả lời dựa trên các ĐOẠN TRÍCH được cung cấp (mỗi đoạn có mã [n], tên điều khoản và nguồn). Không dùng kiến thức ngoài, không bịa điều khoản, số liệu hay mốc thời gian.
- Mỗi ý phải trích dẫn điều khoản cụ thể và mã đoạn, ví dụ: "theo 14 CFR 91.155 [2]" hoặc "Điều 12 Luật HKDD VN 2025 [1]".
- Nếu các đoạn trích không đủ căn cứ để trả lời, nói rõ: "Không tìm thấy căn cứ trong kho luật đã tải" và gợi ý tìm từ khoá khác. Không đoán.
- Văn bản tiếng Anh: dịch/diễn giải sang tiếng Việt, giữ nguyên số hiệu điều khoản.
- Kết thúc bằng: "Chỉ tham khảo – kiểm tra văn bản gốc trước khi áp dụng."`
};
module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const pv = provider(req);
  if (req.method === 'GET') return res.status(200).json({ enabled: !!pv, provider: pv ? pv.name : null, model: pv ? pv.model : null });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if (!pv) return res.status(200).json({ ok: false, error: 'Chưa cấu hình AI (OPENAI_API_KEY hoặc AI Gateway)' });
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0] || 'x';
  const now = Date.now(); const h = (hits.get(ip) || []).filter(t => now - t < 10 * 60e3); h.push(now); hits.set(ip, h);
  if (h.length > 40) return res.status(429).json({ ok: false, error: 'Quá nhiều yêu cầu, thử lại sau vài phút' });
  let b; try { b = await readBody(req); } catch { return res.status(400).json({ error: 'JSON lỗi' }); }
  const mode = b.mode === 'law' ? 'law' : 'wx';
  const data = String(b.data || '').slice(0, 30000);
  const question = String(b.question || '').slice(0, 1000);
  if (!data.trim()) return res.status(400).json({ ok: false, error: 'Thiếu dữ liệu' });
  const user = mode === 'law'
    ? `CÂU HỎI: ${question}\n\nĐOẠN TRÍCH:\n${data}`
    : `YÊU CẦU: ${question || 'Tóm tắt, giải thích và cảnh báo thời tiết.'}\n\nDỮ LIỆU (lấy lúc ${new Date().toISOString().slice(0, 16)}Z):\n${data}`;
  try {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 45000);
    const r = await fetch(pv.url, { method: 'POST', signal: c.signal, headers: { Authorization: 'Bearer ' + pv.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: pv.model, temperature: 0.1, max_tokens: 1100, messages: [{ role: 'system', content: SYSTEM[mode] }, { role: 'user', content: user }] }) });
    clearTimeout(t);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(200).json({ ok: false, error: 'AI trả về HTTP ' + r.status + (j.error?.message ? ': ' + String(j.error.message).slice(0, 200) : '') });
    const text = j.choices?.[0]?.message?.content || '';
    res.status(200).json({ ok: true, text, provider: pv.name, model: j.model || pv.model });
  } catch (e) { res.status(200).json({ ok: false, error: e.name === 'AbortError' ? 'AI hết thời gian chờ' : 'Lỗi gọi AI: ' + e.message }); }
};

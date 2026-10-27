// Đồng bộ yêu thích + cài đặt bằng mã 8 ký tự, không cần đăng nhập.
const { readJSON, writeJSON, readBody, cors } = require('../lib/store');
const crypto = require('crypto');
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.randomBytes(8), b => ALPH[b % ALPH.length]).join('');
const valid = c => /^[A-Z2-9]{8}$/.test(c || '');
function clean(d) {
  if (!d || typeof d !== 'object') throw new Error('thiếu dữ liệu');
  const favs = Array.isArray(d.favs) ? d.favs.filter(x => /^[A-Z0-9]{3,4}$/.test(x)).slice(0, 100) : [];
  const settings = d.settings && typeof d.settings === 'object' ? d.settings : {};
  const out = { favs, settings, updated: Number(d.updated) || Date.now() };
  if (JSON.stringify(out).length > 20000) throw new Error('dữ liệu quá lớn');
  return out;
}
module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const code = String((req.query || {}).code || '').toUpperCase();
  try {
    if (req.method === 'GET') {
      if (!valid(code)) return res.status(400).json({ error: 'Mã không hợp lệ' });
      const d = await readJSON(`sync/${code}.json`);
      return d ? res.status(200).json(d) : res.status(404).json({ error: 'Không tìm thấy mã' });
    }
    if (req.method === 'POST') {
      const data = clean((await readBody(req)).data);
      let c; for (let i = 0; i < 5; i++) { c = newCode(); if (!(await readJSON(`sync/${c}.json`))) break; }
      await writeJSON(`sync/${c}.json`, data);
      return res.status(200).json({ code: c, ...data });
    }
    if (req.method === 'PUT') {
      if (!valid(code)) return res.status(400).json({ error: 'Mã không hợp lệ' });
      if (!(await readJSON(`sync/${code}.json`))) return res.status(404).json({ error: 'Không tìm thấy mã' });
      const data = clean((await readBody(req)).data);
      await writeJSON(`sync/${code}.json`, data);
      return res.status(200).json({ code, ...data });
    }
    res.status(405).json({ error: 'method' });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
};

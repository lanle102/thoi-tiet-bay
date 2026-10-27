// Đăng ký / huỷ nhận thông báo đẩy (Web Push + VAPID).
const { readJSON, writeJSON, remove, readBody, cors } = require('../lib/store');
const crypto = require('crypto');
const key = ep => 'push/' + crypto.createHash('sha256').update(ep).digest('hex').slice(0, 32) + '.json';
module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    if (req.method === 'GET') return res.status(200).json({ publicKey: process.env.VAPID_PUBLIC || null });
    const b = await readBody(req);
    const sub = b.subscription;
    if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint)) return res.status(400).json({ error: 'subscription không hợp lệ' });
    const path = key(sub.endpoint);
    if (req.method === 'DELETE') { await remove(path); return res.status(200).json({ ok: true }); }
    if (req.method === 'POST') {
      const prev = (await readJSON(path)) || {};
      const favs = (Array.isArray(b.favs) ? b.favs : []).filter(x => /^[A-Z0-9]{3,4}$/.test(x)).slice(0, 40);
      await writeJSON(path, { subscription: sub, favs, std: ['faa', 'icao', 'nato'].includes(b.std) ? b.std : 'faa', mode: b.mode === 'all' ? 'all' : 'cat', state: prev.state || {}, created: prev.created || Date.now(), updated: Date.now() });
      return res.status(200).json({ ok: true, favs: favs.length });
    }
    res.status(405).json({ error: 'method' });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
};

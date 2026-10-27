// Lưu JSON nhỏ trong Vercel Blob (store riêng tư ttb-sync).
const { put, get, del, list } = require('@vercel/blob');
async function readJSON(path) {
  try {
    const r = await get(path, { access: 'private', useCache: false });
    if (!r || !r.stream) return null;
    const txt = await new Response(r.stream).text();
    return JSON.parse(txt);
  } catch (e) { if (/not\s*found/i.test(String(e.name) + String(e.message))) return null; throw e; }
}
async function writeJSON(path, obj) {
  await put(path, JSON.stringify(obj), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
}
async function listPaths(prefix) {
  const out = []; let cursor;
  do { const r = await list({ prefix, cursor, limit: 1000 }); out.push(...r.blobs.map(b => b.pathname)); cursor = r.hasMore ? r.cursor : null; } while (cursor);
  return out;
}
async function remove(path) { try { await del(path); } catch {} }
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = []; for await (const c of req) chunks.push(c); const t = Buffer.concat(chunks).toString('utf8'); return t ? JSON.parse(t) : {};
}
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}
module.exports = { readJSON, writeJSON, listPaths, remove, readBody, cors };

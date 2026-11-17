'use strict';
/* Bản đồ: Leaflet + Esri (Dark/Light Gray, World Street Map, World Imagery).
   CARTO từ 2026 bắt buộc API key — tile không khóa bị đóng dấu «API KEY REQUIRED».
   Không đảo màu tile bằng CSS — WebKit trên iPhone hay để nền xám, không vẽ tile. */
const ATTR_ESRI = 'Tiles © Esri — Esri, HERE, Garmin, FAO, NOAA, USGS, Maxar, Earthstar Geographics, and the GIS User Community';
const TTB_MAPS = []; // { map, extraAttr, layer, kind, box }

function ttbKind() {
  const c = LS.get('mapBase', 'auto');
  if (c === 'sat') return 'sat';
  if (c === 'light') return 'street';
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'street';
}
function esri(path, maxZoom, cls, attr) {
  return L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/' + path + '/MapServer/tile/{z}/{y}/{x}', { maxZoom: maxZoom, detectRetina: true, className: cls || 'basemap', attribution: attr || '' });
}
function ttbTile(kind, extraAttr) {
  const attr = extraAttr ? ATTR_ESRI + ' · ' + extraAttr : ATTR_ESRI;
  let layers;
  if (kind === 'sat') layers = [esri('World_Imagery', 19, 'basemap', attr)];
  else if (kind === 'dark') layers = [
    esri('Canvas/World_Dark_Gray_Base', 16, 'basemap', attr),
    esri('Canvas/World_Dark_Gray_Reference', 16, 'basemap-ref', '')
  ];
  else layers = [esri('World_Street_Map', 19, 'basemap', attr)];
  return L.layerGroup(layers);
}
function ttbBringBack(group) {
  const list = [];
  group.eachLayer(l => list.push(l));
  list.slice().reverse().forEach(l => l.bringToBack());
}
function ttbApplyBase(entry) {
  const kind = ttbKind();
  if (entry.layer && entry.kind === kind) {
    if (entry.box) entry.box.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.base === LS.get('mapBase', 'auto')));
    return;
  }
  if (entry.layer) entry.map.removeLayer(entry.layer);
  entry.kind = kind;
  entry.layer = ttbTile(kind, entry.extraAttr).addTo(entry.map);
  ttbBringBack(entry.layer);
  if (entry.box) entry.box.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.base === LS.get('mapBase', 'auto')));
}
function ttbSwitcher(map) {
  const box = L.DomUtil.create('div', 'map-base');
  box.innerHTML = '<button type="button" data-base="auto">Bản đồ</button><button type="button" data-base="sat">Vệ tinh</button><button type="button" data-base="light">Sáng</button>';
  L.DomEvent.disableClickPropagation(box);
  box.addEventListener('click', e => {
    const b = e.target.closest('button[data-base]'); if (!b) return;
    LS.set('mapBase', b.dataset.base);
    TTB_MAPS.forEach(ttbApplyBase);
  });
  map.getContainer().appendChild(box);
  return box;
}
window.attachBasemap = function(map, extraAttr) {
  for (let i = TTB_MAPS.length - 1; i >= 0; i--) {
    const e = TTB_MAPS[i];
    try { if (e.map === map || !e.map.getContainer() || !e.map.getContainer().isConnected) TTB_MAPS.splice(i, 1); } catch { TTB_MAPS.splice(i, 1); }
  }
  const entry = { map, extraAttr: extraAttr || '', layer: null, kind: '', box: ttbSwitcher(map) };
  TTB_MAPS.push(entry);
  ttbApplyBase(entry);
  return entry.layer;
};
window.refreshAllBasemaps = () => TTB_MAPS.forEach(ttbApplyBase);
window.whenMapReady = function(map, fn) {
  let done = false;
  const run = () => {
    if (done || !map) return;
    map.invalidateSize();
    const s = map.getSize();
    if (s.x > 40 && s.y > 40) { done = true; fn(); }
  };
  run();
  if (done) return;
  requestAnimationFrame(() => {
    run();
    if (done) return;
    requestAnimationFrame(() => { run(); if (!done) setTimeout(run, 200); });
  });
};

let map, stnLayer, mapInit = false, radar = { frames: [], layers: [], idx: 0, timer: null, on: false, host: '' }, satLayer = null, mapMetars = {};
function showMap() {
  if (!mapInit) initMap();
  whenMapReady(map, () => { map.invalidateSize(); loadStations(); });
}
window.showMap = showMap;
function favBounds() {
  const pts = favs.map(id => aptInfo(id)).filter(a => a.lat != null).map(a => [a.lat, a.lon]);
  return pts.length ? L.latLngBounds(pts) : L.latLngBounds([[8.5, 102], [23.5, 110]]);
}
function initMap() {
  mapInit = true;
  map = L.map('map', { zoomControl: false, attributionControl: true, worldCopyJump: true });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  attachBasemap(map);
  map.createPane('wx'); map.getPane('wx').style.zIndex = 350; map.getPane('wx').style.pointerEvents = 'none';
  stnLayer = L.layerGroup().addTo(map);
  whenMapReady(map, () => map.fitBounds(favBounds().pad(0.15), { maxZoom: 7, animate: false }));
  let t; map.on('moveend', () => { clearTimeout(t); t = setTimeout(loadStations, 350); });
  map.on('zoomend', drawStations);
  document.getElementById('btn-map-fit').onclick = () => map.fitBounds(favBounds().pad(0.15), { maxZoom: 7 });
  document.getElementById('mc-radar').onclick = toggleRadar;
  document.getElementById('mc-play').onclick = () => (radar.timer ? stopAnim() : startAnim());
  document.getElementById('mc-sat').onclick = toggleSat;
  document.getElementById('map-legend').innerHTML = legendDots();
  window.initWxMapCtl?.();
}
function legendDots() {
  const std = settings.std || 'faa';
  const cats = std === 'icao' ? ['VMC', 'IMC'] : std === 'nato' ? ['BLU', 'WHT', 'GRN', 'YLO', 'AMB', 'RED'] : ['VFR', 'MVFR', 'IFR', 'LIFR'];
  return cats.map(c => `<span><i style="background:${catColor(c)}"></i>${c}</span>`).join('');
}
async function loadStations() {
  if (!map) return;
  const z = map.getZoom();
  if (z >= 5) {
    const b = map.getBounds();
    const s = Math.max(-90, b.getSouth()), n = Math.min(90, b.getNorth()), w = Math.max(-180, b.getWest()), e = Math.min(180, b.getEast());
    try {
      const list = await api('metar', { bbox: [s, w, n, e].map(x => x.toFixed(2)).join(','), format: 'json' });
      for (const m of list) if (!mapMetars[m.icaoId] || m.obsTime >= mapMetars[m.icaoId].obsTime) mapMetars[m.icaoId] = m;
    } catch {}
  }
  drawStations();
}
function drawStations() {
  if (!map) return;
  stnLayer.clearLayers();
  document.getElementById('map-legend').innerHTML = legendDots();
  const z = map.getZoom(), b = map.getBounds().pad(0.2);
  const all = { ...mapMetars }; for (const id of favs) if (cache.metar[id]) all[id] = cache.metar[id];
  const shown = z >= 5 ? Object.values(all) : favs.map(id => cache.metar[id]).filter(Boolean);
  for (const m of shown) {
    if (m.lat == null || !b.contains([m.lat, m.lon])) continue;
    const c = metarCat(m), fav = favs.includes(m.icaoId);
    const mk = L.circleMarker([m.lat, m.lon], { radius: fav ? 9 : 7, color: fav ? '#fff' : 'rgba(0,0,0,.45)', weight: fav ? 3 : 1.5, fillColor: catColor(c).replace(/var\((--[a-z]+)\)/, (_, v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim()), fillOpacity: 1 });
    if (z >= 6 || fav) mk.bindTooltip(m.icaoId, { permanent: true, direction: 'right', offset: [8, 0], className: 'stn-label' });
    const a = aptInfo(m.icaoId);
    mk.bindPopup(() => `<b>${m.icaoId}</b> ${esc(a.name || a.full || '')} <span class="badge c-${c}">${c}</span><div class="raw">${esc(m.rawOb)}</div><small>${ago(m.obsTime)}</small><br><button class="pop-btn" data-open="${m.icaoId}">Xem chi tiết ›</button>`);
    stnLayer.addLayer(mk);
  }
}
document.getElementById('map').addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (b) { map.closePopup(); openDetail(b.dataset.open); } });
/* Radar */
async function toggleRadar() {
  const btn = document.getElementById('mc-radar');
  if (radar.on) { radar.on = false; stopAnim(); radar.layers.forEach(l => map.removeLayer(l)); radar.layers = []; btn.classList.remove('on'); document.getElementById('mc-play').hidden = true; document.getElementById('map-time').hidden = true; return; }
  try {
    const j = await fetchT('https://api.rainviewer.com/public/weather-maps.json', 12000).then(r => r.json());
    radar.host = j.host; radar.frames = [...(j.radar.past || []), ...(j.radar.nowcast || [])];
    if (!radar.frames.length) throw new Error('không có khung');
    radar.layers = radar.frames.map(f => L.tileLayer(`${j.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, { pane: 'wx', opacity: 0, maxNativeZoom: 7, maxZoom: 18, tileSize: 256, attribution: 'Radar © <a href="https://www.rainviewer.com/api.html">RainViewer</a>' }).addTo(map));
    radar.idx = (j.radar.past || []).length - 1; radar.nPast = (j.radar.past || []).length;
    radar.on = true; btn.classList.add('on'); document.getElementById('mc-play').hidden = false; document.getElementById('map-time').hidden = false;
    showFrame(radar.idx); startAnim();
  } catch (e) { toast('Không tải được radar: ' + e.message); }
}
function showFrame(i) {
  radar.layers.forEach((l, k) => l.setOpacity(k === i ? 0.7 : 0));
  const f = radar.frames[i]; const d = new Date(f.time * 1000);
  document.getElementById('map-time').textContent = `Radar ${pad(d.getHours())}:${pad(d.getMinutes())} (${fmtUTC(d)})${i >= radar.nPast ? ' · dự báo' : ''}`;
}
function startAnim() { stopAnim(); document.getElementById('mc-play').textContent = '❚❚'; radar.timer = setInterval(() => { radar.idx = (radar.idx + 1) % radar.layers.length; showFrame(radar.idx); }, 700); }
function stopAnim() { clearInterval(radar.timer); radar.timer = null; const b = document.getElementById('mc-play'); if (b) b.textContent = '▶︎'; }
/* Vệ tinh: NASA GIBS – hồng ngoại kênh 13 (Himawari cho châu Á–TBD, GOES cho châu Mỹ) */
function toggleSat() {
  const btn = document.getElementById('mc-sat');
  if (satLayer) { map.removeLayer(satLayer); satLayer = null; btn.classList.remove('on'); return; }
  const lon = map.getCenter().lng;
  let prod = 'Himawari_AHI_Band13_Clean_Infrared', label = 'Himawari';
  if (lon < -100) { prod = 'GOES-West_ABI_Band13_Clean_Infrared'; label = 'GOES-West'; }
  else if (lon < -25) { prod = 'GOES-East_ABI_Band13_Clean_Infrared'; label = 'GOES-East'; }
  else if (lon < 70) toast('Ảnh vệ tinh miễn phí (NASA GIBS) chỉ phủ châu Á–TBD và châu Mỹ; vùng này có thể trống');
  satLayer = L.tileLayer(`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${prod}/default/default/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`, { pane: 'wx', opacity: 0.55, maxNativeZoom: 6, maxZoom: 18, attribution: `Vệ tinh ${label} © NASA GIBS` }).addTo(map);
  btn.classList.add('on');
  toast(`Ảnh mây hồng ngoại ${label} mới nhất (cập nhật ~10 phút)`);
}
window.onDetailClosed = () => { if (tab === 'map' && map) { map.invalidateSize(); drawStations(); } };

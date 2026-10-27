'use strict';
/* Bản đồ: Leaflet + OpenStreetMap, chấm màu hạng bay, radar RainViewer (hoạt cảnh), ảnh mây vệ tinh NASA GIBS. */
let map, stnLayer, mapInit = false, radar = { frames: [], layers: [], idx: 0, timer: null, on: false, host: '' }, satLayer = null, mapMetars = {};
function showMap() {
  if (!mapInit) initMap();
  setTimeout(() => { map.invalidateSize(); loadStations(); }, 60);
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
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, className: 'basemap', attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
  map.createPane('wx'); map.getPane('wx').style.zIndex = 350; map.getPane('wx').style.pointerEvents = 'none';
  stnLayer = L.layerGroup().addTo(map);
  map.fitBounds(favBounds().pad(0.15), { maxZoom: 7 });
  let t; map.on('moveend', () => { clearTimeout(t); t = setTimeout(loadStations, 350); });
  map.on('zoomend', drawStations);
  document.getElementById('btn-map-fit').onclick = () => map.fitBounds(favBounds().pad(0.15), { maxZoom: 7 });
  document.getElementById('mc-radar').onclick = toggleRadar;
  document.getElementById('mc-play').onclick = () => (radar.timer ? stopAnim() : startAnim());
  document.getElementById('mc-sat').onclick = toggleSat;
  document.getElementById('map-legend').innerHTML = legendDots();
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

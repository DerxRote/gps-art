/* GPS-Art – Bedienung, Karte, Wege-Berechnung, GPX. */
import { textToPath, normalizeText, SHAPES, shapeSvg, SUPPORTED_HINT } from './shapes.js';

const L = window.L;
const $ = id => document.getElementById(id);
const STORE = 'gpsart.v1';

// ------------------------------------------------------------ Zustand

const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } })();
const state = {
  center: saved.center || [48.3689, 10.8978],   // Augsburg, Rathausplatz
  mode: saved.mode || 'text',
  text: saved.text ?? 'HALLO',
  shape: saved.shape || 'herz',
  drawn: saved.drawn || null,                    // eigene Zeichnung: [[x,y], …] in Metern
  km: saved.km || 10,
  rot: saved.rot || 0,
  profile: saved.profile || 'foot',
  fit: 1,                                        // Korrektur, damit die echte Route die gewünschte Länge hat
  route: null                                    // { coords: [[lat,lon], …], meters }
};
function persist() {
  try {
    const { center, mode, text, shape, drawn, km, rot, profile } = state;
    localStorage.setItem(STORE, JSON.stringify({ center, mode, text, shape, drawn, km, rot, profile }));
  } catch { /* egal */ }
}

// ------------------------------------------------------------ Geometrie

const R = 6371008.8;
const rad = d => d * Math.PI / 180;
function haversine(a, b) {
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function pathLength(p) { let s = 0; for (let i = 1; i < p.length; i++) s += Math.hypot(p[i][0] - p[i-1][0], p[i][1] - p[i-1][1]); return s; }
function latLngLength(p) { let s = 0; for (let i = 1; i < p.length; i++) s += haversine(p[i-1], p[i]); return s; }

// Meter (x nach Osten, y nach Norden) rund um einen Mittelpunkt ↔ Breite/Länge
function toLatLng([x, y], [lat0, lon0]) {
  return [lat0 + (y / R) * 180 / Math.PI, lon0 + (x / (R * Math.cos(rad(lat0)))) * 180 / Math.PI];
}
function toMeters([lat, lon], [lat0, lon0]) {
  return [rad(lon - lon0) * R * Math.cos(rad(lat0)), rad(lat - lat0) * R];
}

function unitPath() {
  if (state.mode === 'text') return textToPath(state.text);
  if (state.mode === 'shape') return SHAPES[state.shape].path;
  return state.drawn || [];
}

/** Vorlage in Meter rund um die Mitte: zentriert, auf Ziel-Länge skaliert (noch nicht gedreht). */
function planMeters() {
  const p = unitPath();
  if (p.length < 2) return null;
  const xs = p.map(q => q[0]), ys = p.map(q => q[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const len = pathLength(p);
  if (!len) return null;
  const s = state.km * 1000 * state.fit / len;
  return { pts: p.map(([x, y]) => [(x - cx) * s, (y - cy) * s]), hw: (maxX - minX) / 2 * s, hh: (maxY - minY) / 2 * s };
}
function rotate([x, y], deg) {
  const a = rad(-deg), c = Math.cos(a), si = Math.sin(a);
  return [x * c - y * si, x * si + y * c];
}

/** Vorlage in Breite/Länge: zentriert, auf Ziel-Länge skaliert, gedreht. */
function planLatLngs() {
  const m = planMeters();
  if (!m) return [];
  return m.pts.map(q => toLatLng(rotate(q, state.rot), state.center));
}

/** Rahmen um die Vorlage (halbe Breite/Höhe in Metern, mit etwas Rand). */
function boxSize() {
  const m = planMeters();
  if (!m) return null;
  const pad = Math.max(m.hw, m.hh) * 0.12 + 15;
  return { hw: m.hw + pad, hh: m.hh + pad };
}
function boxLatLngs(b) {
  return [[-b.hw, -b.hh], [b.hw, -b.hh], [b.hw, b.hh], [-b.hw, b.hh]]
    .map(q => toLatLng(rotate(q, state.rot), state.center));
}
/** Liegt der Punkt (Breite/Länge) innerhalb des Rahmens? */
function inBox(latlng) {
  const b = boxSize();
  if (!b) return false;
  const [x, y] = rotate(toMeters([latlng.lat, latlng.lng], state.center), -state.rot);
  return Math.abs(x) <= b.hw && Math.abs(y) <= b.hh;
}

/** Wegpunkte für die Berechnung: alle Ecken plus Zwischenpunkte im Abstand `step` Meter. */
function densify(latlngs, step) {
  const out = [latlngs[0]];
  for (let i = 1; i < latlngs.length; i++) {
    const a = latlngs[i - 1], b = latlngs[i];
    const d = haversine(a, b);
    const n = Math.floor(d / step);
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    out.push(b);
  }
  return out;
}

/** Kleine Abstecher entfernen (hin zu einem Wegpunkt und gleich wieder zurück). */
function removeSpikes(pts, maxLen) {
  const out = pts.slice();
  let i = 0;
  while (i < out.length - 2) {
    let acc = 0, best = -1;
    for (let j = i + 1; j < out.length; j++) {
      acc += haversine(out[j - 1], out[j]);
      if (acc > maxLen) break;
      if (j > i + 1 && haversine(out[i], out[j]) < 4) best = j;
    }
    if (best > 0) out.splice(i + 1, best - i);
    else i++;
  }
  return out;
}

/** Douglas-Peucker für die eigene Zeichnung. */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let md = 0, mi = -1;
    const [x1, y1] = pts[s], [x2, y2] = pts[e];
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy || 1;
    for (let i = s + 1; i < e; i++) {
      const t = Math.max(0, Math.min(1, ((pts[i][0] - x1) * dx + (pts[i][1] - y1) * dy) / l2));
      const d = Math.hypot(pts[i][0] - (x1 + t * dx), pts[i][1] - (y1 + t * dy));
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol && mi > 0) { keep[mi] = 1; stack.push([s, mi], [mi, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// ------------------------------------------------------------ Karte

const map = L.map('map', { zoomControl: true, attributionControl: true }).setView(state.center, 14);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap-Mitwirkende</a> · ' +
    'Routen: <a href="https://routing.openstreetmap.de/" target="_blank" rel="noopener">FOSSGIS</a>'
}).addTo(map);
map.attributionControl.setPrefix(false);

const css = getComputedStyle(document.documentElement);
const boxShape = L.polygon([], {
  color: css.getPropertyValue('--plan').trim() || '#2f5d8a', weight: 2, dashArray: '2 6', opacity: .9,
  fillColor: css.getPropertyValue('--plan').trim() || '#2f5d8a', fillOpacity: .07, interactive: false
}).addTo(map);
const planLine = L.polyline([], { color: css.getPropertyValue('--plan').trim() || '#2f5d8a', weight: 3, dashArray: '6 7', opacity: .9 }).addTo(map);
const routeLine = L.polyline([], { color: css.getPropertyValue('--accent').trim() || '#e2531f', weight: 5, opacity: .9 }).addTo(map);
const drawLine = L.polyline([], { color: css.getPropertyValue('--plan').trim() || '#2f5d8a', weight: 4 }).addTo(map);
const pinIcon = (cls, txt) => L.divIcon({ className: '', html: `<div class="pin ${cls}">${txt}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] });
const startMarker = L.marker(state.center, { icon: pinIcon('start', 'S'), interactive: false, keyboard: false });
const endMarker = L.marker(state.center, { icon: pinIcon('end', 'Z'), interactive: false, keyboard: false });
// Mittelpunkt: Hier liegt die Mitte der Vorlage. Ein Tipp auf die Karte setzt die Mitte dorthin.
const handle = L.marker(state.center, {
  interactive: false, keyboard: false,
  icon: L.divIcon({ className: '', html: '<div class="handle"></div>', iconSize: [22, 22], iconAnchor: [11, 11] })
}).addTo(map);

// Verschieben: irgendwo im Rahmen anfassen und ziehen (Maus und Finger).
let boxDrag = null;          // { id, start: [lat,lon] Mitte beim Start, from: Punkt beim Start, moved }
let suppressClick = false;
const activePointers = new Set();
const mapNode = document.getElementById('map');
mapNode.addEventListener('pointerdown', e => {
  activePointers.add(e.pointerId);
  if (drawing) return;
  if (activePointers.size > 1) { endBoxDrag(); return; }   // zwei Finger: Karte zoomen lassen
  if (e.button > 0) return;
  if (e.target.closest('.leaflet-control')) return;
  const ll = map.mouseEventToLatLng(e);
  if (!inBox(ll)) return;
  boxDrag = { id: e.pointerId, start: state.center.slice(), from: ll, moved: false };
  map.dragging.disable();
  mapNode.classList.add('moving');
  try { mapNode.setPointerCapture(e.pointerId); } catch { /* egal */ }
}, true);
mapNode.addEventListener('pointermove', e => {
  if (!boxDrag || e.pointerId !== boxDrag.id) {
    if (!drawing && !boxDrag && e.pointerType === 'mouse') mapNode.classList.toggle('over-box', inBox(map.mouseEventToLatLng(e)));
    return;
  }
  e.preventDefault();
  const ll = map.mouseEventToLatLng(e);
  const p0 = map.latLngToContainerPoint(boxDrag.from), p1 = map.latLngToContainerPoint(ll);
  if (!boxDrag.moved && p0.distanceTo(p1) < 4) return;
  boxDrag.moved = true;
  state.center = [boxDrag.start[0] + (ll.lat - boxDrag.from.lat), boxDrag.start[1] + (ll.lng - boxDrag.from.lng)];
  changed(false, false, false);
}, true);
function endBoxDrag() {
  if (!boxDrag) return;
  if (boxDrag.moved) { suppressClick = true; persist(); }
  else suppressClick = true;   // Tipp in den Rahmen: nichts tun
  boxDrag = null;
  map.dragging.enable();
  mapNode.classList.remove('moving');
  setTimeout(() => { suppressClick = false; }, 300);
}
const pointerEnd = e => { activePointers.delete(e.pointerId); if (boxDrag && e.pointerId === boxDrag.id) endBoxDrag(); };
mapNode.addEventListener('pointerup', pointerEnd, true);
mapNode.addEventListener('pointercancel', pointerEnd, true);

map.on('click', e => {
  if (drawing || suppressClick) return;
  state.center = [e.latlng.lat, e.latlng.lng];
  changed(false);
});

function fitView() {
  const pts = state.route ? state.route.coords : planLine.getLatLngs();
  if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 17 });
}

// ------------------------------------------------------------ Anzeige

function fmtKm(m) { return (m / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' km'; }
function fmtDuration(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h}:${String(m).padStart(2, '0')} h` : `${m} min`;
}
function setStatus(msg, error = false) { const el = $('status'); el.textContent = msg; el.classList.toggle('error', error); }

function changed(resetFit = true, refit = false, save = true) {
  if (resetFit) state.fit = 1;
  state.route = null;
  routeLine.setLatLngs([]);
  $('result').hidden = true;
  startMarker.remove(); endMarker.remove();
  setStatus('');
  render();
  if (refit) fitView();
  if (save) persist();
}

function render() {
  const plan = planLatLngs();
  planLine.setLatLngs(plan);
  const box = boxSize();
  boxShape.setLatLngs(box && !drawing ? boxLatLngs(box) : []);
  handle.setLatLng(state.center);
  $('kmOut').textContent = state.km.toLocaleString('de-DE') + ' km';
  $('rotOut').textContent = state.rot + '°';
  document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === state.mode));
  document.querySelectorAll('.mode').forEach(m => { m.hidden = m.dataset.for !== state.mode; });
  document.querySelectorAll('#profileSeg button').forEach(b => b.classList.toggle('on', b.dataset.profile === state.profile));
  document.querySelectorAll('#shapeGrid button').forEach(b => b.classList.toggle('on', b.dataset.shape === state.shape));
  const t = normalizeText(state.text);
  const hint = $('textHint');
  if (state.mode === 'text') {
    hint.classList.toggle('warn', !t);
    hint.textContent = t ? `Erlaubt: ${SUPPORTED_HINT}. Kurze Wörter klappen am besten.` : 'Bitte einen Text eingeben (' + SUPPORTED_HINT + ').';
  }
  $('drawHint').textContent = state.drawn
    ? 'Deine Zeichnung ist gespeichert. Du kannst sie verschieben, drehen und größer machen. Oder neu zeichnen.'
    : 'Drücke auf „Zeichnen starten“ und male dann mit Finger oder Maus in einem Zug auf die Karte.';
  $('resTimeLabel').textContent = state.profile === 'bike' ? 'Fahrzeit ca. (20 km/h)' : 'Laufzeit ca. (6 min/km)';
}

// ------------------------------------------------------------ Bedienfeld

$('shapeGrid').innerHTML = Object.entries(SHAPES).map(([k, s]) =>
  `<button type="button" data-shape="${k}">${shapeSvg(s.path)}<span>${s.label}</span></button>`).join('');
$('shapeGrid').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  state.shape = b.dataset.shape; changed(true, true);
});
$('modeSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  state.mode = b.dataset.mode; changed(true, true);
  if (state.mode === 'draw' && !state.drawn) startDrawing();
});
$('profileSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  state.profile = b.dataset.profile; changed();
});
$('textInput').value = state.text;
$('textInput').addEventListener('input', e => { state.text = e.target.value; changed(); });
$('textInput').addEventListener('change', () => fitView());
$('kmInput').value = state.km;
$('kmInput').addEventListener('input', e => { state.km = +e.target.value; changed(); });
$('kmInput').addEventListener('change', () => fitView());
$('rotInput').value = state.rot;
$('rotInput').addEventListener('input', e => { state.rot = +e.target.value; changed(false); });

// Ortssuche
$('searchForm').addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('searchInput').value.trim();
  const list = $('searchResults');
  if (q.length < 2) return;
  list.hidden = false; list.innerHTML = '<li class="empty">Suche …</li>';
  try {
    const res = await fetch('/api/search?q=' + encodeURIComponent(q));
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Fehler');
    if (!body.results.length) { list.innerHTML = '<li class="empty">Nichts gefunden.</li>'; return; }
    list.innerHTML = '';
    for (const r of body.results) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button'; btn.textContent = r.name;
      btn.addEventListener('click', () => {
        state.center = [r.lat, r.lon]; list.hidden = true; changed(false, true);
      });
      li.append(btn); list.append(li);
    }
  } catch (err) {
    list.innerHTML = '<li class="empty">Suche gerade nicht möglich.</li>';
  }
});

$('locateBtn').addEventListener('click', () => {
  if (!navigator.geolocation) { setStatus('Dein Browser kann den Standort nicht bestimmen.', true); return; }
  setStatus('Standort wird gesucht …');
  navigator.geolocation.getCurrentPosition(
    pos => { state.center = [pos.coords.latitude, pos.coords.longitude]; changed(false, true); },
    () => setStatus('Standort nicht verfügbar. Tippe stattdessen auf die Karte.', true),
    { enableHighAccuracy: false, timeout: 10000 }
  );
});

// ------------------------------------------------------------ Selbst zeichnen

let drawing = false, drawPts = [];
const mapEl = $('map');

function startDrawing() {
  drawing = true; drawPts = [];
  boxShape.setLatLngs([]);
  map.dragging.disable(); map.doubleClickZoom.disable(); map.boxZoom.disable(); map.scrollWheelZoom.disable();
  if (map.tap) map.tap.disable();
  document.querySelector('.mapwrap').classList.add('drawing');
  $('drawBar').hidden = false;
  $('drawBtn').textContent = 'Zeichnen läuft …';
  $('drawBtn').classList.add('active');
}
function stopDrawing() {
  drawing = false;
  map.dragging.enable(); map.doubleClickZoom.enable(); map.boxZoom.enable(); map.scrollWheelZoom.enable();
  if (map.tap) map.tap.enable();
  document.querySelector('.mapwrap').classList.remove('drawing');
  $('drawBar').hidden = true;
  $('drawBtn').textContent = state.drawn ? 'Neu zeichnen' : 'Zeichnen starten';
  $('drawBtn').classList.remove('active');
  drawLine.setLatLngs([]);
  render();
}
$('drawBtn').addEventListener('click', () => drawing ? stopDrawing() : startDrawing());
$('drawCancel').addEventListener('click', stopDrawing);

let pointerDown = false;
mapEl.addEventListener('pointerdown', e => {
  if (!drawing) return;
  e.preventDefault(); e.stopPropagation();
  pointerDown = true; mapEl.setPointerCapture(e.pointerId);
  drawPts = [map.mouseEventToLatLng(e)];
  drawLine.setLatLngs(drawPts);
}, true);
mapEl.addEventListener('pointermove', e => {
  if (!drawing || !pointerDown) return;
  e.preventDefault(); e.stopPropagation();
  drawPts.push(map.mouseEventToLatLng(e));
  drawLine.setLatLngs(drawPts);
}, true);
const finish = e => {
  if (!drawing || !pointerDown) return;
  e.stopPropagation();
  pointerDown = false;
  if (drawPts.length < 5) { drawPts = []; drawLine.setLatLngs([]); return; }
  const ll = drawPts.map(p => [p.lat, p.lng]);
  const lats = ll.map(p => p[0]), lons = ll.map(p => p[1]);
  const c = [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lons) + Math.max(...lons)) / 2];
  let m = ll.map(p => toMeters(p, c));
  const xs = m.map(p => p[0]), ys = m.map(p => p[1]);
  const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  m = simplify(m, diag * 0.012).map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
  const len = pathLength(m);
  state.drawn = m;
  state.center = c;
  state.rot = 0; $('rotInput').value = 0;
  state.km = Math.min(60, Math.max(2, Math.round(len / 500) / 2)); $('kmInput').value = state.km;
  stopDrawing();
  changed(true, true);
};
mapEl.addEventListener('pointerup', finish, true);
mapEl.addEventListener('pointercancel', finish, true);

// ------------------------------------------------------------ Auf Wege legen

async function snap(plan) {
  const target = state.km * 1000;
  const step = Math.max(60, Math.min(400, target / 220));
  let pts = densify(plan, step);
  if (pts.length > 780) pts = densify(plan, step * pts.length / 700);
  const res = await fetch('/api/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile: state.profile, coords: pts.map(p => [+p[1].toFixed(6), +p[0].toFixed(6)]) })
  });
  let body = {};
  try { body = await res.json(); } catch { /* leer */ }
  if (!res.ok) throw new Error(body.error || 'Fehler ' + res.status);
  const coords = removeSpikes(body.coords.map(([lon, lat]) => [lat, lon]), step * 2.2);
  return { coords, meters: latLngLength(coords) };
}

$('routeBtn').addEventListener('click', async () => {
  const plan = planLatLngs();
  if (plan.length < 2) { setStatus(state.mode === 'draw' ? 'Bitte zuerst etwas zeichnen.' : 'Bitte zuerst einen Text eingeben.', true); return; }
  const btn = $('routeBtn');
  btn.disabled = true;
  try {
    setStatus('Route wird auf Wege gelegt …');
    let r = await snap(plan);
    // Einmal nachbessern, damit die echte Route ungefähr die gewünschte Länge hat.
    const ratio = r.meters / (state.km * 1000);
    if (Math.abs(ratio - 1) > 0.08) {
      setStatus('Länge wird angepasst …');
      state.fit = state.fit / ratio;
      render();
      r = await snap(planLatLngs());
    }
    state.route = r;
    routeLine.setLatLngs(r.coords);
    startMarker.setLatLng(r.coords[0]).addTo(map);
    endMarker.setLatLng(r.coords[r.coords.length - 1]).addTo(map);
    $('resKm').textContent = fmtKm(r.meters);
    const min = state.profile === 'bike' ? r.meters / 1000 / 20 * 60 : r.meters / 1000 * 6;
    $('resTime').textContent = fmtDuration(min);
    $('result').hidden = false;
    setStatus('Fertig. Gefällt es dir nicht? Verschiebe oder drehe die Vorlage ein wenig und probier es nochmal.');
    fitView();
    if (window.matchMedia('(max-width: 760px)').matches) $('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    setStatus('Das hat nicht geklappt: ' + err.message + '. Versuch es gleich nochmal.', true);
  } finally {
    btn.disabled = false;
  }
});

// ------------------------------------------------------------ GPX

function gpxName() {
  if (state.mode === 'text') return normalizeText(state.text) || 'Text';
  if (state.mode === 'shape') return SHAPES[state.shape].label;
  return 'Zeichnung';
}
const esc = s => s.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

$('gpxBtn').addEventListener('click', () => {
  if (!state.route) return;
  const name = `GPS-Art ${gpxName()} (${fmtKm(state.route.meters)})`;
  const pts = state.route.coords.map(([lat, lon]) => `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"/>`).join('\n');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="route.pfleger.work" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${esc(name)}</name>
    <desc>Route auf Wegen aus OpenStreetMap-Daten, berechnet mit dem Routing-Dienst der FOSSGIS. © OpenStreetMap-Mitwirkende, ODbL.</desc>
    <copyright author="OpenStreetMap-Mitwirkende"><license>https://opendatacommons.org/licenses/odbl/1-0/</license></copyright>
    <link href="https://www.openstreetmap.org/copyright"><text>© OpenStreetMap-Mitwirkende</text></link>
    <time>${new Date().toISOString()}</time>
  </metadata>
  <trk>
    <name>${esc(name)}</name>
    <type>${state.profile === 'bike' ? 'cycling' : 'running'}</type>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
  const file = 'gps-art-' + gpxName().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.gpx';
  const url = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
  const a = document.createElement('a');
  a.href = url; a.download = file; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});

// ------------------------------------------------------------ Start

render();
setTimeout(fitView, 50);

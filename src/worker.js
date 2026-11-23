/*
 * GPS-Art – kleiner Server für route.pfleger.work.
 *
 * Statische Dateien (Karte, App) liefert Cloudflare direkt aus dem Ordner public/ aus.
 * Dieser Worker läuft nur für /api/*:
 *   POST /api/route   – legt eine Linie auf echte Wege (Laufen oder Rad)
 *   GET  /api/search  – sucht einen Ort (Adresse, Stadt)
 *
 * Wege-Berechnung: kostenloser OSRM-Dienst der FOSSGIS (routing.openstreetmap.de), Daten von OpenStreetMap.
 * Ortssuche: Nominatim (nominatim.openstreetmap.org).
 * Die Anfragen gehen über diesen Worker, damit die IP-Adresse der Nutzer nicht an diese Dienste geht.
 * Es wird nichts gespeichert. Es wird kein API-Schlüssel gebraucht.
 */

const UA = 'route.pfleger.work GPS-Art (private Hobby-App; https://route.pfleger.work/impressum)';
const PROFILES = { foot: 'routed-foot', bike: 'routed-bike' };
const MAX_POINTS = 800;     // so viele Wegpunkte pro Anfrage höchstens
const CHUNK = 80;           // so viele Wegpunkte pro Anfrage an OSRM

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }
});

function validCoords(list) {
  if (!Array.isArray(list) || list.length < 2 || list.length > MAX_POINTS) return false;
  return list.every(p => Array.isArray(p) && p.length === 2 &&
    Number.isFinite(p[0]) && Number.isFinite(p[1]) &&
    Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 85);
}

async function osrmChunk(profile, coords) {
  const path = coords.map(([lon, lat]) => lon.toFixed(6) + ',' + lat.toFixed(6)).join(';');
  const url = `https://routing.openstreetmap.de/${PROFILES[profile]}/route/v1/driving/${path}` +
    '?overview=full&geometries=geojson&steps=false&alternatives=false&continue_straight=false';
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) {
      const body = await res.json();
      if (body.code !== 'Ok' || !body.routes || !body.routes[0]) {
        throw Object.assign(new Error(body.message || body.code || 'Keine Route'), { status: 422 });
      }
      return { coords: body.routes[0].geometry.coordinates, distance: body.routes[0].distance };
    }
    last = res.status;
    if (res.status !== 429 && res.status < 500) break;
    await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
  }
  throw Object.assign(new Error('Wegedienst antwortet nicht (' + last + ')'), { status: 502 });
}

async function handleRoute(request) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Ungültige Anfrage' }, 400); }
  const profile = body && body.profile;
  const coords = body && body.coords;
  if (!PROFILES[profile]) return json({ error: 'Unbekannte Sportart' }, 400);
  if (!validCoords(coords)) return json({ error: 'Ungültige Punkte' }, 400);

  // In Stücke teilen (mit einem gemeinsamen Punkt), nacheinander berechnen und zusammensetzen.
  const chunks = [];
  for (let i = 0; i < coords.length - 1; i += CHUNK - 1) chunks.push(coords.slice(i, i + CHUNK));
  const out = [];
  let distance = 0;
  try {
    for (const part of chunks) {
      if (part.length < 2) continue;
      const r = await osrmChunk(profile, part);
      distance += r.distance;
      out.push(...(out.length ? r.coords.slice(1) : r.coords));
    }
  } catch (e) {
    return json({ error: e.message }, e.status || 502);
  }
  return json({ coords: out, distance });
}

// Nominatim erlaubt höchstens 1 Anfrage pro Sekunde (Nutzungsregeln). Pro Worker-Instanz drosseln.
let lastNominatim = 0;
async function nominatimSlot() {
  const wait = lastNominatim + 1100 - Date.now();
  lastNominatim = Math.max(Date.now(), lastNominatim + 1100);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
}

async function handleSearch(url) {
  const q = (url.searchParams.get('q') || '').trim().slice(0, 200);
  if (q.length < 2) return json({ results: [] });
  const api = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=de&q=' +
    encodeURIComponent(q);
  await nominatimSlot();
  const res = await fetch(api, {
    headers: { 'User-Agent': UA },
    cf: { cacheTtl: 86400, cacheEverything: true }
  });
  if (!res.ok) return json({ error: 'Suche gerade nicht möglich' }, 502);
  const list = await res.json();
  const results = list.map(r => ({ name: r.display_name, lat: +r.lat, lon: +r.lon }));
  return json({ results }, 200, { 'Cache-Control': 'public, max-age=3600' });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/route' && request.method === 'POST') return handleRoute(request);
    if (url.pathname === '/api/search' && request.method === 'GET') return handleSearch(url);
    if (url.pathname.startsWith('/api/')) return json({ error: 'Nicht gefunden' }, 404);
    return env.ASSETS.fetch(request);
  }
};

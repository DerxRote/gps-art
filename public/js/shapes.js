/*
 * GPS-Art – Buchstaben und Formen als Linien.
 *
 * Jeder Buchstabe ist EINE durchgehende Linie in einem Raster (Breite w, Höhe 6, y zeigt nach oben).
 * Damit man ihn in einem Stück laufen kann, gehen manche Linien ein Stück zurück (z. B. der Mittelstrich
 * beim E). Das sieht man auf der fertigen Karte nicht, es kostet nur ein paar Meter.
 * Buchstaben beginnen möglichst unten links und enden unten rechts. Die Verbindung zum nächsten
 * Buchstaben ist eine gerade Linie.
 */

const G = {
  A: [[0,0],[0,6],[4,6],[4,3],[0,3],[4,3],[4,0]],
  B: [[0,0],[0,6],[3,6],[4,5],[4,4],[3,3],[0,3],[3,3],[4,2],[4,1],[3,0],[0,0],[3,0]],
  C: [[0,0],[0,6],[4,6],[0,6],[0,0],[4,0]],
  D: [[0,0],[0,6],[3,6],[4,5],[4,1],[3,0],[0,0],[3,0]],
  E: [[0,0],[0,6],[4,6],[0,6],[0,3],[3,3],[0,3],[0,0],[4,0]],
  F: [[0,0],[0,6],[4,6],[0,6],[0,3],[3,3]],
  G: [[0,0],[0,6],[4,6],[0,6],[0,0],[4,0],[4,3],[2,3],[4,3],[4,0]],
  H: [[0,0],[0,6],[0,3],[4,3],[4,6],[4,0]],
  I: [[0,0],[0,6],[0,0]],
  J: [[0,0],[0,2],[0,0],[3,0],[3,6],[3,0]],
  K: [[0,0],[0,6],[0,3],[4,6],[0,3],[4,0]],
  L: [[0,0],[0,6],[0,0],[3,0]],
  M: [[0,0],[0,6],[2.5,3],[5,6],[5,0]],
  N: [[0,0],[0,6],[4,0],[4,6],[4,0]],
  O: [[0,0],[0,6],[4,6],[4,0],[0,0],[4,0]],
  P: [[0,0],[0,6],[4,6],[4,3],[0,3],[4,3]],
  Q: [[0,0],[0,6],[4,6],[4,1],[3,0],[0,0],[3,0],[2,1],[3,0],[4,-1]],
  R: [[0,0],[0,6],[4,6],[4,3],[0,3],[4,0]],
  S: [[0,0],[4,0],[4,3],[0,3],[0,6],[4,6],[0,6],[0,3],[4,3],[4,0]],
  T: [[2,0],[2,6],[0,6],[4,6],[2,6],[2,0]],
  U: [[0,0],[0,6],[0,0],[4,0],[4,6],[4,0]],
  V: [[2,0],[0,6],[2,0],[4,6],[2,0]],
  W: [[1,0],[0,6],[1,0],[2.5,4],[4,0],[5,6],[4,0]],
  X: [[0,0],[4,6],[2,3],[0,6],[4,0]],
  Y: [[2,0],[2,3],[0,6],[2,3],[4,6],[2,3],[2,0]],
  Z: [[0,0],[4,6],[0,6],[4,6],[0,0],[4,0]],
  0: [[0,0],[0,6],[4,6],[4,0],[0,0],[4,0]],
  1: [[2,0],[2,6],[0,4],[2,6],[2,0]],
  2: [[0,0],[0,3],[4,3],[4,6],[0,6],[4,6],[4,3],[0,3],[0,0],[4,0]],
  3: [[0,0],[4,0],[4,3],[1,3],[4,3],[4,6],[0,6],[4,6],[4,0]],
  4: [[3,0],[3,6],[0,2],[4,2],[3,2],[3,0]],
  5: [[0,0],[4,0],[4,3],[0,3],[0,6],[4,6],[0,6],[0,3],[4,3],[4,0]],
  6: [[0,0],[0,6],[4,6],[0,6],[0,3],[4,3],[4,0],[0,0],[4,0]],
  7: [[1,0],[4,6],[0,6],[4,6],[1,0]],
  8: [[0,0],[0,6],[4,6],[4,0],[0,0],[0,3],[4,3],[4,0]],
  9: [[0,0],[4,0],[4,6],[0,6],[0,3],[4,3],[4,0]],
  '♥': [[3,0],[0,3.5],[0,5],[1,6],[2,6],[3,5],[4,6],[5,6],[6,5],[6,3.5],[3,0]],
  '+': [[0,3],[1.5,3],[1.5,4.5],[1.5,1.5],[1.5,3],[3,3]],
  '-': [[0,3],[2.5,3]],
  '.': [[0,0],[0,0.7],[0,0]]
};

const GAP = 1.5;      // Abstand zwischen Buchstaben
const SPACE = 3;      // Leerzeichen

export function normalizeText(text) {
  return String(text || '')
    .toUpperCase()
    .replace(/Ä/g, 'AE').replace(/Ö/g, 'OE').replace(/Ü/g, 'UE').replace(/ẞ|ß/g, 'SS')
    .replace(/<3/g, '♥').replace(/[❤♡💗💖]/gu, '♥')
    .split('').filter(ch => ch === ' ' || G[ch]).join('')
    .replace(/\s+/g, ' ').trim();
}

export const SUPPORTED_HINT = 'A–Z, 0–9, Ä Ö Ü, ♥ (oder <3), + - .';

/** Text → eine durchgehende Linie [[x,y], …] (Einheiten: Raster). */
export function textToPath(text) {
  const t = normalizeText(text);
  const path = [];
  let x = 0;
  for (const ch of t) {
    if (ch === ' ') { x += SPACE - GAP; continue; }
    const g = G[ch];
    let w = 0;
    for (const [gx, gy] of g) {
      path.push([x + gx, gy]);
      if (gx > w) w = gx;
    }
    x += w + GAP;
  }
  return dedupe(path);
}

function dedupe(path) {
  const out = [];
  for (const p of path) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 1e-9 || Math.abs(q[1] - p[1]) > 1e-9) out.push(p);
  }
  return out;
}

function circle(n = 28) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    pts.push([Math.cos(a), Math.sin(a)]);
  }
  return pts;
}

function star(points = 5) {
  const pts = [];
  for (let i = 0; i <= points * 2; i++) {
    const a = Math.PI / 2 + (i / (points * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? 1 : 0.42;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

function heart(n = 40) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = Math.PI + (i / n) * Math.PI * 2; // Start unten an der Spitze
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push([x, y]);
  }
  return pts;
}

export const SHAPES = {
  herz:  { label: 'Herz',  path: heart() },
  stern: { label: 'Stern', path: star() },
  kreis: { label: 'Kreis', path: circle() },
  haus:  { label: 'Haus',  path: [[0,0],[0,3],[2,5],[4,3],[4,0],[0,0]] },
  blitz: { label: 'Blitz', path: [[1.2,6],[0,2.6],[1.6,2.6],[0.6,0],[3.2,3.8],[1.7,3.8],[2.8,6],[1.2,6]] },
  pfeil: { label: 'Pfeil', path: [[0,1],[4,1],[4,0],[6,1.5],[4,3],[4,2],[0,2],[0,1]] }
};

/** SVG-Vorschau für eine Form-Kachel. */
export function shapeSvg(path) {
  const xs = path.map(p => p[0]), ys = path.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const s = 36 / Math.max(maxX - minX, maxY - minY);
  const ox = (48 - (maxX - minX) * s) / 2, oy = (48 - (maxY - minY) * s) / 2;
  const d = path.map((p, i) => (i ? 'L' : 'M') + (ox + (p[0] - minX) * s).toFixed(1) + ' ' +
    (48 - oy - (p[1] - minY) * s).toFixed(1)).join(' ');
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="${d}"/></svg>`;
}

# GPS-Art · route.pfleger.work

Text schreiben oder Form zeichnen → die App legt sie auf echte Wege (Laufen oder Rad) → GPX herunterladen → in Komoot, Strava oder Garmin importieren und loslaufen.

## So funktioniert es

1. **Wo?** Ort suchen, auf die Karte tippen oder „Mein Standort“. Der blaue Punkt ist die Mitte der Vorlage und lässt sich verschieben.
2. **Was?** Text (A–Z, 0–9, Ä Ö Ü, ♥), eine fertige Form oder selbst mit dem Finger zeichnen.
3. **Wie groß?** Gewünschte Länge in km und Drehung.
4. **Womit?** Laufen (Fußwege) oder Rad.
5. **Auf Wege legen** → Länge und geschätzte Zeit → **GPX herunterladen**.

Buchstaben sind einfache Strich-Buchstaben, die man in einem Zug laufen kann (`public/js/shapes.js`). Manche Linien läuft man doppelt (hin und zurück), das sieht man auf der Karte nicht.

## Technik

- `public/` – statische App (Leaflet 1.9.4 lokal in `public/vendor/`, Kartenbilder von OpenStreetMap)
- `src/worker.js` – Cloudflare Worker nur für `/api/*`
  - `POST /api/route` → OSRM der FOSSGIS (`routing.openstreetmap.de`, Profile foot/bike), kein API-Schlüssel nötig
  - `GET /api/search` → Nominatim
- Nach der Berechnung entfernt die App kleine Abstecher (hin und sofort zurück) und passt die Größe einmal an, damit die echte Route ungefähr die gewünschte Länge hat.
- Deploy: Cloudflare Workers mit Git-Anbindung, automatisch bei jedem Push auf `main`. Domain `route.pfleger.work` (in `wrangler.jsonc`).

Lokal testen: `npm install` und `npm run dev`.

## Komoot

Komoot hat keine offene Schnittstelle zum Hochladen. Der Weg ist: GPX herunterladen → komoot.com → Planen → GPX-Datei importieren.

# Losbuch – Lotterie-Begleiter für Deutschland

Single-File-Web-App (HTML/JS, keine Abhängigkeiten) zum Begleiten deutscher Lotterien:
LOTTO 6aus49 (mit Spiel 77 / SUPER 6), Eurojackpot, KENO (plus 5), GlücksSpirale,
Deutsche Fernsehlotterie, Aktion Mensch.

Losbuch spielt nichts automatisch. Es ist ein Begleiter: Spiele abonnieren, gespielte
Scheine erfassen, Ziehungen eintragen (oder automatisch holen lassen), Gewinne nach
Gewinnklassen prüfen, Bilanz sehen.

## Betrieb

| Variante | Speicher | Ziehungszahlen | Benachrichtigung |
|---|---|---|---|
| **Lokal** (`index.html` im Browser öffnen oder auf Cloudflare Pages legen) | Browser (localStorage), Gerätewechsel per Sicherungscode | manuell eintragen | keine |
| **Claude-Artifact** (aktuelle Live-Version) | Artifact-Datenbank, auf allen Geräten gleich | täglich 22:40 Uhr automatisch (siehe `docs/abend-check.md`) | Push aufs Handy bei Ergebnis/Gewinn |

Die App erkennt selbst, ob die Cloud-Datenbank verfügbar ist (`window.claude.use("db")`) und
fällt sonst auf localStorage zurück.

## Datenmodell

- `settings/main` → `{ active: { lotto: true, ej: true, … } }`
- `tickets/<id>` → `{ game, date (YYYY-MM-DD), tips: [{n:[…], e:[…]}], sz, los, spiel77, super6, plus5, stake, label }`
- `draws/<game>_<date>` → je Spiel `n`, `e`, `sz`, `spiel77`, `super6`, `plus5` oder `wins`, optional `quoten`, `jackpot`, `source`
- `results/<ticketId>_<drawId>` → `{ hits: [{label, gk, text}], won, seen }`

## Auswertung

Gewinnklassen: LOTTO 1–9, Eurojackpot 1–12, Spiel 77 / SUPER 6 / plus 5 über Endziffern,
KENO über den Gewinnplan je Typ, Losnummern-Lotterien über die längste Endziffern-
Übereinstimmung. Quoten werden angezeigt, wenn sie mit der Ziehung gespeichert wurden;
verbindlich ist immer die Auszahlung des Anbieters.

## Roadmap

- Eigenes Backend ohne Claude: Cloudflare Worker + D1 (Sync), Cron-Scraper für Ziehungen, Web Push
- PWA-Manifest + Service Worker für Homescreen-Installation
- Spielgemeinschaften (geteilte Scheine, Anteile)

Spielteilnahme ab 18 Jahren. Hilfe bei problematischem Spielverhalten: BZgA 0800 1 37 27 00.

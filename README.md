# Losbuch – Lotterie-Begleiter für Deutschland

Progressive Web App (installierbar, offline-fähig) für LOTTO 6aus49 (mit Spiel 77 / SUPER 6),
Eurojackpot, KENO (plus 5), GlücksSpirale, Deutsche Fernsehlotterie und Aktion Mensch.

Losbuch spielt nichts automatisch. Es begleitet: Spielquittung scannen oder Zahlen eintragen,
Ziehungen werden automatisch geholt und ausgewertet, Gewinne samt Quote, Abholfrist und
Anteil der Tippgemeinschaft stehen am nächsten Morgen auf dem Handy.

Live: https://losbuch.f4991r.workers.dev

## Funktionen

- **Scan**: Foto der Spielquittung → OCR (Tesseract, läuft komplett im Browser, keine Bild-Übertragung) → Tipps vorausgefüllt
- **Automatischer Abend-Check**: Cloudflare Cron holt die offiziellen Zahlen (mehrere Quellen, Validierung), bewertet alle Scheine
- **Web-Push**: Ergebnis je Ziehung, „GEWINN“-Hinweis ab Gewinnklasse 6 (LOTTO) / 8 (Eurojackpot) oder ab 100 €, Jackpot-Alarm ab 50 Mio. €
- **Cloud-Sync** über Kopplungscode, offline-first (IndexedDB), Last-Writer-Wins
- **Gewinne einlösen**: Abholfrist (13 Wochen) mit Countdown, „Eingelöst“-Haken
- **Annahmeschluss** je Bundesland, nächste Ziehung, Dauerscheine (2/4/8 Ziehungen)
- **Tippgemeinschaften** mit Anteilen → Gewinn wird automatisch aufgeteilt
- **Bilanz**: Einsatz, Gewinn, Saldo, Trefferquote, Diagramm je Spiel
- Vollständiger Gewinnplan: 9 LOTTO-, 12 Eurojackpot-Klassen, KENO-Typen 2–10, feste Quoten für Spiel 77, SUPER 6, plus 5, GlücksSpirale

## Architektur

```
public/            statische PWA (index.html, app.js, rules.js, sw.js, vendor/tesseract)
src/worker.js      Cloudflare Worker: API, Cron, Push-Versand
src/sources.js     Quellen + Text-Parser für Ziehungsergebnisse
src/push.js        Web Push (VAPID + RFC 8291 aes128gcm) ohne Abhängigkeiten
migrations/        D1-Schema
tests/             node --test (Regeln, Parser, Push-Verschlüsselung, App-Smoke-Test mit jsdom)
```

`public/rules.js` ist die eine Quelle der Wahrheit für Gewinnklassen und Termine – Browser und
Worker nutzen dieselbe Datei.

### API (Bearer-Token = Kopplungscode)

| Route | Zweck |
|---|---|
| `POST /api/account` | Konto anlegen → `{id, token}` |
| `GET/PATCH /api/account` | Einstellungen (Bundesland, aktive Spiele) |
| `POST /api/sync?since=ts` | Dirty-Docs hochladen, Änderungen + Ziehungen seit `ts` zurück |
| `GET /api/draws?from=` · `POST /api/draws` | Ziehungen lesen / manuell oder extern erfassen |
| `GET /api/push/vapid` · `POST/DELETE /api/push/subscribe` · `POST /api/push/test` | Web-Push |
| `POST /api/run?force=1` | Abend-Check sofort ausführen |
| `GET /api/probe?game=lotto&date=` | Diagnose: was liefern die Quellen? |

### Deployment

Der Worker ist an dieses Repo gebunden (Workers Builds): jeder Push auf `main` deployt.
Lokal: `npm test`, `npx wrangler dev`, `npx wrangler deploy`. Die D1-Datenbank `losbuch`
ist in `wrangler.jsonc` eingetragen; Schema liegt in `migrations/`. VAPID-Schlüssel werden beim
ersten Push-Aufruf erzeugt und in D1 (`kv`) abgelegt – keine Secrets nötig.

Cron (UTC): `15 7,19,20,21,22 * * *` – holt nur, was fällig ist, und nimmt Lücken der letzten
14 Tage nach, sofern Scheine existieren.

### Quellen prüfen

Die Ergebnisseiten ändern sich. `GET /api/probe?game=lotto` zeigt pro Quelle HTTP-Status,
Textauszug und Parser-Ergebnis. Liefert keine Quelle, kann die Ziehung manuell oder per
`POST /api/draws` (z. B. aus einem anderen Automatisierungs-Lauf) eingetragen werden.

## Hinweise

Spielteilnahme ab 18 Jahren. Alle Quoten und Fristen ohne Gewähr – maßgeblich ist der Anbieter.
Hilfe bei problematischem Spielverhalten: BZgA 0800 1 37 27 00 (kostenlos, anonym).

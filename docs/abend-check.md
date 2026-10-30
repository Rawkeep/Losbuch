# Abend-Check

## Variante A – Cloudflare Cron (Standard)
`src/worker.js` → `runFetch()`: läuft zu den Zeiten aus `wrangler.jsonc`, holt fällige Ziehungen
über `src/sources.js`, schreibt `draws`, bewertet Scheine aller Konten mit `rules.js`, sendet Push
(einmal je Konto und Ziehung, Tabelle `notified`).

## Variante B – Claude Scheduled Task (Ergänzung)
Eine Claude-Aufgabe kann Ziehungen per Websuche ermitteln und mit
`POST /api/draws` (Bearer = Kopplungscode) in den Worker schreiben. Sie dient als zweite,
unabhängige Quelle, falls die Parser an einer Seite scheitern.

## Dokumentformat `draws`
- lotto: `{game,date,n[6],sz,spiel77,super6,quoten?,jackpot?}`
- ej: `{game,date,n[5],e[2],quoten?,jackpot?}`
- keno: `{game,date,n[20],plus5?}`
- gs/fl/am: `{game,date,wins[],quoten?}`

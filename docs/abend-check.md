# Abend-Check (Claude Scheduled Task)

Läuft täglich 22:40 Uhr (Europe/Berlin) als Claude-Aufgabe „Losbuch Abend-Check“.

1. Liest `settings/main`, ermittelt die heute gezogenen aktiven Spiele und fehlende Ziehungen
   der letzten 14 Tage, zu denen Scheine existieren.
2. Holt die offiziellen Zahlen per Websuche (lotto.de, eurojackpot.de, keno.de, Lotterie-Seiten,
   Tageszeitungen), möglichst von zwei Quellen bestätigt, inkl. Quoten und Jackpot.
3. Schreibt `draws/<game>_<date>` (nie überschreiben).
4. Wertet die Scheine aus und sendet nur bei Ergebnis/Gewinn oder Jackpot > 50 Mio. € eine Push-Nachricht.

Dokumentformat siehe README. Die App prüft beim Öffnen zusätzlich selbst.

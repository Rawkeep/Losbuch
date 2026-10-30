// Quellen und Text-Parser für Ziehungsergebnisse. Die Seiten ändern sich; /api/probe zeigt, was ankommt.
export const SOURCES = {
  lotto: [
    { url: 'https://www.lotto.de/lotto-6aus49/lottozahlen' },
    { url: 'https://www.westlotto.de/lotto-6aus49/lottozahlen' },
    { url: 'https://www.lotto-hessen.de/lotto/gewinnzahlen' },
    { url: 'https://www.lotto-bayern.de/lotto-6aus49/gewinnzahlen' },
  ],
  ej: [
    { url: 'https://www.eurojackpot.de/gewinnzahlen' },
    { url: 'https://www.lotto.de/eurojackpot/gewinnzahlen' },
    { url: 'https://www.westlotto.de/eurojackpot/gewinnzahlen' },
  ],
  keno: [
    { url: 'https://www.keno.de/gewinnzahlen' },
    { url: 'https://www.lotto.de/keno/gewinnzahlen' },
    { url: 'https://www.westlotto.de/keno/gewinnzahlen' },
  ],
  gs: [
    { url: 'https://www.lotto.de/gluecksspirale/gewinnzahlen' },
    { url: 'https://www.westlotto.de/gluecksspirale/gewinnzahlen' },
  ],
  fl: [{ url: 'https://www.fernsehlotterie.de/gewinnzahlen' }],
  am: [{ url: 'https://www.aktion-mensch.de/lotterie/gewinnzahlen' }],
};

export const JACKPOT_SOURCES = {
  lotto: [{ url: 'https://www.lotto.de/lotto-6aus49' }, { url: 'https://www.westlotto.de/lotto-6aus49' }, { url: 'https://www.lotto.de/lotto-6aus49/lottozahlen' }],
  ej: [{ url: 'https://www.eurojackpot.de' }, { url: 'https://www.lotto.de/eurojackpot' }, { url: 'https://www.westlotto.de/eurojackpot' }],
};
// Jackpot-Betrag aus Seitentext: "Jackpot … 18 Mio. €" / "120 Millionen Euro" / "ca. 2.000.000 €"
export function parseJackpot(text, game) {
  const re = /jackpot[^\d]{0,80}?(\d{1,3}(?:[.,]\d{1,3})?)\s*(Mio\.?|Millionen|Mio €|Mio\. €)|(\d{1,3}(?:\.\d{3}){2,})\s*(?:€|EUR|Euro)/gi; let m, best = 0;
  while ((m = re.exec(text))) { let v = m[1] ? parseFloat(m[1].replace(',', '.')) : parseInt(m[3].replace(/\./g, ''), 10) / 1e6; if (game === 'ej' && v > 120) continue; if (game === 'lotto' && v > 60) continue; if (v > best) best = v; }
  if (!best) return '';
  return (Number.isInteger(best) ? String(best) : best.toLocaleString('de-DE', { maximumFractionDigits: 1 })) + ' Mio. €';
}

export function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h\d|section|article|td|th|span)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&[a-z]+;/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n');
}

const MONTHS = ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'];
// Alle Stellen im Text, an denen das Datum steht
function datePositions(text, iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const pats = [
    new RegExp(`\\b0?${d}\\.\\s?0?${m}\\.\\s?(${y}|${String(y).slice(2)})\\b`, 'g'),
    new RegExp(`\\b0?${d}\\.\\s?${MONTHS[m - 1]}\\s?${y}`, 'gi'),
    new RegExp(`\\b${iso}\\b`, 'g'),
  ];
  const pos = [];
  for (const p of pats) { let mm; while ((mm = p.exec(text))) pos.push(mm.index + mm[0].length); } // Fenster beginnt NACH dem Datum
  return pos.sort((a, b) => a - b);
}
const nums = s => (s.match(/\d+/g) || []).map(Number);
const distinct = a => new Set(a).size === a.length;
const inRange = (a, lo, hi) => a.every(x => x >= lo && x <= hi);
const after = (text, re, len = 40) => { const m = text.match(re); return m ? text.slice(m.index + m[0].length, m.index + m[0].length + len) : ''; };
const digits = (s, n) => { const m = s.match(new RegExp(`\\b\\d{${n}}\\b`)); return m ? m[0] : ''; };
const money = s => { const m = s.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*(Mio\.?|Millionen|€|EUR)/i); return m ? m[0].replace('Millionen', 'Mio.') : ''; };

function quoten(win, max) { // "Klasse 1 … 12.345,60 €" → {1:"12.345,60 €"}
  const q = {}; const re = /(?:Klasse|GK|Gewinnklasse)\s*(\d{1,2})\b[\s\S]{0,80}?(\d{1,3}(?:\.\d{3})*(?:,\d{2})?\s*€|unbesetzt|Jackpot)/gi; let m;
  while ((m = re.exec(win))) { const k = +m[1]; if (k >= 1 && k <= max && !q[k]) q[k] = m[2].replace(/\s+/g, ' '); }
  return Object.keys(q).length ? q : undefined;
}

export function parseDraw(game, text, iso) {
  text = String(text);
  for (const pos of datePositions(text, iso)) {
    const win = text.slice(pos, pos + (game === 'keno' ? 1500 : 1200));
    const d = tryParse(game, win, iso);
    if (d) return d;
  }
  return null;
}

function tryParse(game, win, date) {
  if (game === 'lotto') {
    // 6 Zahlen 1–49, danach Superzahl, Spiel 77, SUPER 6
    const body = win.replace(/\b(19|20)\d{2}\b/g, ' '); // Jahreszahlen raus
    const all = nums(body.split(/Superzahl/i)[0] || '');
    let n = null;
    for (let i = 0; i + 6 <= all.length; i++) { const c = all.slice(i, i + 6); if (inRange(c, 1, 49) && distinct(c)) { n = [...c].sort((a, b) => a - b); break; } }
    if (!n) return null;
    const sz = (after(win, /Superzahl/i, 12).match(/\d/) || [''])[0];
    const spiel77 = digits(after(win, /Spiel\s*77/i, 40), 7), super6 = digits(after(win, /Super\s*6/i, 40), 6);
    const d = { game, date, n, sz, spiel77, super6, quoten: quoten(win, 9), jackpot: money(after(win, /Jackpot/i, 60)) };
    return d;
  }
  if (game === 'ej') {
    const body = win.replace(/\b(19|20)\d{2}\b/g, ' ');
    const all = nums(body);
    for (let i = 0; i + 7 <= all.length; i++) {
      const n = all.slice(i, i + 5), e = all.slice(i + 5, i + 7);
      if (inRange(n, 1, 50) && distinct(n) && inRange(e, 1, 12) && distinct(e)) {
        return { game, date, n: [...n].sort((a, b) => a - b), e: [...e].sort((a, b) => a - b), quoten: quoten(win, 12), jackpot: money(after(win, /Jackpot/i, 60)) };
      }
    }
    return null;
  }
  if (game === 'keno') {
    const body = win.replace(/\b(19|20)\d{2}\b/g, ' ').split(/plus\s*5/i)[0];
    const all = nums(body);
    for (let i = 0; i + 20 <= all.length; i++) { const c = all.slice(i, i + 20); if (inRange(c, 1, 70) && distinct(c)) return { game, date, n: [...c].sort((a, b) => a - b), plus5: digits(after(win, /plus\s*5/i, 40), 5) }; }
    return null;
  }
  // Losnummern-Lotterien: alle Zahlenblöcke mit 1–7 Ziffern nach "Gewinnklasse"/"Gewinnzahl"
  const cleaned = win.replace(/(?:Gewinnklasse|Klasse|GK)\s*\d{1,2}/gi, ' ').replace(/\d{1,3}(?:\.\d{3})*,\d{2}\s*€/g, ' ');
  const wins = [...new Set((cleaned.match(/\b\d{1,7}\b/g) || []).filter(x => !/^(19|20)\d{2}$/.test(x)))];
  if (game === 'gs') {
    // GlücksSpirale: 1–7 Endziffern, je Klasse; nimm pro Länge die ersten zwei Treffer
    const byLen = {}; for (const w of wins) { const l = w.length; if (l >= 1 && l <= 7) (byLen[l] = byLen[l] || []).length < 2 && byLen[l].push(w); }
    const out = Object.values(byLen).flat();
    return out.length >= 5 ? { game, date, wins: out, quoten: quoten(win, 7) } : null;
  }
  return wins.length ? { game, date, wins: wins.slice(0, 60) } : null;
}

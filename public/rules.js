/* Losbuch – Spielregeln, Gewinnklassen, Termine. Läuft im Browser (window.LosbuchRules), im Worker und in Node (module.exports). */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.LosbuchRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- Katalog ----------
  // days: 0=So … 6=Sa. drawTime: Uhrzeit der Ziehung (Europe/Berlin). claimWeeks: Frist zur Gewinnabholung ab Ziehung.
  const GAMES = [
    { id: 'lotto', name: 'LOTTO 6aus49', kind: 'lotto', days: [3, 6], drawTime: { 3: '18:25', 6: '19:25' }, price: 1.2, priceLabel: '1,20 € je Tipp + Gebühr',
      rule: '6 Zahlen aus 49 + Superzahl (letzte Ziffer der Losnummer). 9 Gewinnklassen.', extras: ['Spiel 77', 'SUPER 6'], claimWeeks: 13 },
    { id: 'ej', name: 'Eurojackpot', kind: 'ej', days: [2, 5], drawTime: { 2: '21:00', 5: '21:00' }, price: 2.0, priceLabel: '2,00 € je Tipp + Gebühr',
      rule: '5 aus 50 + 2 Eurozahlen aus 12. 12 Gewinnklassen, Jackpot 10 bis 120 Mio. €.', extras: [], claimWeeks: 13 },
    { id: 'keno', name: 'KENO', kind: 'keno', days: [0, 1, 2, 3, 4, 5, 6], drawTime: { all: '19:10' }, price: 1.0, priceLabel: '1 / 2 / 5 / 10 € je Tipp',
      rule: 'Typ 2–10: so viele Zahlen aus 70 tippen, 20 werden gezogen. Fester Gewinnplan je Typ und Einsatz.', extras: ['plus 5'], claimWeeks: 13 },
    { id: 'gs', name: 'GlücksSpirale', kind: 'suffix', days: [6], drawTime: { 6: '19:25' }, price: 5.0, priceLabel: '5,00 € je Los + Gebühr',
      rule: '7-stellige Losnummer. Gewinn nach übereinstimmenden Endziffern (GK1 = 1 Endziffer … GK7 = Sofortrente).', extras: [], claimWeeks: 13 },
    { id: 'fl', name: 'Deutsche Fernsehlotterie', kind: 'suffix', days: [0], drawTime: { 0: '19:00' }, price: 5.0, priceLabel: 'Lose ab 5 € / Monat',
      rule: 'Soziallotterie. Gewinn nach Endziffern der Losnummer, Zusatzziehungen für Jahreslose.', extras: [], claimWeeks: 13 },
    { id: 'am', name: 'Aktion Mensch', kind: 'suffix', days: [2], drawTime: { 2: '19:00' }, price: 5.0, priceLabel: 'Lose ab 5 € / Monat',
      rule: 'Soziallotterie. Wöchentliche Ziehung, Gewinn nach Endziffern der Losnummer.', extras: [], claimWeeks: 13 },
  ];
  const G = Object.fromEntries(GAMES.map(g => [g.id, g]));

  // Annahmeschluss je Bundesland (Uhrzeit vor der Ziehung), Stand 2026, ohne Gewähr – bitte beim eigenen Anbieter prüfen.
  const CUTOFF = {
    lotto: { default: { 3: '17:45', 6: '18:45' }, BY: { 3: '18:00', 6: '19:00' }, NW: { 3: '18:00', 6: '19:00' }, HE: { 3: '18:00', 6: '19:00' }, BE: { 3: '17:45', 6: '18:45' } },
    ej: { default: { 2: '19:00', 5: '19:00' }, NW: { 2: '19:00', 5: '19:00' } },
    keno: { default: { all: '18:50' } },
    gs: { default: { 6: '18:45' } },
  };
  function cutoff(gameId, dow, state) {
    const c = CUTOFF[gameId]; if (!c) return null;
    const t = c[state] || c.default; return (t && (t[dow] || t.all)) || null;
  }

  // ---------- Feste Quoten (Gewinnplan), Angaben in Euro je 1 € Einsatz bzw. je Los ----------
  const KENO_PLAN = { // Typ → { Treffer: Faktor }
    10: { 10: 100000, 9: 1000, 8: 100, 7: 15, 6: 5, 5: 2, 0: 2 },
    9: { 9: 50000, 8: 1000, 7: 20, 6: 5, 5: 2, 0: 2 },
    8: { 8: 10000, 7: 100, 6: 15, 5: 2, 4: 1, 0: 1 },
    7: { 7: 1000, 6: 100, 5: 12, 4: 1 },
    6: { 6: 500, 5: 15, 4: 2, 3: 1 },
    5: { 5: 100, 4: 7, 3: 2 },
    4: { 4: 22, 3: 2, 2: 1 },
    3: { 3: 16, 2: 1 },
    2: { 2: 6 },
  };
  const FIXED = {
    lotto: { 9: 6 },
    spiel77: { 1: 177777, 2: 77777, 3: 7777, 4: 777, 5: 77, 6: 17, 7: 5 },
    super6: { 1: 100000, 2: 6666, 3: 666, 4: 66, 5: 6, 6: 2.5 },
    plus5: { 1: 5000, 2: 500, 3: 50, 4: 5, 5: 2 },
    gs: { 1: 10, 2: 25, 3: 100, 4: 1000, 5: 10000, 6: 100000, 7: 'Sofortrente 10.000 €/Monat (20 Jahre)' },
  };
  const LOTTO_GK = { '6t': 1, '6f': 2, '5t': 3, '5f': 4, '4t': 5, '4f': 6, '3t': 7, '3f': 8, '2t': 9 };
  const EJ_GK = { '52': 1, '51': 2, '50': 3, '42': 4, '41': 5, '32': 6, '40': 7, '22': 8, '31': 9, '30': 10, '12': 11, '21': 12 };

  // ---------- Hilfen ----------
  const inter = (a, b) => (a || []).filter(x => (b || []).includes(x));
  function sufMatch(a, b) { a = String(a || ''); b = String(b || ''); let n = 0; while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++; return n; }
  const euro = v => typeof v === 'number' ? v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €' : String(v);
  function quota(draw, gk, fixed) { // bevorzugt offizielle Quote aus der Ziehung, sonst fester Gewinnplan
    const q = draw && draw.quoten && draw.quoten[gk]; if (q != null) return typeof q === 'number' ? euro(q) : String(q);
    const f = fixed && fixed[gk]; return f == null ? null : (typeof f === 'number' ? euro(f) : f);
  }
  const num = s => { if (typeof s === 'number') return s; const m = String(s || '').replace(/\./g, '').replace(',', '.').match(/[\d.]+/); return m ? parseFloat(m[0]) : null; };

  // ---------- Validierung ----------
  function validateTicket(t) {
    const g = G[t.game]; if (!g) return 'Unbekanntes Spiel';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date || '')) return 'Ziehungsdatum fehlt';
    if (g.kind === 'suffix') return /^\d{5,12}$/.test(t.los || '') ? null : 'Losnummer (5–12 Ziffern) fehlt';
    if (!t.tips || !t.tips.length) return 'Kein Tipp eingetragen';
    for (const tp of t.tips) {
      const n = tp.n || [], e = tp.e || [];
      if (new Set(n).size !== n.length || new Set(e).size !== e.length) return 'Doppelte Zahl im Tipp';
      if (g.kind === 'lotto' && (n.length !== 6 || n.some(x => x < 1 || x > 49))) return 'LOTTO: genau 6 Zahlen von 1–49';
      if (g.kind === 'ej' && (n.length !== 5 || e.length !== 2 || n.some(x => x < 1 || x > 50) || e.some(x => x < 1 || x > 12))) return 'Eurojackpot: 5 Zahlen (1–50) + 2 Eurozahlen (1–12)';
      if (g.kind === 'keno' && (n.length < 2 || n.length > 10 || n.some(x => x < 1 || x > 70))) return 'KENO: 2–10 Zahlen von 1–70';
    }
    if (g.kind === 'lotto' && t.sz !== '' && t.sz != null && !/^\d$/.test(String(t.sz))) return 'Superzahl: eine Ziffer 0–9';
    return null;
  }
  function validateDraw(d) {
    const g = G[d.game]; if (!g) return 'Unbekanntes Spiel';
    if (g.kind === 'suffix') return (d.wins && d.wins.length) ? null : 'Gewinnzahlen fehlen';
    const need = g.kind === 'lotto' ? 6 : g.kind === 'ej' ? 5 : 20;
    if (!d.n || d.n.length !== need || new Set(d.n).size !== need) return `Erwartet ${need} verschiedene Zahlen`;
    if (g.kind === 'ej' && (!d.e || d.e.length !== 2)) return 'Erwartet 2 Eurozahlen';
    return null;
  }

  // ---------- Auswertung ----------
  // Liefert Liste von Treffern: {label, gk, text, amount?, fixed}. gk = Gewinnklasse (null = kein Gewinn). amount in € wenn bekannt (Zahl), sonst null.
  function evaluate(t, d) {
    const g = G[t.game], out = [];
    const push = (label, gk, text, fixed, extra) => {
      const q = gk ? quota(d, gk, fixed) : null;
      out.push(Object.assign({ label, gk: gk || null, text: text + (gk ? ' → Gewinnklasse ' + gk + (q ? ' · ' + q : '') : ''), amount: gk ? (num(q) ?? null) : null, hits: null }, extra));
    };
    if (g.kind === 'lotto') {
      (t.tips || []).forEach((tp, i) => {
        const h = inter(tp.n, d.n).length, sz = t.sz !== '' && t.sz != null && String(t.sz) === String(d.sz);
        push('Tipp ' + (i + 1), LOTTO_GK[h + (sz ? 't' : 'f')], h + ' Richtige' + (sz ? ' + Superzahl' : ''), FIXED.lotto, { hits: h, sz });
      });
      if (t.spiel77 && d.spiel77) { const m = sufMatch(t.los, d.spiel77); push('Spiel 77', m ? 8 - m : null, m ? m + ' Endziffern richtig' : 'kein Treffer', FIXED.spiel77); }
      if (t.super6 && d.super6) { const m = sufMatch(t.los, d.super6); push('SUPER 6', m ? 7 - m : null, m ? m + ' Endziffern richtig' : 'kein Treffer', FIXED.super6); }
    } else if (g.kind === 'ej') {
      (t.tips || []).forEach((tp, i) => { const h = inter(tp.n, d.n).length, e = inter(tp.e, d.e).length; push('Tipp ' + (i + 1), EJ_GK['' + h + e], h + ' + ' + e + ' Richtige', null, { hits: h, ehits: e }); });
    } else if (g.kind === 'keno') {
      const stake = +t.stake > 0 && (t.tips || []).length ? +t.stake / t.tips.length : 1;
      (t.tips || []).forEach((tp, i) => {
        const typ = tp.n.length, h = inter(tp.n, d.n).length, f = (KENO_PLAN[typ] || {})[h];
        const amt = f != null ? f * stake : null;
        out.push({ label: 'Tipp ' + (i + 1) + ' (Typ ' + typ + ')', gk: f != null ? h : null, hits: h, amount: amt, text: h + ' Treffer' + (f != null ? ' → ' + f + '-facher Einsatz · ' + euro(amt) : '') });
      });
      if (t.plus5 && d.plus5) { const m = sufMatch(t.los, d.plus5); push('plus 5', m ? 6 - m : null, m ? m + ' Endziffern richtig' : 'kein Treffer', FIXED.plus5); }
    } else {
      let best = 0, bw = ''; (d.wins || []).forEach(w => { const m = sufMatch(t.los, w); if (m > best) { best = m; bw = w; } });
      push('Los ' + t.los, best || null, best ? best + ' Endziffern stimmen mit ' + bw + ' überein' : 'kein Treffer', g.id === 'gs' ? FIXED.gs : null);
    }
    return out;
  }
  const won = hits => hits.some(h => h.gk);
  const winnings = hits => hits.reduce((a, h) => a + (h.amount || 0), 0);
  // Gewinnhöhe, ab der eine Nachricht mit "GEWINN" beginnt
  function isBigWin(hits, gameId) {
    const kind = (G[gameId] || {}).kind;
    return hits.some(h => h.gk && ((h.label.startsWith('Tipp') && ((kind === 'lotto' && h.gk <= 6) || (kind === 'ej' && h.gk <= 8))) || (h.amount || 0) >= 100));
  }

  // ---------- Termine ----------
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function nextDraw(g, from) { // nächster Ziehungstag (YYYY-MM-DD) ab Zeitpunkt from; am Ziehungstag selbst nur bis Annahmeschluss
    const d = new Date(from || Date.now());
    for (let i = 0; i < 8; i++) {
      const t = new Date(d); t.setDate(d.getDate() + i);
      const dow = t.getDay(); if (!g.days.includes(dow)) continue;
      if (i === 0) { const c = cutoff(g.id, dow) || '18:00'; const [hh, mm] = c.split(':').map(Number); if (d.getHours() * 60 + d.getMinutes() >= hh * 60 + mm) continue; }
      return iso(t);
    }
    return iso(d);
  }
  function claimDeadline(g, drawDate) { const d = new Date(drawDate + 'T12:00'); d.setDate(d.getDate() + 7 * (g.claimWeeks || 13)); return iso(d); }

  // ---------- Statistik ----------
  function stats(tickets, results) {
    const by = {};
    tickets.forEach(t => { const b = by[t.game] || (by[t.game] = { game: t.game, tickets: 0, stake: 0, checked: 0, wins: 0, won: 0, unknown: 0 }); b.tickets++; b.stake += +t.stake || 0; });
    results.forEach(r => { const t = tickets.find(x => x.id === r.ticket); if (!t) return; const b = by[t.game]; b.checked++; if (r.won) { b.wins++; const w = winnings(r.hits); if (w) b.won += w; else b.unknown++; } });
    const all = Object.values(by).reduce((a, b) => ({ tickets: a.tickets + b.tickets, stake: a.stake + b.stake, checked: a.checked + b.checked, wins: a.wins + b.wins, won: a.won + b.won, unknown: a.unknown + b.unknown }), { tickets: 0, stake: 0, checked: 0, wins: 0, won: 0, unknown: 0 });
    return { byGame: Object.values(by), all, roi: all.stake ? (all.won - all.stake) / all.stake : null };
  }

  // ---------- Gewinnplan mit Chancen ----------
  const ODDS = {
    lotto: { 1: 139838160, 2: 15537573, 3: 542008, 4: 60223, 5: 10324, 6: 1147, 7: 567, 8: 63, 9: 76 },
    ej: { 1: 139838160, 2: 6991908, 3: 3107515, 4: 621503, 5: 31075, 6: 14125, 7: 13811, 8: 985, 9: 706, 10: 314, 11: 188, 12: 49 },
  };
  const LOTTO_COND = { 1: '6 Richtige + Superzahl', 2: '6 Richtige', 3: '5 Richtige + SZ', 4: '5 Richtige', 5: '4 Richtige + SZ', 6: '4 Richtige', 7: '3 Richtige + SZ', 8: '3 Richtige', 9: '2 Richtige + SZ' };
  const EJ_COND = { 1: '5 + 2', 2: '5 + 1', 3: '5 + 0', 4: '4 + 2', 5: '4 + 1', 6: '3 + 2', 7: '4 + 0', 8: '2 + 2', 9: '3 + 1', 10: '3 + 0', 11: '1 + 2', 12: '2 + 1' };
  const fmtOdds = n => '1 : ' + Math.round(n).toLocaleString('de-DE');
  // rows: {gk, cond, odds, amount (Text), fixed (bool)} – amount aus fester Quote, sonst aus der letzten Ziehung (lastDraw.quoten)
  function gewinnplan(gameId, lastDraw, jackpot) {
    const g = G[gameId]; if (!g) return [];
    const q = (lastDraw && lastDraw.quoten) || {};
    const rows = [];
    if (g.kind === 'lotto') for (let k = 1; k <= 9; k++) rows.push({ gk: k, cond: LOTTO_COND[k], odds: fmtOdds(ODDS.lotto[k]), amount: k === 1 && jackpot ? jackpot + ' (Jackpot)' : FIXED.lotto[k] != null ? euro(FIXED.lotto[k]) : q[k] ? q[k] + ' (zuletzt)' : 'variabel', fixed: FIXED.lotto[k] != null });
    else if (g.kind === 'ej') for (let k = 1; k <= 12; k++) rows.push({ gk: k, cond: EJ_COND[k] + ' Richtige', odds: fmtOdds(ODDS.ej[k]), amount: k === 1 && jackpot ? jackpot + ' (Jackpot)' : q[k] ? q[k] + ' (zuletzt)' : 'variabel', fixed: false });
    else if (g.kind === 'keno') for (let typ = 10; typ >= 2; typ--) rows.push({ gk: typ, cond: 'Typ ' + typ, odds: Object.entries(KENO_PLAN[typ]).sort((a, b) => b[0] - a[0]).map(([h, f]) => h + ' Treffer: ' + f + '×').join(', '), amount: 'bis ' + euro(KENO_PLAN[typ][typ] * 10) + ' (10 € Einsatz)', fixed: true });
    else if (g.id === 'gs') for (let k = 7; k >= 1; k--) rows.push({ gk: k, cond: k + ' Endziffer' + (k > 1 ? 'n' : ''), odds: fmtOdds(Math.pow(10, k) / (k >= 6 ? 2 : 1)), amount: typeof FIXED.gs[k] === 'number' ? euro(FIXED.gs[k]) : FIXED.gs[k], fixed: true });
    return rows;
  }
  const EXTRA_PLAN = {
    spiel77: Object.entries(FIXED.spiel77).map(([k, v]) => ({ gk: +k, cond: (8 - k) + ' Endziffer' + (8 - k > 1 ? 'n' : ''), odds: fmtOdds(Math.pow(10, 8 - k)), amount: k === '1' ? euro(v) + ' + Jackpot' : euro(v), fixed: true })),
    super6: Object.entries(FIXED.super6).map(([k, v]) => ({ gk: +k, cond: (7 - k) + ' Endziffer' + (7 - k > 1 ? 'n' : ''), odds: fmtOdds(Math.pow(10, 7 - k)), amount: euro(v), fixed: true })),
    plus5: Object.entries(FIXED.plus5).map(([k, v]) => ({ gk: +k, cond: (6 - k) + ' Endziffer' + (6 - k > 1 ? 'n' : ''), odds: fmtOdds(Math.pow(10, 6 - k)), amount: euro(v), fixed: true })),
  };
  // Höchstmöglicher Gewinn eines Scheins als Text
  function maxWin(t, jackpots) {
    const g = G[t.game]; const jp = jackpots && jackpots[t.game];
    if (g.kind === 'lotto' || g.kind === 'ej') return jp ? jp : 'Jackpot';
    if (g.kind === 'keno') { const typ = Math.max(...(t.tips || []).map(x => x.n.length), 2); const stake = +t.stake > 0 && t.tips.length ? +t.stake / t.tips.length : 1; return euro(KENO_PLAN[typ][typ] * stake); }
    if (g.id === 'gs') return FIXED.gs[7];
    return 'je nach Gewinnklasse';
  }

  return { GAMES, G, CUTOFF, cutoff, KENO_PLAN, FIXED, ODDS, evaluate, won, winnings, isBigWin, validateTicket, validateDraw, nextDraw, claimDeadline, stats, sufMatch, iso, euro, gewinnplan, EXTRA_PLAN, maxWin };
});

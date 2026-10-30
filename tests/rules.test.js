const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../public/rules.js');

const lottoDraw = { game: 'lotto', date: '2026-10-28', n: [3, 11, 19, 27, 34, 42], sz: '7', spiel77: '1234567', super6: '654321', quoten: { 8: '11,80 €', 7: '24,50 €' } };
const tip = (n, extra) => Object.assign({ game: 'lotto', date: '2026-10-28', tips: [{ n, e: [] }], sz: '', los: '', stake: 1.2 }, extra);

test('LOTTO: alle 9 Gewinnklassen', () => {
  const cases = [
    [[3, 11, 19, 27, 34, 42], '7', 1], [[3, 11, 19, 27, 34, 42], '0', 2],
    [[3, 11, 19, 27, 34, 1], '7', 3], [[3, 11, 19, 27, 34, 1], '0', 4],
    [[3, 11, 19, 27, 1, 2], '7', 5], [[3, 11, 19, 27, 1, 2], '0', 6],
    [[3, 11, 19, 1, 2, 4], '7', 7], [[3, 11, 19, 1, 2, 4], '0', 8],
    [[3, 11, 1, 2, 4, 5], '7', 9], [[3, 11, 1, 2, 4, 5], '0', null], [[1, 2, 4, 5, 6, 7], '7', null],
  ];
  for (const [n, sz, gk] of cases) {
    const h = R.evaluate(tip(n, { sz }), lottoDraw);
    assert.equal(h[0].gk, gk, `Tipp ${n} SZ ${sz}`);
  }
});

test('LOTTO: Quote aus Ziehung, feste Quote GK9, Superzahl aus Losnummer', () => {
  assert.match(R.evaluate(tip([3, 11, 19, 1, 2, 4], { sz: '0' }), lottoDraw)[0].text, /11,80 €/);
  const gk9 = R.evaluate(tip([3, 11, 1, 2, 4, 5], { sz: '7' }), lottoDraw)[0];
  assert.equal(gk9.amount, 6);
  assert.equal(R.evaluate(tip([3, 11, 1, 2, 4, 5], { sz: '' }), lottoDraw)[0].gk, null);
});

test('Spiel 77 und SUPER 6: Endziffern → Gewinnklasse und feste Quote', () => {
  const h = R.evaluate(tip([1, 2, 4, 5, 6, 8], { los: '9994567', spiel77: true, super6: true }), lottoDraw);
  const s77 = h.find(x => x.label === 'Spiel 77'), s6 = h.find(x => x.label === 'SUPER 6');
  assert.equal(s77.gk, 4); assert.equal(s77.amount, 777);
  assert.equal(s6.gk, null);
  const full = R.evaluate(tip([1, 2, 4, 5, 6, 8], { los: '1234567', spiel77: true }), lottoDraw).find(x => x.label === 'Spiel 77');
  assert.equal(full.gk, 1); assert.equal(full.amount, 177777);
});

test('Eurojackpot: 12 Gewinnklassen', () => {
  const d = { game: 'ej', date: '2026-10-30', n: [1, 2, 3, 4, 5], e: [6, 7] };
  const t = (n, e) => ({ game: 'ej', date: '2026-10-30', tips: [{ n, e }] });
  const exp = { '52': 1, '51': 2, '50': 3, '42': 4, '41': 5, '32': 6, '40': 7, '22': 8, '31': 9, '30': 10, '12': 11, '21': 12, '20': null, '11': null, '02': null };
  for (const [k, gk] of Object.entries(exp)) {
    const h = +k[0], e = +k[1];
    const n = [...d.n.slice(0, h), ...[10, 20, 30, 40, 50].slice(0, 5 - h)];
    const ez = [...d.e.slice(0, e), ...[11, 12].slice(0, 2 - e)];
    assert.equal(R.evaluate(t(n, ez), d)[0].gk, gk, `EJ ${k}`);
  }
});

test('KENO: Gewinnplan je Typ, 0 Treffer bei Typ 8–10, Einsatz-Multiplikator', () => {
  const d = { game: 'keno', date: '2026-10-30', n: Array.from({ length: 20 }, (_, i) => i + 1), plus5: '12345' };
  const k = (n, stake) => ({ game: 'keno', date: d.date, tips: [{ n, e: [] }], stake, los: '' });
  assert.equal(R.evaluate(k([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 1), d)[0].amount, 100000);
  assert.equal(R.evaluate(k([51, 52, 53, 54, 55, 56, 57, 58, 59, 60], 2), d)[0].amount, 4); // 0 Treffer Typ 10 = 2x
  assert.equal(R.evaluate(k([51, 52, 53, 54, 55, 56, 57], 1), d)[0].gk, null); // Typ 7: 0 Treffer = nichts
  assert.equal(R.evaluate(k([1, 2, 60], 5), d)[0].amount, 5); // Typ 3, 2 Treffer = 1x
  assert.equal(R.evaluate(k([1, 60], 10), d)[0].gk, null); // Typ 2, 1 Treffer
  const p5 = R.evaluate(Object.assign(k([1, 60], 1), { los: '0092345', plus5: true }), d).find(x => x.label === 'plus 5');
  assert.equal(p5.gk, 2); assert.equal(p5.amount, 500); // 4 Endziffern 2345
});

test('Losnummern-Lotterien: längste Endziffern-Übereinstimmung', () => {
  const d = { game: 'gs', date: '2026-10-31', wins: ['7', '34', '912', '4458', '56521', '2837714'] };
  const g = los => R.evaluate({ game: 'gs', date: d.date, los }, d)[0];
  assert.equal(g('1234567').gk, 1); assert.equal(g('1234567').amount, 10);
  assert.equal(g('2837714').gk, 7); assert.match(g('2837714').text, /Sofortrente/);
  assert.equal(g('0004458').gk, 4); assert.equal(g('0004458').amount, 1000);
  assert.equal(g('1234560').gk, null);
  assert.equal(R.evaluate({ game: 'fl', date: d.date, los: '555555' }, { game: 'fl', date: d.date, wins: ['12355'] })[0].gk, 2);
});

test('Validierung von Scheinen und Ziehungen', () => {
  assert.equal(R.validateTicket(tip([3, 11, 19, 27, 34, 42], { sz: '7' })), null);
  assert.match(R.validateTicket(tip([3, 11, 19, 27, 34])), /genau 6/);
  assert.match(R.validateTicket(tip([3, 3, 19, 27, 34, 42])), /Doppelte/);
  assert.match(R.validateTicket(tip([3, 11, 19, 27, 34, 50])), /1–49/);
  assert.match(R.validateTicket({ game: 'ej', date: '2026-10-30', tips: [{ n: [1, 2, 3, 4, 5], e: [13, 1] }] }), /Eurozahlen/);
  assert.match(R.validateTicket({ game: 'gs', date: '2026-10-31', los: '12' }), /Losnummer/);
  assert.equal(R.validateDraw(lottoDraw), null);
  assert.match(R.validateDraw({ game: 'lotto', n: [1, 2, 3, 4, 5, 5] }), /6 verschiedene/);
});

test('Termine: nächste Ziehung, Annahmeschluss, Abholfrist', () => {
  const lotto = R.G.lotto;
  assert.equal(R.nextDraw(lotto, new Date('2026-10-30T12:00')), '2026-10-31'); // Freitag → Samstag
  assert.equal(R.nextDraw(lotto, new Date('2026-10-31T12:00')), '2026-10-31'); // Samstag vor Annahmeschluss
  assert.equal(R.nextDraw(lotto, new Date('2026-10-31T19:00')), '2026-11-04'); // Samstag nach Annahmeschluss → Mittwoch
  assert.equal(R.nextDraw(R.G.ej, new Date('2026-10-30T20:00')), '2026-11-03'); // Freitag nach 19:00 → Dienstag
  assert.equal(R.cutoff('lotto', 6, 'BY'), '19:00'); assert.equal(R.cutoff('lotto', 6, 'XX'), '18:45');
  assert.equal(R.claimDeadline(lotto, '2026-10-31'), '2027-01-30');
});

test('Statistik und Gewinnmeldung', () => {
  const tickets = [tip([3, 11, 19, 1, 2, 4], { id: 'a', sz: '7' }), tip([1, 2, 4, 5, 6, 8], { id: 'b' })];
  const results = tickets.map(t => { const hits = R.evaluate(t, lottoDraw); return { ticket: t.id, hits, won: R.won(hits) }; });
  const s = R.stats(tickets, results);
  assert.equal(s.all.tickets, 2); assert.equal(s.all.wins, 1); assert.equal(s.all.won, 24.5); assert.equal(s.all.stake, 2.4);
  assert.equal(R.isBigWin(results[0].hits, 'lotto'), false);
  assert.equal(R.isBigWin(R.evaluate(tip([3, 11, 19, 27, 1, 2], { sz: '0' }), lottoDraw), 'lotto'), true);
});

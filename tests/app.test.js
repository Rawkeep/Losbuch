// Smoke-Test der App im jsdom: Onboarding → lokal → Schein → Ziehung → Ergebnis
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
require('fake-indexeddb/auto');
const { JSDOM } = require('jsdom');

async function boot() {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8').replace(/<script src="[^"]+"><\/script>/g, '').replace(/<link rel="stylesheet"[^>]*>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.indexedDB = globalThis.indexedDB; w.IDBKeyRange = globalThis.IDBKeyRange;
  w.fetch = async () => { throw new Error('offline'); };
  w.scrollTo = () => {};
  w.eval(fs.readFileSync(path.join(__dirname, '../public/rules.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8'));
  await new Promise(r => setTimeout(r, 150));
  return w;
}
const click = (w, id) => w.document.getElementById(id).click();
const tick = ms => new Promise(r => setTimeout(r, ms || 60));

test('App: Onboarding, Schein, Ziehung, Ergebnis, Bilanz', async () => {
  const w = await boot(), d = w.document;
  assert.match(d.getElementById('view').textContent, /Willkommen bei Losbuch/);
  click(w, 'obLocal'); await tick();
  assert.match(d.getElementById('view').textContent, /Was ansteht/);
  w.location.hash = '#scheine'; w.dispatchEvent(new w.Event('hashchange')); await tick();
  d.getElementById('fGame').value = 'lotto'; d.getElementById('fGame').dispatchEvent(new w.Event('change'));
  d.getElementById('fDate').value = '2026-10-31'; d.getElementById('fStake').value = '1.2';
  d.getElementById('fTips').value = '3 11 19 1 2 4'; d.getElementById('fSz').value = '7';
  click(w, 'fSave'); await tick(150);
  assert.match(d.getElementById('view').textContent, /Schein gespeichert/.test(d.getElementById('toast').textContent) ? /Meine Scheine/ : /Meine Scheine/);
  assert.equal(d.querySelectorAll('[data-del]').length, 1);
  w.location.hash = '#ziehungen'; w.dispatchEvent(new w.Event('hashchange')); await tick();
  d.getElementById('dGame').value = 'lotto'; d.getElementById('dGame').dispatchEvent(new w.Event('change'));
  d.getElementById('dDate').value = '2026-10-31'; d.getElementById('dNums').value = '3 11 19 27 34 42'; d.getElementById('dSz').value = '7';
  click(w, 'dSave'); await tick(200);
  assert.equal(w.location.hash, '#heute');
  const txt = d.getElementById('view').textContent;
  assert.match(txt, /Neue Ergebnisse/); assert.match(txt, /3 Richtige \+ Superzahl → Gewinnklasse 7/); assert.match(txt, /Gewinne einlösen/);
  assert.equal(d.querySelectorAll('.ball.hit').length, 3);
  w.location.hash = '#statistik'; w.dispatchEvent(new w.Event('hashchange')); await tick();
  assert.match(d.getElementById('view').textContent, /1,20 €/);
  // Dauerschein: 4 Ziehungen → 4 Scheine
  w.location.hash = '#scheine'; w.dispatchEvent(new w.Event('hashchange')); await tick();
  d.getElementById('fGame').value = 'ej'; d.getElementById('fGame').dispatchEvent(new w.Event('change'));
  d.getElementById('fDate').value = '2026-11-03'; d.getElementById('fTips').value = '1 2 3 4 5 | 6 7'; d.getElementById('fWeeks').value = '4';
  click(w, 'fSave'); await tick(150);
  assert.equal(d.querySelectorAll('[data-del]').length, 5);
  const dates = [...d.querySelectorAll('.card .muted')].map(e => e.textContent).join(' ');
  assert.match(dates, /03\.11\.2026/); assert.match(dates, /06\.11\.2026/); assert.match(dates, /10\.11\.2026/); assert.match(dates, /13\.11\.2026/);
});

test('Scan: Zahlen aus OCR-Text je Spiel', async () => {
  const w = await boot();
  // numbersFromText ist privat – über das Fenster erreichbar machen
  const src = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const fn = src.match(/function numbersFromText[\s\S]*?\n}\n/)[0];
  const f = new Function('G', fn + '; return numbersFromText;')(w.LosbuchRules.G);
  const lotto = f('LOTTO 6aus49  Mittwoch 28.10.2026\n1  03 11 19 27 34 42\n2  05 08 13 21 30 47\nLosnummer 1234567\nSpiel 77  Super 6', 'lotto');
  assert.equal(lotto.tips.length, 2); assert.deepEqual(lotto.tips[1].n, [5, 8, 13, 21, 30, 47]); assert.equal(lotto.los, '1234567'); assert.equal(lotto.sz, '7');
  const ej = f('1  03 17 22 38 45  04 09', 'ej'); assert.deepEqual(ej.tips[0], { n: [3, 17, 22, 38, 45], e: [4, 9] });
  const keno = f('Typ 8  5 12 19 27 33 41 56 68', 'keno'); assert.equal(keno.tips[0].n.length, 8);
});

test('Tippfeld: Zahlen antippen, Reihe hinzufügen, speichern', async () => {
  const w = await boot(), d = w.document;
  if (d.getElementById('obLocal')) { click(w, 'obLocal'); await tick(); }
  w.location.hash = '#scheine'; w.dispatchEvent(new w.Event('hashchange')); await tick();
  d.getElementById('fGame').value = 'ej'; d.getElementById('fGame').dispatchEvent(new w.Event('change')); await tick();
  for (const n of [3, 17, 22, 38, 45]) d.querySelector(`[data-pk="n:${n}"]`).click();
  for (const n of [4, 9]) d.querySelector(`[data-pk="e:${n}"]`).click();
  assert.equal(d.querySelectorAll('.grid .ball.hit').length, 7);
  d.querySelector('[data-pkact="add"]').click(); await tick();
  d.querySelector('[data-pkact="quick"]').click(); await tick();
  assert.equal(d.querySelectorAll('.pkrow').length, 2);
  assert.match(d.getElementById('fTips').value, /^3 17 22 38 45 \| 4 9\n\d/);
  d.getElementById('fDate').value = '2026-11-03'; d.getElementById('fLabel').value = 'PK-Test';
  click(w, 'fSave'); await tick(150);
  const card = [...d.querySelectorAll('#view .card')].find(c => c.textContent.includes('PK-Test'));
  assert.equal(card.querySelectorAll('.balls').length, 2);
  // Nochmal spielen übernimmt die Zahlen
  card.querySelector('[data-repeat]').click(); await tick(150);
  assert.match(d.getElementById('fTips').value, /^3 17 22 38 45 \| 4 9/);
});

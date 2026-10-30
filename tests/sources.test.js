const test = require('node:test');
const assert = require('node:assert/strict');

test('Parser: LOTTO-Seite als Text', async () => {
  const { parseDraw, htmlToText } = await import('../src/sources.js');
  const html = `<html><body><h1>Lottozahlen</h1><div class="draw"><h2>Samstag, 31. Oktober 2026</h2>
  <ul><li>3</li><li>11</li><li>19</li><li>27</li><li>34</li><li>42</li></ul><p>Superzahl 7</p>
  <p>Spiel 77: 1234567</p><p>Super 6: 654321</p>
  <table><tr><td>Klasse 1</td><td>6 Richtige + SZ</td><td>unbesetzt</td></tr><tr><td>Klasse 2</td><td>6 Richtige</td><td>1.234.567,80 €</td></tr><tr><td>Klasse 9</td><td>2 + SZ</td><td>6,00 €</td></tr></table>
  <p>Jackpot am Mittwoch: 18 Mio. €</p></div>
  <div>Mittwoch, 28.10.2026: 1 2 3 4 5 6 Superzahl 0</div></body></html>`;
  const d = parseDraw('lotto', htmlToText(html), '2026-10-31');
  assert.deepEqual(d.n, [3, 11, 19, 27, 34, 42]); assert.equal(d.sz, '7'); assert.equal(d.spiel77, '1234567'); assert.equal(d.super6, '654321');
  assert.equal(d.quoten[2], '1.234.567,80 €'); assert.equal(d.quoten[1], 'unbesetzt'); assert.match(d.jackpot, /18 Mio/);
  const d2 = parseDraw('lotto', htmlToText(html), '2026-10-28');
  assert.deepEqual(d2.n, [1, 2, 3, 4, 5, 6]); assert.equal(d2.sz, '0');
  assert.equal(parseDraw('lotto', htmlToText(html), '2026-10-24'), null);
});

test('Parser: Eurojackpot und KENO', async () => {
  const { parseDraw } = await import('../src/sources.js');
  const ej = parseDraw('ej', 'Gewinnzahlen Freitag, 30.10.2026\n5 17 22 38 45\nEurozahlen 4 9\nGewinnklasse 1 5+2 Jackpot\nJackpot nächste Ziehung 120 Mio. €', '2026-10-30');
  assert.deepEqual(ej.n, [5, 17, 22, 38, 45]); assert.deepEqual(ej.e, [4, 9]); assert.equal(ej.quoten[1], 'Jackpot');
  const k = parseDraw('keno', 'KENO Ziehung vom 30.10.2026\n' + Array.from({ length: 20 }, (_, i) => (i + 1) * 3).join(' ') + '\nplus 5: 48213', '2026-10-30');
  assert.equal(k.n.length, 20); assert.equal(k.plus5, '48213');
  const gs = parseDraw('gs', 'GlücksSpirale 31.10.2026 Gewinnklasse 1: 7 Gewinnklasse 2: 34 Gewinnklasse 3: 912 Gewinnklasse 4: 4458 Gewinnklasse 5: 56521 Gewinnklasse 6: 283771 und 918273 Gewinnklasse 7: 2837714 und 9182736', '2026-10-31');
  assert.deepEqual(gs.wins, ['7', '34', '912', '4458', '56521', '283771', '918273', '2837714', '9182736']);
});

test('Web Push: Verschlüsselung ist nach RFC 8291 entschlüsselbar', async () => {
  const { sendPush, getVapid } = await import('../src/push.js');
  const b64u = buf => Buffer.from(buf).toString('base64url');
  // Empfängerseite (Browser) simulieren
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPub = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const store = {};
  const env = { DB: { prepare: sql => ({ first: async () => store.vapid ? { value: store.vapid } : null, bind: (v) => ({ run: async () => { store.vapid = v; } }) }) } };
  let captured;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { captured = init; return { status: 201, ok: true }; };
  const res = await sendPush(env, { endpoint: 'https://push.example.org/send/abc', p256dh: b64u(uaPub), auth: b64u(auth) }, { title: 'Hallo', body: 'Welt' });
  globalThis.fetch = realFetch;
  assert.equal(res.status, 201);
  assert.match(captured.headers.authorization, /^vapid t=.+, k=.+/);
  const v = JSON.parse(store.vapid);
  assert.equal(Buffer.from(v.publicKey, 'base64url').length, 65);
  // entschlüsseln
  const body = new Uint8Array(captured.body);
  const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const hk = async (s, ikm, info, len) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), len * 8));
  const enc = new TextEncoder();
  const info = Buffer.concat([enc.encode('WebPush: info\0'), uaPub, asPub]);
  const ikm = await hk(auth, shared, info, 32);
  const cek = await hk(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16), nonce = await hk(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct));
  assert.equal(pt[pt.length - 1], 2);
  assert.deepEqual(JSON.parse(Buffer.from(pt.slice(0, -1)).toString()), { title: 'Hallo', body: 'Welt' });
});

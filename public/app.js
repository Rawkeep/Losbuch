/* Losbuch – App-Logik. Offline-first (IndexedDB), Sync über /api, Scan über Tesseract (lokal eingebettet). */
(function () {
'use strict';
const R = window.LosbuchRules, GAMES = R.GAMES, G = R.G;
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const todayIso = () => R.iso(new Date());
const fmtD = d => new Date(d + 'T12:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
const euro = v => (+v || 0).toFixed(2).replace('.', ',') + ' €';
const STATES = { BW: 'Baden-Württemberg', BY: 'Bayern', BE: 'Berlin', BB: 'Brandenburg', HB: 'Bremen', HH: 'Hamburg', HE: 'Hessen', MV: 'Mecklenburg-Vorpommern', NI: 'Niedersachsen', NW: 'Nordrhein-Westfalen', RP: 'Rheinland-Pfalz', SL: 'Saarland', SN: 'Sachsen', ST: 'Sachsen-Anhalt', SH: 'Schleswig-Holstein', TH: 'Thüringen' };
function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2200); }

// ---------- Speicher: IndexedDB mit Collections tickets/results/groups/draws + settings ----------
const COLLS = ['tickets', 'results', 'groups', 'draws'];
const S = { tickets: [], results: [], groups: [], draws: [], settings: { active: { lotto: true, ej: true }, state: '', name: '', token: '', lastSync: 0, onboarded: false, api: '', jackpots: {}, prefs: { remind: true, favorites: {}, lastStake: {}, lastGroup: '' } } };
let idb = null;
function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('losbuch', 1);
    r.onupgradeneeded = () => { const d = r.result; for (const c of COLLS) d.createObjectStore(c, { keyPath: 'id' }); d.createObjectStore('settings'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
const tx = (store, mode, fn) => new Promise((res, rej) => { if (!idb) return res(); const t = idb.transaction(store, mode); const o = t.objectStore(store); const q = fn(o); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); });
async function loadAll() {
  try { idb = await openDb(); } catch (e) { idb = null; }
  if (!idb) { try { Object.assign(S, JSON.parse(localStorage.getItem('losbuch.v3') || '{}')); } catch (e) {} return; }
  for (const c of COLLS) S[c] = (await tx(c, 'readonly', o => o.getAll())) || [];
  const st = await tx('settings', 'readonly', o => o.get('main')); if (st) Object.assign(S.settings, st);
}
async function persistSettings() { if (idb) await tx('settings', 'readwrite', o => o.put(S.settings, 'main')); else try { localStorage.setItem('losbuch.v3', JSON.stringify(S)); } catch (e) {} }
async function put(coll, obj, { local = false } = {}) { // local=true: kommt vom Server, nicht als dirty markieren
  obj.updated_at = obj.updated_at || Date.now(); if (!local) { obj.updated_at = Date.now(); obj._dirty = 1; }
  const i = S[coll].findIndex(x => x.id === obj.id); if (i >= 0) S[coll][i] = obj; else S[coll].push(obj);
  if (idb) await tx(coll, 'readwrite', o => o.put(obj)); else try { localStorage.setItem('losbuch.v3', JSON.stringify(S)); } catch (e) {}
  if (!local) scheduleSync();
}
async function del(coll, id) { const obj = S[coll].find(x => x.id === id); if (!obj) return; obj._deleted = 1; await put(coll, obj); S[coll] = S[coll].filter(x => x.id !== id); }
const live = coll => S[coll].filter(x => !x._deleted);

// ---------- Sync ----------
const API = () => (S.settings.api || '') + '/api';
let syncTimer = null, syncing = false;
function scheduleSync() { clearTimeout(syncTimer); syncTimer = setTimeout(sync, 1200); }
function setStatus(kind, text) { const el = $('status'); if (el) el.innerHTML = '<span class="dot ' + kind + '"></span>' + esc(text); }
async function sync() {
  if (!S.settings.token || syncing || !navigator.onLine) return;
  syncing = true; setStatus('busy', 'Sync…');
  try {
    const dirty = []; for (const c of ['tickets', 'results', 'groups']) for (const d of S[c]) if (d._dirty) { const { _dirty, _deleted, ...data } = d; dirty.push({ coll: c, id: d.id, data, updated_at: d.updated_at, deleted: !!_deleted }); }
    const r = await fetch(API() + '/sync?since=' + S.settings.lastSync, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + S.settings.token }, body: JSON.stringify({ docs: dirty }) });
    if (r.status === 401) { setStatus('', 'Token ungültig'); syncing = false; return; }
    const j = await r.json();
    for (const d of dirty) { const o = S[d.coll].find(x => x.id === d.id); if (o) { delete o._dirty; if (idb) await tx(d.coll, 'readwrite', s => s.put(o)); } }
    for (const d of j.docs) {
      const cur = S[d.coll].find(x => x.id === d.id);
      if (cur && cur.updated_at > d.updated_at) continue;
      if (d.deleted) { S[d.coll] = S[d.coll].filter(x => x.id !== d.id); if (idb) await tx(d.coll, 'readwrite', s => s.delete(d.id)); }
      else await put(d.coll, Object.assign({ id: d.id }, d.data, { updated_at: d.updated_at }), { local: true });
    }
    for (const d of j.draws) await put('draws', d, { local: true });
    if (j.jackpots) S.settings.jackpots = j.jackpots;
    if (j.account && j.account.updated_at > (S.settings.accountUpdated || 0)) { S.settings.active = j.account.active || S.settings.active; S.settings.state = j.account.state || S.settings.state; S.settings.name = j.account.name || S.settings.name; if (j.account.prefs && Object.keys(j.account.prefs).length) S.settings.prefs = Object.assign(S.settings.prefs, j.account.prefs); S.settings.accountUpdated = j.account.updated_at; }
    S.settings.lastSync = j.time; await persistSettings();
    setStatus('on', 'Cloud-Sync');
    const n = await runChecks(); if (n) { toast(n + ' Schein(e) geprüft'); if (live('results').some(r => !r.seen && r.won)) try { navigator.vibrate && navigator.vibrate([60, 40, 60]); } catch (e) {} }
    route(true);
  } catch (e) { setStatus('', 'offline'); }
  syncing = false;
}
async function pushAccount() { if (!S.settings.token) return; await fetch(API() + '/account', { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + S.settings.token }, body: JSON.stringify({ active: S.settings.active, state: S.settings.state, name: S.settings.name, prefs: S.settings.prefs }) }).catch(() => {}); }

// ---------- Auswertung ----------
let checking = false;
async function runChecks() {
  if (checking) return 0; checking = true; let n = 0;
  try {
    for (const d of live('draws')) for (const t of live('tickets').filter(t => t.game === d.game && t.date === d.date)) {
      const id = t.id + '_' + d.id; if (S.results.some(r => r.id === id)) continue;
      const hits = R.evaluate(t, d); await put('results', { id, ticket: t.id, draw: d.id, hits, won: R.won(hits), amount: R.winnings(hits), at: Date.now(), seen: false, claimed: false }); n++;
    }
  } finally { checking = false; }
  return n;
}

// ---------- Tipps parsen / generieren ----------
const nums = s => (String(s || '').match(/\d+/g) || []).map(Number);
const parseTips = txt => txt.split(/\n/).map(l => l.trim()).filter(Boolean).map(l => { const [a, b] = l.split('|'); return { n: nums(a), e: b ? nums(b) : [] }; });
const pick = (k, max) => { const s = new Set(); while (s.size < k) s.add(1 + Math.floor(Math.random() * max)); return [...s].sort((a, b) => a - b); };
const quick = (kind, typ) => kind === 'lotto' ? pick(6, 49).join(' ') : kind === 'ej' ? pick(5, 50).join(' ') + ' | ' + pick(2, 12).join(' ') : kind === 'keno' ? pick(typ || 8, 70).join(' ') : String(Math.floor(Math.random() * 1e7)).padStart(7, '0');

// ---------- Ansichten ----------
const V = {};
V.onboarding = () => `<div class="onb">
  <h2>Willkommen bei Losbuch</h2>
  <p class="muted" style="margin:0">Dein Begleiter für LOTTO, Eurojackpot, KENO und die Soziallotterien. Losbuch spielt nichts automatisch – es behält den Überblick: Scheine, Ziehungen, Gewinne, Fristen.</p>
  <div class="card"><h3>Neu anfangen</h3><p class="muted" style="margin:0">Erstellt ein Konto für Cloud-Sync und Push. Du bekommst einen Kopplungscode für weitere Geräte.</p>
    <label class="f">Bundesland (für Annahmeschluss)<select id="obState"><option value="">– bitte wählen –</option>${Object.entries(STATES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
    <button class="p" id="obNew">Konto anlegen</button></div>
  <div class="card"><h3>Gerät koppeln</h3><p class="muted" style="margin:0">Du hast schon ein Konto auf einem anderen Gerät? Code dort unter „Mehr → Sync“ anzeigen.</p>
    <div class="row"><input id="obToken" class="grow num" placeholder="Kopplungscode" autocomplete="off"><button id="obPair">Koppeln</button></div></div>
  <button id="obLocal">Nur lokal nutzen (ohne Sync)</button>
  <p class="hint">Teilnahme ab 18 Jahren. Glücksspiel kann süchtig machen – Hilfe: BZgA 0800 1 37 27 00 (kostenlos).</p></div>`;

V.heute = () => {
  const today = todayIso(), act = GAMES.filter(g => S.settings.active[g.id]);
  const unseen = live('results').filter(r => !r.seen).sort((a, b) => b.at - a.at);
  const claims = live('results').filter(r => r.won && !r.claimed);
  const due = live('tickets').filter(t => t.date <= today && !live('draws').some(d => d.game === t.game && d.date === t.date));
  const dueKeys = [...new Set(due.map(t => t.game + '|' + t.date))];
  const open = live('tickets').filter(t => t.date > today);
  let h = '';
  if (unseen.length) h += `<h2>Neue Ergebnisse <small>${unseen.length}</small></h2><div class="stack">${unseen.map(resCard).join('')}</div><div class="row" style="margin-top:8px"><button class="s" id="markseen">Alle als gelesen markieren</button></div>`;
  if (claims.length) h += `<h2>Gewinne einlösen <small>${claims.length}</small></h2><div class="stack">${claims.map(r => { const t = S.tickets.find(x => x.id === r.ticket), d = S.draws.find(x => x.id === r.draw); if (!t || !d) return ''; const dl = R.claimDeadline(G[t.game], d.date), days = Math.round((new Date(dl + 'T12:00') - new Date(today + 'T12:00')) / 864e5);
    return `<div class="card win"><div class="row"><span class="pill gold">${r.amount ? euro(r.amount) : 'Gewinn'}</span><b>${G[t.game].name}</b><span class="muted">${fmtD(d.date)}</span><span class="grow"></span><span class="pill ${days < 14 ? 'due' : ''}">${days < 0 ? 'Frist abgelaufen' : 'noch ' + days + ' Tage'}</span></div><div class="muted">Beim Anbieter vorlegen bis ${fmtD(dl)} (Spielquittung aufbewahren).</div><div><button class="s" data-claim="${r.id}">Eingelöst ✓</button></div></div>`; }).join('')}</div>`;
  h += '<h2>Was ansteht</h2><div class="stack">';
  if (dueKeys.length) h += dueKeys.map(k => { const [g, d] = k.split('|'); return `<div class="card"><div class="row"><span class="pill due">Ergebnis fehlt</span><b>${G[g].name}</b><span class="muted">${fmtD(d)}</span></div><div class="muted">${due.filter(t => t.game + '|' + t.date === k).length} Schein(e) warten. ${S.settings.token ? 'Der Abend-Check holt die Zahlen automatisch – oder jetzt:' : 'Zahlen eintragen:'}</div><div class="row"><a class="btn" href="#ziehungen">Ergebnis eintragen</a>${S.settings.token ? '<button class="s" id="fetchNow">Jetzt abrufen</button>' : ''}</div></div>`; }).join('');
  if (!act.length) h += '<div class="empty">Noch kein Spiel abonniert. Unter <a href="#spiele">Spiele</a> ankreuzen, was dich interessiert.</div>';
  h += act.map(g => { const nd = R.nextDraw(g), cnt = open.filter(t => t.game === g.id && t.date === nd).length, days = Math.round((new Date(nd + 'T12:00') - new Date(today + 'T12:00')) / 864e5);
    const dow = new Date(nd + 'T12:00').getDay(), cut = R.cutoff(g.id, dow, S.settings.state);
    const last = live('draws').filter(d => d.game === g.id).sort((a, b) => b.date.localeCompare(a.date))[0];
    const jp = jackpotOf(g.id, last);
    const lastT = live('tickets').filter(t => t.game === g.id).sort((a, b) => b.date.localeCompare(a.date))[0];
    return `<div class="card"><div class="row"><b>${g.name}</b><span class="pill">${days === 0 ? 'heute' : days === 1 ? 'morgen' : 'in ' + days + ' Tagen'}</span><span class="grow"></span><span class="muted">${fmtD(nd)} · ${g.drawTime[dow] || g.drawTime.all}</span></div>
      ${jp ? `<div class="jp"><span class="jpv">${esc(jp)}</span><span class="jpl">im Jackpot</span></div>` : ''}
      <div class="row"><span class="muted">${cnt ? cnt + ' Schein(e) für diese Ziehung' : 'Noch kein Schein für diese Ziehung'}${cut ? ' · Annahmeschluss ' + cut : ''}</span><span class="grow"></span>${lastT && !cnt ? `<button class="s" data-repeat="${lastT.id}">↻ Wie zuletzt</button>` : ''}<a class="btn ${cnt ? '' : 'p'}" href="#scheine" data-new="${g.id}">+ Schein</a></div></div>`; }).join('');
  h += '</div>';
  const st = R.stats(live('tickets'), live('results'));
  h += `<h2>Bilanz</h2><div class="tiles"><div class="tile"><div class="v">${st.all.tickets}</div><div class="l">Scheine</div></div><div class="tile"><div class="v">${st.all.wins}</div><div class="l">Gewinne</div></div><div class="tile"><div class="v num">${euro(st.all.won)}</div><div class="l">Gewonnen</div></div><div class="tile"><div class="v num">${euro(st.all.stake)}</div><div class="l">Einsatz</div></div></div>`;
  return h;
};
function jackpotOf(gameId, lastDraw) { const j = S.settings.jackpots && S.settings.jackpots[gameId]; if (j && j.amount) return j.amount; return lastDraw && lastDraw.jackpot ? lastDraw.jackpot : ''; }
function ticker() { const parts = ['ej', 'lotto'].map(id => { const j = jackpotOf(id, live('draws').filter(d => d.game === id).sort((a, b) => b.date.localeCompare(a.date))[0]); return j ? (id === 'ej' ? 'EJ ' : 'Lotto ') + j.replace(' Mio. €', ' Mio.') : ''; }).filter(Boolean); const el = document.querySelector('header .sub'); if (el) el.textContent = parts.length ? parts.join(' · ') + ' im Jackpot' : 'Lotterie-Begleiter · Deutschland'; }
function resCard(r) {
  const t = S.tickets.find(x => x.id === r.ticket), d = S.draws.find(x => x.id === r.draw); if (!t || !d) return '';
  const grp = t.group && live('groups').find(g => g.id === t.group);
  return `<div class="card ${r.won ? 'win' : ''}"><div class="row"><span class="pill ${r.won ? 'win' : ''}">${r.won ? (r.amount ? euro(r.amount) : 'Gewinn') : 'Kein Gewinn'}</span><b>${G[t.game].name}</b><span class="muted">${fmtD(d.date)}</span>${t.label ? '<span class="muted">· ' + esc(t.label) + '</span>' : ''}</div>${tipHtml(t, r)}
  ${r.hits.map(x => `<div class="row"><span class="muted" style="min-width:90px">${esc(x.label)}</span><span>${esc(x.text)}</span></div>`).join('')}
  ${grp && r.won ? '<div class="muted">' + shareText(grp, r.amount) + '</div>' : ''}
  <div class="row">${r.won ? '<span class="hint grow">Quote beim Anbieter gegenprüfen; Frist siehe „Gewinne einlösen“.</span>' : '<span class="grow"></span>'}<button class="s" data-share="${r.id}">Teilen</button></div></div>`;
}
function shareResult(r) {
  const t = S.tickets.find(x => x.id === r.ticket), d = S.draws.find(x => x.id === r.draw); if (!t || !d) return;
  const text = `${G[t.game].name} ${fmtD(d.date)}: ${r.hits.map(h => h.text).join('; ')}${r.amount ? ' – ' + euro(r.amount) : ''} (Losbuch)`;
  if (navigator.share) navigator.share({ title: 'Losbuch', text }).catch(() => {}); else navigator.clipboard.writeText(text).then(() => toast('In die Zwischenablage kopiert')).catch(() => toast(text));
}
function shareText(grp, amount) { const tot = grp.members.reduce((a, m) => a + (+m.share || 0), 0) || 1; return 'Tippgemeinschaft ' + esc(grp.name) + ': ' + grp.members.map(m => esc(m.name) + ' ' + (amount ? euro(amount * (+m.share || 0) / tot) : Math.round(100 * (+m.share || 0) / tot) + ' %')).join(' · '); }
function tipHtml(t, r) {
  const g = G[t.game], d = r && S.draws.find(x => x.id === r.draw); let h = '';
  if (g.kind === 'suffix') return `<div class="row"><span class="muted">Losnummer</span><span class="num" style="font-size:18px;letter-spacing:.12em">${esc(t.los)}</span></div>`;
  h += (t.tips || []).map(tp => `<div class="balls">${tp.n.map(n => `<span class="ball${d && (d.n || []).includes(n) ? ' hit' : ''}">${n}</span>`).join('')}${tp.e && tp.e.length ? '<span class="muted">+</span>' + tp.e.map(n => `<span class="ball sz${d && (d.e || []).includes(n) ? ' hit' : ''}">${n}</span>`).join('') : ''}</div>`).join('');
  const ex = []; if (g.kind === 'lotto') { if (t.sz !== '' && t.sz != null) ex.push('Superzahl ' + t.sz); if (t.spiel77) ex.push('Spiel 77'); if (t.super6) ex.push('SUPER 6'); } if (g.kind === 'keno' && t.plus5) ex.push('plus 5'); if (t.los) ex.push('Losnr. ' + t.los);
  return h + (ex.length ? '<div class="muted num">' + esc(ex.join(' · ')) + '</div>' : '');
}

V.spiele = () => `<h2>Welche Spiele begleite ich?</h2><div class="stack">${GAMES.map(g => `<div class="card"><div class="game"><label class="check" aria-label="${g.name} abonnieren"><input type="checkbox" data-act="${g.id}" ${S.settings.active[g.id] ? 'checked' : ''}></label><div><h3>${g.name}</h3><div class="sched">${g.days.length === 7 ? 'täglich' : g.days.map(d => ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d]).join(' & ')} · ${Object.values(g.drawTime).join(' / ')} · ${g.priceLabel}</div></div><span class="pill">${g.kind === 'suffix' ? 'Losnummer' : 'Zahlenlotto'}</span></div><div class="muted">${g.rule}${g.extras.length ? ' Zusatz: ' + g.extras.join(', ') + '.' : ''}</div>${planHtml(g)}</div>`).join('')}</div>
  <p class="hint">Jackpot-Alarm: Für abonnierte Spiele meldet der Abend-Check Jackpots ab 50 Mio. €, wenn du noch keinen Schein hast. Annahmeschluss richtet sich nach deinem Bundesland (Mehr → Einstellungen).</p>
  <h2>Tippgemeinschaften</h2><div class="stack">${live('groups').map(g => `<div class="card"><div class="row"><b>${esc(g.name)}</b><span class="grow"></span><button class="s" data-gdel="${g.id}">✕</button></div><div class="muted">${g.members.map(m => esc(m.name) + ' (' + m.share + ')').join(' · ')}</div></div>`).join('') || '<div class="empty">Keine Tippgemeinschaft. Lege eine an, um Gewinne nach Anteilen aufzuteilen.</div>'}
  <div class="card"><h3>Neue Tippgemeinschaft</h3><label class="f">Name<input id="gName" placeholder="z. B. Büro-Runde"></label><label class="f">Mitglieder und Anteile (eine Zeile je Person: Name, Anteile)<textarea id="gMembers" placeholder="Diila, 2&#10;Sam, 1&#10;Ama, 1"></textarea></label><div><button class="p" id="gSave">Speichern</button></div></div></div>`;

function planHtml(g) {
  const last = live('draws').filter(d => d.game === g.id).sort((a, b) => b.date.localeCompare(a.date))[0];
  const rows = R.gewinnplan(g.id, last, jackpotOf(g.id, last)); if (!rows.length) return '';
  const tbl = rs => `<div class="twrap"><table class="t"><thead><tr><th>Klasse</th><th>Bedingung</th><th>Chance</th><th class="n">Gewinn</th></tr></thead><tbody>${rs.map(r => `<tr><td>${r.gk}</td><td>${esc(r.cond)}</td><td class="muted">${esc(r.odds)}</td><td class="n">${esc(r.amount)}</td></tr>`).join('')}</tbody></table></div>`;
  const extras = g.kind === 'lotto' ? [['Spiel 77', R.EXTRA_PLAN.spiel77], ['SUPER 6', R.EXTRA_PLAN.super6]] : g.kind === 'keno' ? [['plus 5', R.EXTRA_PLAN.plus5]] : [];
  return `<details><summary class="muted">Gewinnplan &amp; Chancen${last && last.quoten ? ' (Quoten vom ' + fmtD(last.date) + ')' : ''}</summary>${tbl(rows)}${extras.map(([n, rs]) => '<div class="muted" style="margin-top:8px"><b>' + n + '</b></div>' + tbl(rs)).join('')}</details>`;
}
V.scheine = () => {
  const act = GAMES.filter(g => S.settings.active[g.id]);
  let h = `<h2>Neuer Schein</h2><div class="card" id="newform">
    <div class="scanbox" id="scanbox"><div><b>Schein scannen</b> <span class="muted">– Foto der Spielquittung, Zahlen werden vorausgefüllt</span></div>
      <div class="row"><label class="btn p" for="scanFile">📷 Foto aufnehmen / wählen</label><input type="file" id="scanFile" accept="image/*" capture="environment" hidden></div>
      <div class="prog" id="scanProg" hidden><i></i></div><div class="hint" id="scanMsg"></div></div>
    <div class="row"><label class="f grow">Spiel<select id="fGame">${(act.length ? act : GAMES).map(g => `<option value="${g.id}">${g.name}</option>`).join('')}</select></label><label class="f">Ziehung<input type="date" id="fDate"></label><label class="f" style="width:110px">Einsatz €<input type="number" step="0.01" inputmode="decimal" id="fStake" placeholder="0,00"></label></div>
    <div id="fFields"></div>
    <div class="row"><label class="f grow">Notiz<input id="fLabel" placeholder="z. B. Kiosk Bahnhofstr."></label><label class="f" style="width:150px">Dauerschein<select id="fWeeks"><option value="1">nur diese Ziehung</option><option value="2">2 Ziehungen</option><option value="4">4 Ziehungen</option><option value="8">8 Ziehungen</option></select></label>${live('groups').length ? `<label class="f" style="width:150px">Tippgemeinschaft<select id="fGroup"><option value="">– keine –</option>${live('groups').map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select></label>` : ''}</div>
    <div class="row"><button class="p" id="fSave">Schein speichern</button></div></div>`;
  const today = todayIso(), list = live('tickets').sort((a, b) => b.date.localeCompare(a.date) || b.updated_at - a.updated_at);
  h += `<h2>Meine Scheine <small>${list.length}</small></h2><div class="stack">${list.length ? list.slice(0, 60).map(t => { const r = S.results.find(x => x.ticket === t.id); const st = r ? (r.won ? '<span class="pill win">' + (r.amount ? euro(r.amount) : 'Gewinn') + '</span>' : '<span class="pill">Geprüft</span>') : (t.date < today ? '<span class="pill due">Ergebnis fehlt</span>' : '<span class="pill ok">Läuft</span>');
    const mw = !r && t.date >= today ? R.maxWin(t, Object.fromEntries(Object.entries(S.settings.jackpots || {}).map(([k, v]) => [k, v.amount]))) : '';
    return `<div class="card ${r && r.won ? 'win' : ''}"><div class="row">${st}<b>${G[t.game].name}</b><span class="muted">${fmtD(t.date)}</span><span class="grow"></span><span class="num muted">${t.stake ? euro(t.stake) : ''}</span><button class="s" data-repeat="${t.id}" aria-label="Nochmal spielen" title="Nochmal spielen">↻</button><button class="s" data-del="${t.id}" aria-label="Schein löschen">✕</button></div>${tipHtml(t, r)}<div class="row">${t.label ? '<span class="muted">' + esc(t.label) + '</span>' : ''}${mw ? '<span class="muted">· möglich bis ' + esc(mw) + '</span>' : ''}</div></div>`; }).join('') + (list.length > 60 ? '<div class="muted">… ältere Scheine in der Bilanz enthalten.</div>' : '') : '<div class="empty">Noch keine Scheine. Scanne die Spielquittung oder trage die Zahlen oben ein.</div>'}</div>`;
  return h;
};
function fieldsFor(id) {
  const g = G[id];
  if (g.kind === 'suffix') return '<label class="f">Losnummer<input id="fLos" inputmode="numeric" maxlength="12" placeholder="7-stellig"></label>';
  let h = `<div id="pk"></div><details class="alt"><summary class="muted">Als Text eingeben</summary><label class="f">Tipps (eine Zeile je Tipp${g.kind === 'ej' ? ', Eurozahlen nach „|“' : g.kind === 'keno' ? ', 2–10 Zahlen' : ''})<textarea id="fTips" placeholder="${g.kind === 'ej' ? '3 17 22 38 45 | 4 9' : g.kind === 'keno' ? '5 12 19 27 33 41 56 68' : '3 11 19 27 34 42'}"></textarea></label></details>`;
  if (g.kind === 'lotto') h += '<div class="row"><label class="f" style="width:110px">Superzahl<input id="fSz" inputmode="numeric" maxlength="1" placeholder="0–9"></label><label class="f grow">Losnummer<input id="fLos" inputmode="numeric" maxlength="7" placeholder="7-stellig"></label><label class="check"><input type="checkbox" id="fS77">Spiel 77</label><label class="check"><input type="checkbox" id="fS6">SUPER 6</label></div>';
  if (g.kind === 'keno') h += '<div class="row"><label class="f grow">Losnummer<input id="fLos" inputmode="numeric" maxlength="7" placeholder="7-stellig"></label><label class="check"><input type="checkbox" id="fP5">plus 5</label></div>';
  return h;
}

V.ziehungen = () => {
  let h = `<h2>Ziehung eintragen</h2><div class="card"><div class="row"><label class="f grow">Spiel<select id="dGame">${GAMES.map(g => `<option value="${g.id}">${g.name}</option>`).join('')}</select></label><label class="f">Datum<input type="date" id="dDate"></label></div><div id="dFields"></div><div class="row"><button class="p" id="dSave">Speichern &amp; Scheine prüfen</button>${S.settings.token ? '<button id="fetchNow">Automatisch abrufen</button>' : ''}</div><p class="hint">${S.settings.token ? 'Der Abend-Check trägt Ziehungen automatisch ein. Manuell nur, wenn etwas fehlt.' : 'Zahlen von lotto.de, eurojackpot.de, keno.de bzw. der Lotterie abtippen.'}</p></div>`;
  const list = live('draws').sort((a, b) => b.date.localeCompare(a.date));
  h += `<h2>Erfasste Ziehungen <small>${list.length}</small></h2><div class="stack">${list.length ? list.slice(0, 40).map(d => { const g = G[d.game] || { name: d.game }, rs = S.results.filter(r => r.draw === d.id);
    return `<div class="card"><div class="row"><b>${esc(g.name)}</b><span class="muted">${fmtD(d.date)}</span>${String(d.source || '').startsWith('auto') ? '<span class="pill ok">automatisch</span>' : ''}<span class="grow"></span><span class="muted">${rs.length} Schein(e), ${rs.filter(r => r.won).length} mit Gewinn</span>${S.settings.token ? '' : `<button class="s" data-ddel="${d.id}">✕</button>`}</div>${d.n ? `<div class="balls">${d.n.map(n => `<span class="ball hit">${n}</span>`).join('')}${d.e && d.e.length ? '<span class="muted">+</span>' + d.e.map(n => `<span class="ball hit sz">${n}</span>`).join('') : ''}</div>` : ''}<div class="muted num">${esc([d.sz !== undefined && d.sz !== '' ? 'Superzahl ' + d.sz : '', d.spiel77 ? 'Spiel 77: ' + d.spiel77 : '', d.super6 ? 'SUPER 6: ' + d.super6 : '', d.plus5 ? 'plus 5: ' + d.plus5 : '', d.wins ? 'Gewinnzahlen: ' + d.wins.join(', ') : '', d.jackpot ? 'Jackpot: ' + d.jackpot : ''].filter(Boolean).join(' · '))}</div>${d.quoten ? '<details><summary class="muted">Quoten</summary><div class="kv">' + Object.entries(d.quoten).map(([k, v]) => `<span class="muted">Klasse ${k}</span><span class="num">${esc(v)}</span>`).join('') + '</div></details>' : ''}</div>`; }).join('') : '<div class="empty">Noch keine Ziehung erfasst.</div>'}</div>`;
  return h;
};
function dFieldsFor(id) {
  const g = G[id];
  if (g.kind === 'suffix') return '<label class="f">Gewinnzahlen / Endziffern (durch Komma oder Zeile getrennt)<textarea id="dWins" placeholder="z. B. 7, 34, 912, 4458, 56521, 2837714"></textarea></label>';
  let h = `<label class="f">Gezogene Zahlen${g.kind === 'ej' ? ' (5 Zahlen | 2 Eurozahlen)' : g.kind === 'keno' ? ' (20 Zahlen)' : ' (6 Zahlen)'}<textarea id="dNums" placeholder="${g.kind === 'ej' ? '3 17 22 38 45 | 4 9' : g.kind === 'keno' ? '2 5 9 14 …' : '3 11 19 27 34 42'}"></textarea></label>`;
  if (g.kind === 'lotto') h += '<div class="row"><label class="f" style="width:110px">Superzahl<input id="dSz" inputmode="numeric" maxlength="1"></label><label class="f grow">Spiel 77<input id="dS77" inputmode="numeric" maxlength="7"></label><label class="f grow">SUPER 6<input id="dS6" inputmode="numeric" maxlength="6"></label></div>';
  if (g.kind === 'keno') h += '<label class="f">plus 5<input id="dP5" inputmode="numeric" maxlength="5"></label>';
  h += '<label class="f">Jackpot nächste Ziehung (optional)<input id="dJackpot" placeholder="z. B. 18 Mio. €"></label>';
  return h;
}

V.statistik = () => {
  const st = R.stats(live('tickets'), live('results'));
  const rows = st.byGame.sort((a, b) => b.stake - a.stake);
  const max = Math.max(1, ...rows.map(r => Math.max(r.stake, r.won)));
  const chart = rows.length ? `<svg class="chart" viewBox="0 0 360 ${rows.length * 44 + 10}" role="img" aria-label="Einsatz und Gewinn je Spiel">${rows.map((r, i) => { const y = i * 44 + 8; const w1 = 200 * r.stake / max, w2 = 200 * r.won / max; return `<text x="0" y="${y + 14}" font-size="12" fill="var(--ink)">${esc(G[r.game].name)}</text><rect x="130" y="${y}" width="${w1}" height="10" fill="var(--line)"/><rect x="130" y="${y + 13}" width="${w2}" height="10" fill="var(--gold)"/><text x="${134 + Math.max(w1, w2)}" y="${y + 20}" font-size="11" fill="var(--muted)">${esc(euro(r.won))} / ${esc(euro(r.stake))}</text>`; }).join('')}</svg><div class="hint">Grau = Einsatz, Gold = Gewinn (nur bekannte Quoten).</div>` : '';
  return `<h2>Bilanz</h2><div class="tiles"><div class="tile"><div class="v num">${euro(st.all.stake)}</div><div class="l">Einsatz</div></div><div class="tile"><div class="v num">${euro(st.all.won)}</div><div class="l">Gewonnen</div></div><div class="tile"><div class="v num" style="color:${st.all.won - st.all.stake >= 0 ? 'var(--ok)' : 'var(--win)'}">${euro(st.all.won - st.all.stake)}</div><div class="l">Saldo</div></div><div class="tile"><div class="v">${st.all.checked ? Math.round(100 * st.all.wins / st.all.checked) + ' %' : '–'}</div><div class="l">Trefferquote</div></div></div>
  <div class="card" style="margin-top:12px">${chart || '<div class="empty">Noch keine Daten – lege den ersten Schein an.</div>'}</div>
  <h2>Je Spiel</h2><div class="card twrap"><table class="t"><thead><tr><th>Spiel</th><th class="n">Scheine</th><th class="n">Geprüft</th><th class="n">Gewinne</th><th class="n">Einsatz</th><th class="n">Gewonnen</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(G[r.game].name)}</td><td class="n">${r.tickets}</td><td class="n">${r.checked}</td><td class="n">${r.wins}${r.unknown ? '*' : ''}</td><td class="n">${euro(r.stake)}</td><td class="n">${euro(r.won)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">–</td></tr>'}</tbody></table>${rows.some(r => r.unknown) ? '<div class="hint">* Gewinne ohne bekannte Quote zählen mit 0 € – Quote beim Anbieter nachtragen.</div>' : ''}</div>
  <p class="hint">Zur Einordnung: Die Ausschüttungsquote bei LOTTO 6aus49 liegt bei rund 50 % des Einsatzes. Ein negativer Saldo ist langfristig normal; Losbuch hilft, ihn im Blick zu behalten.</p>`;
};

V.einstellungen = () => `<h2>Sync &amp; Geräte</h2><div class="card">
  ${S.settings.token ? `<p class="muted" style="margin:0"><b>Cloud-Sync aktiv.</b> Alle Geräte mit diesem Code sehen dieselben Scheine. Abend-Check und Push laufen auf dem Server.</p><div class="row"><span class="muted">Kopplungscode</span><code class="num" id="tokenBox" style="letter-spacing:.06em;word-break:break-all">${esc(S.settings.token)}</code><button class="s" id="copyToken">Kopieren</button></div><div class="hint">Den Code auf dem zweiten Gerät beim Start unter „Gerät koppeln“ eingeben. Wer den Code hat, sieht deine Scheine – nicht weitergeben.</div><div class="row"><button class="s" id="syncNow">Jetzt synchronisieren</button><button class="s" id="logout">Gerät trennen</button></div>`
    : `<p class="muted" style="margin:0"><b>Nur lokal.</b> Daten liegen in diesem Browser. Mit einem Konto bekommst du Sync, automatische Ziehungen und Push.</p><div class="row"><button class="p" id="obNew">Konto anlegen</button><input id="obToken" class="num" placeholder="Kopplungscode"><button id="obPair">Koppeln</button></div>`}</div>
  <h2>Benachrichtigungen</h2><div class="card">${S.settings.token ? `<p class="muted" style="margin:0">Push aufs Gerät nach jeder Ziehung, zu der du Scheine hast, und bei Jackpots ab 50 Mio. €.</p><div class="row"><button class="p" id="pushOn">${S.settings.pushOn ? 'Push erneuern' : 'Push aktivieren'}</button><button id="pushTest" ${S.settings.pushOn ? '' : 'disabled'}>Testnachricht</button></div><div class="hint" id="pushMsg">${S.settings.pushOn ? 'Aktiv auf diesem Gerät.' : 'Auf iPhone/iPad erst „Zum Home-Bildschirm“ hinzufügen, dann hier aktivieren.'}</div>` : '<div class="muted">Erst Konto anlegen.</div>'}</div>
  <h2>Einstellungen</h2><div class="card"><label class="f">Bundesland (Annahmeschluss)<select id="setState"><option value="">– nicht gesetzt –</option>${Object.entries(STATES).map(([k, v]) => `<option value="${k}" ${S.settings.state === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label class="f">Name (optional)<input id="setName" value="${esc(S.settings.name)}"></label><label class="check"><input type="checkbox" id="setRemind" ${S.settings.prefs.remind !== false ? 'checked' : ''}>Am Ziehungstag erinnern, wenn noch kein Schein eingetragen ist (Push, 14:30 Uhr)</label><div><button class="s" id="setSave">Speichern</button></div></div>
  <h2>Sicherung</h2><div class="card"><div class="row"><button id="sExport">Sicherungscode erzeugen</button><button id="sCopy">Kopieren</button></div><textarea id="sBox" placeholder="Hier erscheint der Sicherungscode – oder einen Code zum Einspielen einfügen."></textarea><div class="row"><button id="sImport">Code einspielen</button><button id="sWipe">Alles löschen</button></div><div id="sMsg" class="hint"></div></div>
  <p class="hint">Losbuch · Version 2.1 · <a href="https://github.com/Rawkeep/Losbuch" target="_blank" rel="noopener">Quellcode</a> · Teilnahme ab 18 · Hilfe bei Spielsucht: BZgA 0800 1 37 27 00</p>`;

// ---------- Zahlen-Tippfeld (antippen statt tippen) ----------
const PK = { rows: [{ n: [], e: [] }], i: 0 };
const pkSpec = g => g.kind === 'lotto' ? { max: 49, need: 6, emax: 0, eneed: 0 } : g.kind === 'ej' ? { max: 50, need: 5, emax: 12, eneed: 2 } : { max: 70, need: 10, min: 2, emax: 0, eneed: 0 };
function pkFromText() { const ta = $('fTips'); if (!ta) return; const rows = parseTips(ta.value); PK.rows = rows.length ? rows : [{ n: [], e: [] }]; PK.i = Math.min(PK.i, PK.rows.length - 1); }
function pkToText() { const ta = $('fTips'); if (ta) ta.value = PK.rows.filter(r => r.n.length).map(r => r.n.join(' ') + (r.e.length ? ' | ' + r.e.join(' ') : '')).join('\n'); }
function pkRender() {
  const el = $('pk'), g = G[$('fGame').value]; if (!el || g.kind === 'suffix') return;
  const sp = pkSpec(g), row = PK.rows[PK.i];
  const rowsHtml = PK.rows.map((r, i) => `<button type="button" class="pkrow ${i === PK.i ? 'on' : ''}" data-pkrow="${i}" aria-label="Reihe ${i + 1}"><span class="muted">${i + 1}</span> ${r.n.length ? r.n.join(' ') : '<span class="muted">leer</span>'}${r.e.length ? ' <span class="muted">+</span> ' + r.e.join(' ') : ''}${PK.rows.length > 1 ? `<span class="x" data-pkdel="${i}" role="button" aria-label="Reihe löschen">✕</span>` : ''}</button>`).join('');
  const grid = (max, sel, cls) => `<div class="grid ${cls}">${Array.from({ length: max }, (_, k) => k + 1).map(n => `<button type="button" class="ball ${sel.includes(n) ? 'hit' : ''}" data-pk="${cls}:${n}">${n}</button>`).join('')}</div>`;
  const fav = (S.settings.prefs.favorites || {})[g.id];
  el.innerHTML = `<div class="pkrows">${rowsHtml}</div>
    <div class="row" style="justify-content:space-between"><span class="muted">${g.kind === 'keno' ? `Reihe ${PK.i + 1}: ${row.n.length} von 2–10 Zahlen (Typ ${row.n.length || '–'})` : `Reihe ${PK.i + 1}: ${row.n.length} / ${sp.need}${sp.eneed ? ' + ' + row.e.length + ' / ' + sp.eneed + ' Eurozahlen' : ''}`}</span><span class="row"><button type="button" class="s" data-pkact="quick">Quicktipp</button><button type="button" class="s" data-pkact="clear">Leeren</button><button type="button" class="s" data-pkact="add">+ Reihe</button></span></div>
    ${grid(sp.max, row.n, 'n')}${sp.emax ? '<div class="muted">Eurozahlen</div>' + grid(sp.emax, row.e, 'e') : ''}
    <div class="row"><button type="button" class="s" data-pkact="favsave" title="Aktuelle Reihen als Lieblingszahlen merken">★ Merken</button>${fav && fav.length ? '<button type="button" class="s" data-pkact="favload">★ Lieblingszahlen laden</button>' : ''}</div>`;
  pkToText();
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-pk],[data-pkrow],[data-pkdel],[data-pkact]'); if (!b) return;
  const g = G[$('fGame').value], sp = pkSpec(g), row = PK.rows[PK.i];
  if (b.dataset.pkdel != null) { e.stopPropagation(); PK.rows.splice(+b.dataset.pkdel, 1); PK.i = Math.max(0, Math.min(PK.i, PK.rows.length - 1)); }
  else if (b.dataset.pkrow != null) PK.i = +b.dataset.pkrow;
  else if (b.dataset.pk) { const [cls, v] = b.dataset.pk.split(':'); const n = +v, arr = cls === 'n' ? row.n : row.e, lim = cls === 'n' ? sp.need : sp.eneed; const k = arr.indexOf(n); if (k >= 0) arr.splice(k, 1); else if (arr.length < lim) { arr.push(n); arr.sort((a, c) => a - c); try { navigator.vibrate && navigator.vibrate(8); } catch (_) {} } else toast('Reihe ist voll – „+ Reihe“ für einen weiteren Tipp');
    if (g.kind !== 'keno' && row.n.length === sp.need && row.e.length === sp.eneed && PK.i === PK.rows.length - 1 && PK.rows.length < 12) { /* Reihe komplett → nächste vorbereiten */ } }
  else if (b.dataset.pkact === 'add') { if (!row.n.length) { toast('Erst die aktuelle Reihe füllen'); return; } PK.rows.push({ n: [], e: [] }); PK.i = PK.rows.length - 1; }
  else if (b.dataset.pkact === 'clear') { row.n = []; row.e = []; }
  else if (b.dataset.pkact === 'quick') { const t = quick(g.kind, g.kind === 'keno' ? (row.n.length || 8) : 0); const [a, c] = t.split('|'); row.n = nums(a); row.e = c ? nums(c) : []; }
  else if (b.dataset.pkact === 'favsave') { S.settings.prefs.favorites[g.id] = PK.rows.filter(r => r.n.length).map(r => ({ n: [...r.n], e: [...r.e] })); persistSettings(); pushAccount(); toast('Als Lieblingszahlen gemerkt'); }
  else if (b.dataset.pkact === 'favload') { PK.rows = (S.settings.prefs.favorites[g.id] || []).map(r => ({ n: [...r.n], e: [...r.e] })); PK.i = 0; }
  pkRender();
});
function pkReset(rows) { PK.rows = rows && rows.length ? rows.map(r => ({ n: [...r.n], e: [...(r.e || [])] })) : [{ n: [], e: [] }]; PK.i = 0; }

// ---------- Scan ----------
let ocrWorker = null;
async function getOcr(onProgress) {
  if (ocrWorker) return ocrWorker;
  if (!window.Tesseract) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/tesseract/tesseract.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  ocrWorker = await Tesseract.createWorker('eng', 1, { workerPath: 'vendor/tesseract/worker.min.js', corePath: 'vendor/tesseract/', langPath: 'vendor/tesseract/lang', logger: m => onProgress && onProgress(m) });
  await ocrWorker.setParameters({ tessedit_char_whitelist: '0123456789 ', preserve_interword_spaces: '1' });
  return ocrWorker;
}
async function preprocess(file) { // Graustufen, Kontrast, Vergrößerung – Spielquittungen sind Thermodruck
  const img = await createImageBitmap(file);
  const scale = Math.min(2, 1600 / Math.max(img.width, img.height)) || 1;
  const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  const x = c.getContext('2d'); x.drawImage(img, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height), p = d.data; let sum = 0;
  for (let i = 0; i < p.length; i += 4) { const g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]; p[i] = p[i + 1] = p[i + 2] = g; sum += g; }
  const mean = sum / (p.length / 4), th = mean * 0.85;
  for (let i = 0; i < p.length; i += 4) { const v = p[i] < th ? 0 : 255; p[i] = p[i + 1] = p[i + 2] = v; }
  x.putImageData(d, 0, 0); return c;
}
function numbersFromText(text, game) { // Zeilen → Tipps je Spiel
  const g = G[game], lines = text.split(/\n/).map(l => (l.match(/\d+/g) || []).map(Number)).filter(l => l.length);
  const out = { tips: [], los: '', sz: '' };
  for (const raw of lines) {
    // lange Zahlen (Losnummer) separat
    const longs = raw.filter(n => n >= 100000), ns = raw.filter(n => n < 100);
    if (longs.length && !out.los) out.los = String(longs[0]).padStart(7, '0').slice(-7);
    // Zeilennummer ("1", "2") steht auf Quittungen vor dem Tipp → die letzten Zahlen der Zeile nehmen
    if (g.kind === 'lotto' && ns.length >= 6) { const c = ns.slice(-6); if (c.every(n => n >= 1 && n <= 49) && new Set(c).size === 6) out.tips.push({ n: [...c].sort((a, b) => a - b), e: [] }); }
    if (g.kind === 'ej' && ns.length >= 7) { const c = ns.slice(-7), n = c.slice(0, 5), e = c.slice(5); if (n.every(x => x >= 1 && x <= 50) && e.every(x => x >= 1 && x <= 12) && new Set(n).size === 5 && new Set(e).size === 2) out.tips.push({ n: [...n].sort((a, b) => a - b), e: [...e].sort((a, b) => a - b) }); }
    if (g.kind === 'keno') { let c = ns; if (c.length >= 3 && c[0] >= 2 && c[0] <= 10 && c.length === c[0] + 1) c = c.slice(1); else if (c.length >= 4 && c[1] >= 2 && c[1] <= 10 && c.length === c[1] + 2) c = c.slice(2); // "Typ 8" bzw. "1 Typ 8" vorne
      if (c.length >= 2 && c.length <= 10 && c.every(n => n >= 1 && n <= 70) && new Set(c).size === c.length) out.tips.push({ n: [...c].sort((a, b) => a - b), e: [] }); }
  }
  if (out.los) out.sz = out.los.slice(-1);
  return out;
}
async function scan(file) {
  const prog = $('scanProg'), msg = $('scanMsg'); prog.hidden = false; msg.textContent = 'Texterkennung wird geladen …';
  try {
    const canvas = await preprocess(file);
    const w = await getOcr(m => { if (m.status === 'recognizing text') { prog.firstElementChild.style.width = Math.round(m.progress * 100) + '%'; msg.textContent = 'Lese Zahlen … ' + Math.round(m.progress * 100) + ' %'; } else if (m.status) msg.textContent = m.status.replace('loading', 'lade').replace('initializing', 'starte') + ' …'; });
    const { data } = await w.recognize(canvas);
    const game = $('fGame').value, found = numbersFromText(data.text, game);
    if (G[game].kind === 'suffix') { if (found.los) { $('fLos').value = found.los; msg.textContent = 'Losnummer erkannt – bitte prüfen.'; } else msg.textContent = 'Keine Losnummer erkannt. Bitte näher und gerade fotografieren.'; }
    else {
      if (found.tips.length) { $('fTips').value = found.tips.map(t => t.n.join(' ') + (t.e.length ? ' | ' + t.e.join(' ') : '')).join('\n'); pkFromText(); pkRender(); msg.textContent = found.tips.length + ' Tipp(s) erkannt – bitte mit der Quittung vergleichen, dann speichern.'; }
      else msg.textContent = 'Keine vollständigen Tipps erkannt. Tipp: nur den Zahlenblock fotografieren, gutes Licht, Quittung flach.';
      if (found.los && $('fLos')) $('fLos').value = found.los; if (found.sz && $('fSz')) $('fSz').value = found.sz;
    }
    const img = document.createElement('img'); img.src = canvas.toDataURL('image/jpeg', 0.6); img.alt = 'Vorschau des gescannten Scheins'; const old = $('scanbox').querySelector('img'); if (old) old.remove(); $('scanbox').appendChild(img);
  } catch (e) { msg.textContent = 'Scan fehlgeschlagen: ' + (e.message || e); }
  prog.hidden = true; prog.firstElementChild.style.width = '0';
}

// ---------- Push ----------
async function enablePush() {
  const m = $('pushMsg');
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Dieser Browser unterstützt kein Web-Push.');
    const perm = await Notification.requestPermission(); if (perm !== 'granted') throw new Error('Berechtigung nicht erteilt.');
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await (await fetch(API() + '/push/vapid', { headers: { authorization: 'Bearer ' + S.settings.token } })).json();
    const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const r = await fetch(API() + '/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + S.settings.token }, body: JSON.stringify(sub.toJSON()) });
    if (!r.ok) throw new Error('Server hat die Anmeldung abgelehnt.');
    S.settings.pushOn = true; await persistSettings(); m.textContent = 'Push aktiv auf diesem Gerät.'; route(true);
  } catch (e) { m.textContent = 'Push nicht aktiviert: ' + (e.message || e); }
}

// ---------- Rendering & Events ----------
let pendingGame = null, pendingTicket = null;
function route(keepScroll) {
  if (!S.settings.onboarded) { $('view').innerHTML = V.onboarding(); document.querySelectorAll('nav.tabs a').forEach(a => a.classList.remove('on')); return; }
  const v = (location.hash || '#heute').slice(1), name = V[v] && v !== 'onboarding' ? v : 'heute';
  const unseen = live('results').filter(r => !r.seen).length;
  document.querySelectorAll('nav.tabs a').forEach(a => { a.classList.toggle('on', a.dataset.v === name); const b = a.querySelector('.badge'); if (a.dataset.v === 'heute') { if (unseen && !b) a.insertAdjacentHTML('beforeend', '<span class="badge">' + unseen + '</span>'); else if (b) { if (unseen) b.textContent = unseen; else b.remove(); } } });
  const el = $('view'), y = window.scrollY, same = el.dataset.v === name; el.dataset.v = name;
  const focusId = document.activeElement && document.activeElement.id, focusVal = focusId && document.activeElement.value;
  el.innerHTML = V[name]();
  ticker();
  if (name === 'scheine') { const sel = $('fGame'), fld = $('fFields');
    const upd = (keep) => { fld.innerHTML = fieldsFor(sel.value); $('fDate').value = R.nextDraw(G[sel.value]); const ls = (S.settings.prefs.lastStake || {})[sel.value]; if (ls && !$('fStake').value) $('fStake').value = ls; if ($('fGroup') && S.settings.prefs.lastGroup) $('fGroup').value = S.settings.prefs.lastGroup; if (!keep) pkReset(); pkRender(); const ta = $('fTips'); if (ta) ta.addEventListener('input', () => { pkFromText(); pkRender(); }); };
    sel.onchange = () => upd(); upd();
    if (pendingGame) { sel.value = pendingGame; upd(); pendingGame = null; }
    if (pendingTicket) { const t = pendingTicket; pendingTicket = null; sel.value = t.game; upd(true); pkReset(t.tips); pkRender(); if ($('fLos')) $('fLos').value = t.los || ''; if ($('fSz')) $('fSz').value = t.sz || ''; if ($('fS77')) $('fS77').checked = !!t.spiel77; if ($('fS6')) $('fS6').checked = !!t.super6; if ($('fP5')) $('fP5').checked = !!t.plus5; $('fStake').value = t.stake || ''; $('fLabel').value = t.label || ''; if ($('fGroup')) $('fGroup').value = t.group || ''; toast('Letzter Schein übernommen – Datum: nächste Ziehung'); }
    $('scanFile').onchange = e => { if (e.target.files[0]) scan(e.target.files[0]); }; }
  if (name === 'ziehungen') { const sel = $('dGame'), fld = $('dFields'); const upd = () => { fld.innerHTML = dFieldsFor(sel.value); }; sel.onchange = upd; upd(); $('dDate').value = todayIso(); }
  if (same && keepScroll && focusId && $(focusId) && focusVal != null) { $(focusId).value = focusVal; $(focusId).focus(); }
  window.scrollTo(0, same && keepScroll ? y : 0);
}

document.addEventListener('click', async e => {
  const t = e.target.closest('[data-new],[data-del],[data-ddel],[data-gdel],[data-claim],[data-repeat],[data-share],button'); if (!t) return;
  if (t.dataset.new) { pendingGame = t.dataset.new; return; }
  if (t.dataset.repeat) { pendingTicket = S.tickets.find(x => x.id === t.dataset.repeat); location.hash = '#scheine'; route(); return; }
  if (t.dataset.share) { const r = S.results.find(x => x.id === t.dataset.share); if (r) shareResult(r); return; }
  if (t.dataset.del) { const id = t.dataset.del; for (const r of S.results.filter(r => r.ticket === id)) await del('results', r.id); await del('tickets', id); route(true); return; }
  if (t.dataset.ddel) { const id = t.dataset.ddel; for (const r of S.results.filter(r => r.draw === id)) await del('results', r.id); await del('draws', id); route(true); return; }
  if (t.dataset.gdel) { await del('groups', t.dataset.gdel); route(true); return; }
  if (t.dataset.claim) { const r = S.results.find(x => x.id === t.dataset.claim); if (r) { r.claimed = true; await put('results', r); } route(true); return; }
  switch (t.id) {
    case 'obNew': { const state = ($('obState') || {}).value || S.settings.state; try { const r = await fetch(API() + '/account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state, active: S.settings.active }) }); const j = await r.json(); if (!j.token) throw new Error(j.error || 'Fehler'); S.settings.token = j.token; S.settings.state = state; S.settings.onboarded = true; S.settings.lastSync = 0; for (const c of ['tickets', 'results', 'groups']) S[c].forEach(d => d._dirty = 1); await persistSettings(); toast('Konto angelegt'); location.hash = '#heute'; route(); sync(); } catch (err) { toast('Konto konnte nicht angelegt werden: ' + err.message); } break; }
    case 'obPair': { const tok = ($('obToken').value || '').trim(); if (!tok) { toast('Code eingeben'); break; } try { const r = await fetch(API() + '/account', { headers: { authorization: 'Bearer ' + tok } }); if (!r.ok) throw new Error('Code nicht gefunden'); const a = await r.json(); S.settings.token = tok; S.settings.state = a.state || S.settings.state; S.settings.active = a.active || S.settings.active; S.settings.onboarded = true; S.settings.lastSync = 0; await persistSettings(); toast('Gerät gekoppelt'); location.hash = '#heute'; route(); sync(); } catch (err) { toast(err.message); } break; }
    case 'obLocal': S.settings.onboarded = true; await persistSettings(); route(); break;
    case 'logout': S.settings.token = ''; S.settings.pushOn = false; S.settings.lastSync = 0; await persistSettings(); setStatus('', 'lokal'); route(); break;
    case 'syncNow': sync(); break;
    case 'copyToken': navigator.clipboard.writeText(S.settings.token).then(() => toast('Kopiert')).catch(() => toast('Bitte Code markieren und kopieren')); break;
    case 'fetchNow': { t.disabled = true; try { const r = await fetch(API() + '/run', { method: 'POST', headers: { authorization: 'Bearer ' + S.settings.token } }); const j = await r.json(); toast(j.fetched && j.fetched.length ? 'Geholt: ' + j.fetched.join(', ') : 'Keine neue Ziehung gefunden' + (j.errors && j.errors.length ? ' (' + j.errors.length + ' Quellen ohne Treffer)' : '')); await sync(); } catch (err) { toast('Abruf fehlgeschlagen'); } t.disabled = false; break; }
    case 'pushOn': enablePush(); break;
    case 'pushTest': { const r = await fetch(API() + '/push/test', { method: 'POST', headers: { authorization: 'Bearer ' + S.settings.token } }); const j = await r.json(); toast(j.sent ? 'Testnachricht gesendet' : 'Keine Push-Anmeldung auf dem Server'); break; }
    case 'setSave': S.settings.state = $('setState').value; S.settings.name = $('setName').value.trim(); S.settings.prefs.remind = $('setRemind').checked; await persistSettings(); pushAccount(); toast('Gespeichert'); break;
    case 'markseen': for (const r of live('results').filter(r => !r.seen)) { r.seen = true; await put('results', r); } route(); break;
    case 'fQuick_legacy': { const g = G[$('fGame').value]; if (g.kind === 'suffix') $('fLos').value = quick(g.kind); else { const ta = $('fTips'); const typ = g.kind === 'keno' ? Math.max(2, Math.min(10, (ta.value.split('\n')[0].match(/\d+/g) || []).length || 8)) : 0; ta.value = (ta.value.trim() ? ta.value.trim() + '\n' : '') + quick(g.kind, typ); } break; }
    case 'fSave': {
      const g = G[$('fGame').value], base = { game: g.id, date: $('fDate').value, stake: +($('fStake').value || 0), label: $('fLabel').value.trim(), group: ($('fGroup') || {}).value || '', created: Date.now(), tips: [], los: '', sz: '' };
      if (g.kind === 'suffix') base.los = $('fLos').value.trim();
      else { base.tips = parseTips($('fTips').value); base.los = ($('fLos') || {}).value || ''; if (g.kind === 'lotto') { base.sz = $('fSz').value.trim(); if (base.sz === '' && base.los) base.sz = base.los.slice(-1); base.spiel77 = $('fS77').checked; base.super6 = $('fS6').checked; } if (g.kind === 'keno') base.plus5 = $('fP5').checked; }
      const v = R.validateTicket(base); if (v) { toast(v); return; }
      const weeks = +$('fWeeks').value; let date = base.date; const made = [];
      for (let i = 0; i < weeks; i++) { made.push(Object.assign({}, base, { id: uid(), date })); const nx = new Date(date + 'T12:00'); nx.setDate(nx.getDate() + 1); date = R.nextDraw(g, nx); }
      for (const tk of made) await put('tickets', tk);
      S.settings.prefs.lastStake[g.id] = base.stake || ''; S.settings.prefs.lastGroup = base.group; await persistSettings();
      const n = await runChecks(); toast(n ? 'Gespeichert und sofort geprüft' : made.length > 1 ? made.length + ' Scheine gespeichert' : 'Schein gespeichert'); route(); break; }
    case 'dSave': {
      const g = G[$('dGame').value], d = { game: g.id, date: $('dDate').value, at: Date.now(), source: 'manuell', jackpot: ($('dJackpot').value || '').trim() };
      if (!d.date) { toast('Datum fehlt'); return; } d.id = d.game + '_' + d.date;
      if (g.kind === 'suffix') d.wins = ($('dWins').value.match(/\d+/g) || []);
      else { const [a, b] = $('dNums').value.split('|'); d.n = nums(a); d.e = b ? nums(b) : []; if (g.kind === 'lotto') { d.sz = $('dSz').value.trim(); d.spiel77 = $('dS77').value.trim(); d.super6 = $('dS6').value.trim(); } if (g.kind === 'keno') d.plus5 = $('dP5').value.trim(); }
      const v = R.validateDraw(d); if (v) { toast(v); return; }
      for (const r of S.results.filter(r => r.draw === d.id)) await del('results', r.id);
      await put('draws', d, { local: true });
      if (S.settings.token) fetch(API() + '/draws', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + S.settings.token }, body: JSON.stringify(d) }).catch(() => {});
      const n = await runChecks(); toast(n ? n + ' Schein(e) geprüft' : 'Ziehung gespeichert – kein passender Schein'); location.hash = n ? '#heute' : '#ziehungen'; route(); break; }
    case 'gSave': { const name = $('gName').value.trim(); const members = $('gMembers').value.split(/\n/).map(l => l.split(',')).filter(a => a[0] && a[0].trim()).map(a => ({ name: a[0].trim(), share: +(a[1] || 1) || 1 })); if (!name || !members.length) { toast('Name und Mitglieder angeben'); break; } await put('groups', { id: uid(), name, members }); toast('Tippgemeinschaft angelegt'); route(true); break; }
    case 'sExport': $('sBox').value = btoa(unescape(encodeURIComponent(JSON.stringify({ tickets: live('tickets'), draws: live('draws'), results: live('results'), groups: live('groups'), active: S.settings.active })))); $('sMsg').textContent = 'Code erzeugt: ' + new Date().toLocaleString('de-DE'); break;
    case 'sCopy': { const v = $('sBox').value; if (!v) { toast('Erst Code erzeugen'); break; } navigator.clipboard.writeText(v).then(() => toast('Kopiert')).catch(() => { $('sBox').select(); toast('Text markiert – jetzt kopieren'); }); break; }
    case 'sImport': { try { const o = JSON.parse(decodeURIComponent(escape(atob($('sBox').value.trim())))); let c = 0; for (const coll of ['tickets', 'draws', 'results', 'groups']) for (const x of (o[coll] || [])) if (!S[coll].some(y => y.id === x.id)) { await put(coll, x, { local: coll === 'draws' }); c++; } S.settings.active = Object.assign({}, o.active || {}, S.settings.active); await persistSettings(); await runChecks(); $('sMsg').textContent = c + ' Einträge übernommen.'; toast('Eingespielt'); route(true); } catch (err) { $('sMsg').textContent = 'Code konnte nicht gelesen werden.'; } break; }
    case 'sWipe': { if (t.dataset.armed) { for (const coll of ['results', 'tickets', 'groups']) for (const x of [...live(coll)]) await del(coll, x.id); if (idb) await tx('draws', 'readwrite', o => o.clear()); S.draws = []; route(); toast('Alles gelöscht'); } else { t.dataset.armed = '1'; t.textContent = 'Wirklich alles löschen? Nochmal tippen'; t.style.color = 'var(--win)'; } break; }
  }
});
document.addEventListener('change', async e => { if (e.target.dataset.act) { S.settings.active[e.target.dataset.act] = e.target.checked; await persistSettings(); pushAccount(); } });
window.addEventListener('hashchange', () => route());
window.addEventListener('online', () => sync());
document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });

// ---------- Start ----------
(async () => {
  await loadAll();
  if (!S.settings.api && location.protocol === 'file:') S.settings.api = 'https://losbuch.f4991r.workers.dev';
  route();
  await runChecks();
  if (S.settings.token) { setStatus('on', 'Cloud-Sync'); sync(); } else setStatus('', 'lokal');
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').then(reg => { navigator.serviceWorker.addEventListener('message', m => { if (m.data === 'sync') sync(); }); }).catch(() => {});
})();
})();

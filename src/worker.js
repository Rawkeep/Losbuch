// Losbuch Worker: statische App + Sync-API + Ziehungsabruf (Cron) + Web-Push
import R from '../public/rules.js';
import { parseDraw, parseJackpot, SOURCES, JACKPOT_SOURCES, htmlToText } from './sources.js';
import { sendPush, getVapid } from './push.js';

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const err = (msg, status = 400) => json({ error: msg }, status);
const now = () => Date.now();
const rid = (n = 12) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map(b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join(''); };
const todayBerlin = (d = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(d); // YYYY-MM-DD
const dowBerlin = (iso) => new Date(iso + 'T12:00:00Z').getUTCDay();

// ---------- Auth ----------
async function account(req, env) {
  const h = req.headers.get('authorization') || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7).trim() : new URL(req.url).searchParams.get('token');
  if (!tok) return null;
  return env.DB.prepare('SELECT * FROM accounts WHERE token=?').bind(tok).first();
}

// ---------- API ----------
async function api(req, env, ctx) {
  const url = new URL(req.url), p = url.pathname.replace(/^\/api/, ''), m = req.method;

  if (p === '/health') return json({ ok: true, time: now(), today: todayBerlin() });

  if (p === '/account' && m === 'POST') { // neues Konto (erstes Gerät)
    const body = await req.json().catch(() => ({}));
    const id = rid(8), token = rid(24), t = now();
    await env.DB.prepare('INSERT INTO accounts (id, token, name, state, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
      .bind(id, token, body.name || null, body.state || null, JSON.stringify(body.active || { lotto: true, ej: true }), t, t).run();
    return json({ id, token });
  }

  const acc = await account(req, env);
  if (!acc) return err('Nicht angemeldet', 401);

  if (p === '/account' && m === 'GET') return json({ id: acc.id, name: acc.name, state: acc.state, active: JSON.parse(acc.active), prefs: JSON.parse(acc.prefs || '{}'), updated_at: acc.updated_at });
  if (p === '/account' && m === 'PATCH') {
    const b = await req.json();
    await env.DB.prepare('UPDATE accounts SET name=COALESCE(?,name), state=COALESCE(?,state), active=COALESCE(?,active), prefs=COALESCE(?,prefs), updated_at=? WHERE id=?')
      .bind(b.name ?? null, b.state ?? null, b.active ? JSON.stringify(b.active) : null, b.prefs ? JSON.stringify(b.prefs) : null, now(), acc.id).run();
    return json({ ok: true });
  }
  if (p === '/jackpots' && m === 'GET') { const jp = await env.DB.prepare("SELECT value FROM kv WHERE key='jackpots'").first(); return json(jp ? JSON.parse(jp.value) : {}); }
  if (p === '/jackpots' && m === 'POST') { // manuell/extern setzen: {lotto:"18 Mio. €", ej:"120 Mio. €"}
    const b = await req.json(); const cur = await getJackpots(env);
    for (const k of Object.keys(b)) if (R.G[k]) cur[k] = { amount: String(b[k]), at: now(), source: 'manuell' };
    await setJackpots(env, cur); return json(cur);
  }

  if (p === '/sync') { // Pull: ?since=ts  |  Push: {docs:[…]}
    if (m === 'POST') {
      const b = await req.json();
      const stmts = [];
      for (const d of (b.docs || []).slice(0, 500)) {
        if (!['tickets', 'results', 'groups'].includes(d.coll) || !d.id) continue;
        stmts.push(env.DB.prepare(`INSERT INTO docs (account_id, coll, id, data, updated_at, deleted) VALUES (?,?,?,?,?,?)
          ON CONFLICT(account_id, coll, id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at, deleted=excluded.deleted WHERE excluded.updated_at >= docs.updated_at`)
          .bind(acc.id, d.coll, d.id, JSON.stringify(d.data || {}), +d.updated_at || now(), d.deleted ? 1 : 0));
      }
      if (stmts.length) await env.DB.batch(stmts);
    }
    const since = +url.searchParams.get('since') || 0;
    const docs = (await env.DB.prepare('SELECT coll, id, data, updated_at, deleted FROM docs WHERE account_id=? AND updated_at>? ORDER BY updated_at LIMIT 2000').bind(acc.id, since).all()).results
      .map(r => ({ coll: r.coll, id: r.id, data: JSON.parse(r.data), updated_at: r.updated_at, deleted: !!r.deleted }));
    const draws = (await env.DB.prepare('SELECT data FROM draws WHERE updated_at>? ORDER BY date DESC LIMIT 400').bind(since).all()).results.map(r => JSON.parse(r.data));
    const jp = await env.DB.prepare("SELECT value FROM kv WHERE key='jackpots'").first();
    return json({ time: now(), docs, draws, jackpots: jp ? JSON.parse(jp.value) : {}, account: { name: acc.name, state: acc.state, active: JSON.parse(acc.active), prefs: JSON.parse(acc.prefs || '{}'), updated_at: acc.updated_at } });
  }

  if (p === '/draws' && m === 'GET') {
    const from = url.searchParams.get('from') || '2000-01-01';
    const rows = (await env.DB.prepare('SELECT data FROM draws WHERE date>=? ORDER BY date DESC LIMIT 500').bind(from).all()).results;
    return json(rows.map(r => JSON.parse(r.data)));
  }
  if (p === '/draws' && m === 'POST') { // manuelle oder externe Erfassung (z. B. Claude-Abend-Check)
    const d = await req.json();
    const v = R.validateDraw(d); if (v) return err(v);
    d.id = d.game + '_' + d.date; d.source = d.source || 'manuell'; d.at = now();
    await env.DB.prepare('INSERT INTO draws (id, game, date, data, source, updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, source=excluded.source, updated_at=excluded.updated_at')
      .bind(d.id, d.game, d.date, JSON.stringify(d), d.source, now()).run();
    ctx.waitUntil(notifyAll(env, [d]));
    return json({ ok: true, id: d.id });
  }

  if (p === '/push/vapid') return json({ publicKey: (await getVapid(env)).publicKey });
  if (p === '/push/subscribe' && m === 'POST') {
    const s = await req.json();
    if (!s.endpoint || !s.keys) return err('Subscription unvollständig');
    await env.DB.prepare('INSERT INTO push_subs (account_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET account_id=excluded.account_id, p256dh=excluded.p256dh, auth=excluded.auth')
      .bind(acc.id, s.endpoint, s.keys.p256dh, s.keys.auth, now()).run();
    return json({ ok: true });
  }
  if (p === '/push/subscribe' && m === 'DELETE') { const s = await req.json(); await env.DB.prepare('DELETE FROM push_subs WHERE endpoint=? AND account_id=?').bind(s.endpoint, acc.id).run(); return json({ ok: true }); }
  if (p === '/push/test' && m === 'POST') { const n = await pushAccount(env, acc.id, { title: 'Losbuch', body: 'Push funktioniert. Ergebnisse kommen abends automatisch.', url: '/#heute' }); return json({ sent: n }); }

  if (p === '/run' && m === 'POST') { const log = await runFetch(env, { force: url.searchParams.get('force') === '1' }); return json(log); }
  if (p === '/remind' && m === 'POST') return json(await remindAll(env));
  if (p === '/probe') { // Diagnose: was liefern die Quellen für ein Spiel?
    const game = url.searchParams.get('game') || 'lotto', date = url.searchParams.get('date') || todayBerlin();
    const out = [];
    for (const src of SOURCES[game] || []) {
      try { const r = await fetch(src.url, { headers: UA, cf: { cacheTtl: 0 } }); const html = await r.text(); const text = htmlToText(html);
        out.push({ url: src.url, status: r.status, length: html.length, excerpt: text.slice(0, 1500), parsed: parseDraw(game, text, date) });
      } catch (e) { out.push({ url: src.url, error: String(e) }); }
    }
    return json(out);
  }
  return err('Unbekannter Endpunkt', 404);
}

const UA = { 'user-agent': 'Mozilla/5.0 (compatible; LosbuchBot/1.0; +https://github.com/Rawkeep/Losbuch)', 'accept-language': 'de-DE,de;q=0.9' };

// ---------- Ziehungen holen ----------
async function runFetch(env, { force = false } = {}) {
  const today = todayBerlin(), log = { today, fetched: [], skipped: [], errors: [] };
  // Welche Spiele sind fällig? Heute (wenn Ziehungstag) + offene Scheine der letzten 14 Tage
  const want = new Map();
  for (const g of R.GAMES) if (g.days.includes(dowBerlin(today))) want.set(g.id + '_' + today, { game: g.id, date: today });
  const since = R.iso(new Date(Date.now() - 14 * 864e5));
  const open = (await env.DB.prepare("SELECT DISTINCT json_extract(data,'$.game') AS game, json_extract(data,'$.date') AS date FROM docs WHERE coll='tickets' AND deleted=0 AND json_extract(data,'$.date') BETWEEN ? AND ?").bind(since, today).all()).results;
  for (const o of open) if (o.game && o.date) want.set(o.game + '_' + o.date, { game: o.game, date: o.date });
  const have = new Set((await env.DB.prepare('SELECT id FROM draws WHERE date>=?').bind(since).all()).results.map(r => r.id));
  const newDraws = [];
  for (const [id, w] of want) {
    if (have.has(id) && !force) { log.skipped.push(id); continue; }
    const g = R.G[w.game]; if (!g) continue;
    // Ziehung noch nicht vorbei? (Zeit in Berlin)
    const t = (g.drawTime[dowBerlin(w.date)] || g.drawTime.all || '20:00');
    const nowB = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    if (w.date === today && nowB < t) { log.skipped.push(id + ' (Ziehung noch nicht erfolgt)'); continue; }
    let found = null;
    for (const src of SOURCES[w.game] || []) {
      try {
        const r = await fetch(src.url, { headers: UA, cf: { cacheTtl: 0 } });
        if (!r.ok) { log.errors.push(src.url + ' HTTP ' + r.status); continue; }
        const text = htmlToText(await r.text());
        const d = parseDraw(w.game, text, w.date);
        if (d && !R.validateDraw(d)) { found = Object.assign(d, { id, source: 'auto:' + new URL(src.url).hostname, sourceUrl: src.url, at: now() }); break; }
      } catch (e) { log.errors.push(src.url + ' ' + String(e).slice(0, 120)); }
    }
    if (found) {
      await env.DB.prepare('INSERT INTO draws (id, game, date, data, source, updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, source=excluded.source, updated_at=excluded.updated_at')
        .bind(id, w.game, w.date, JSON.stringify(found), found.source, now()).run();
      newDraws.push(found); log.fetched.push(id);
    } else log.errors.push(id + ': keine Quelle lieferte die Ziehung');
  }
  // Jackpots aktualisieren (aus neuen Ziehungen und eigenen Quellen)
  try { await refreshJackpots(env, newDraws, log); } catch (e) { log.errors.push('jackpots ' + String(e).slice(0, 100)); }
  await env.DB.prepare("INSERT INTO kv (key, value) VALUES ('lastRun', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify({ at: now(), log })).run();
  if (newDraws.length) await notifyAll(env, newDraws);
  return log;
}
async function getJackpots(env) { const r = await env.DB.prepare("SELECT value FROM kv WHERE key='jackpots'").first(); return r ? JSON.parse(r.value) : {}; }
async function setJackpots(env, jp) { await env.DB.prepare("INSERT INTO kv (key, value) VALUES ('jackpots', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(jp)).run(); }
async function refreshJackpots(env, newDraws, log) {
  const jp = await getJackpots(env);
  for (const d of newDraws) if (d.jackpot) jp[d.game] = { amount: d.jackpot, at: now(), source: 'ziehung' };
  for (const [game, srcs] of Object.entries(JACKPOT_SOURCES)) {
    if (jp[game] && now() - jp[game].at < 6 * 3600e3) continue; // frisch genug
    for (const src of srcs) {
      try { const r = await fetch(src.url, { headers: UA, cf: { cacheTtl: 0 } }); if (!r.ok) continue; const amt = parseJackpot(htmlToText(await r.text()), game); if (amt) { jp[game] = { amount: amt, at: now(), source: 'auto:' + new URL(src.url).hostname }; break; } } catch (e) { log && log.errors.push('jackpot ' + src.url); }
    }
  }
  await setJackpots(env, jp); return jp;
}
// Erinnerung am Ziehungstag: abonniertes Spiel, kein Schein, Push gewünscht
async function remindAll(env) {
  const today = todayBerlin(), dow = dowBerlin(today), jp = await getJackpots(env);
  const due = R.GAMES.filter(g => g.days.includes(dow) && (g.kind === 'lotto' || g.kind === 'ej'));
  if (!due.length) return { reminded: 0 };
  const accounts = (await env.DB.prepare('SELECT id, active, state, prefs FROM accounts').all()).results; let n = 0;
  for (const acc of accounts) {
    const active = JSON.parse(acc.active || '{}'), prefs = JSON.parse(acc.prefs || '{}'); if (prefs.remind === false) continue;
    for (const g of due) {
      if (!active[g.id]) continue;
      const key = 'remind_' + g.id + '_' + today; const done = await env.DB.prepare('SELECT 1 FROM notified WHERE account_id=? AND draw_id=?').bind(acc.id, key).first(); if (done) continue;
      const has = await env.DB.prepare("SELECT 1 FROM docs WHERE account_id=? AND coll='tickets' AND deleted=0 AND json_extract(data,'$.game')=? AND json_extract(data,'$.date')=?").bind(acc.id, g.id, today).first();
      if (has) continue;
      const cut = R.cutoff(g.id, dow, acc.state) || '';
      const sent = await pushAccount(env, acc.id, { title: g.name + ' heute' + (jp[g.id] ? ' – ' + jp[g.id].amount + ' im Jackpot' : ''), body: 'Noch kein Schein eingetragen.' + (cut ? ' Annahmeschluss ' + cut + ' Uhr.' : ''), url: '/#scheine', tag: key });
      if (sent) n++;
      await env.DB.prepare('INSERT OR IGNORE INTO notified (account_id, draw_id) VALUES (?,?)').bind(acc.id, key).run();
    }
  }
  return { reminded: n };
}

// ---------- Auswerten + Push ----------
async function notifyAll(env, draws) {
  const accounts = (await env.DB.prepare('SELECT id, active FROM accounts').all()).results;
  for (const acc of accounts) {
    const active = JSON.parse(acc.active || '{}');
    for (const d of draws) {
      const done = await env.DB.prepare('SELECT 1 FROM notified WHERE account_id=? AND draw_id=?').bind(acc.id, d.id).first();
      if (done) continue;
      const tickets = (await env.DB.prepare("SELECT data FROM docs WHERE account_id=? AND coll='tickets' AND deleted=0 AND json_extract(data,'$.game')=? AND json_extract(data,'$.date')=?").bind(acc.id, d.game, d.date).all()).results.map(r => JSON.parse(r.data));
      const g = R.G[d.game];
      let msg = null;
      if (tickets.length) {
        const lines = [], big = [];
        let total = 0;
        for (const t of tickets) { const hits = R.evaluate(t, d); const w = R.winnings(hits); total += w; if (R.isBigWin(hits, d.game)) big.push(t);
          lines.push((t.label ? t.label + ': ' : '') + hits.filter(h => h.gk).map(h => h.text).join('; ') || (t.label ? t.label + ': ' : '') + 'kein Gewinn'); }
        const anyWin = lines.some(l => !l.endsWith('kein Gewinn'));
        msg = { title: (big.length ? 'GEWINN · ' : '') + g.name + ' ' + fmtDate(d.date), body: lines.join(' · ').slice(0, 300) + (anyWin ? ' – Schein beim Anbieter vorlegen.' : '') + (d.jackpot ? ' Jackpot: ' + d.jackpot : ''), url: '/#heute' };
      } else if (active[d.game] && d.jackpot && jackpotMillions(d.jackpot) >= 50) {
        msg = { title: g.name + ': ' + d.jackpot + ' im Jackpot', body: 'Noch kein Schein von dir für die nächste Ziehung.', url: '/#spiele' };
      }
      if (msg) await pushAccount(env, acc.id, msg);
      await env.DB.prepare('INSERT OR IGNORE INTO notified (account_id, draw_id) VALUES (?,?)').bind(acc.id, d.id).run();
    }
  }
}
const fmtDate = iso => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; };
const jackpotMillions = s => { const m = String(s).match(/([\d.,]+)\s*Mio/i); return m ? parseFloat(m[1].replace('.', '').replace(',', '.')) : 0; };

async function pushAccount(env, accountId, payload) {
  const subs = (await env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subs WHERE account_id=?').bind(accountId).all()).results;
  let n = 0;
  for (const s of subs) {
    const res = await sendPush(env, s, payload).catch(e => ({ status: 0, error: String(e) }));
    if (res.status === 404 || res.status === 410) await env.DB.prepare('DELETE FROM push_subs WHERE endpoint=?').bind(s.endpoint).run();
    else if (res.status >= 200 && res.status < 300) n++;
  }
  return n;
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
      try { const r = await api(req, env, ctx); for (const [k, v] of Object.entries(cors)) r.headers.set(k, v); return r; }
      catch (e) { return json({ error: String(e) }, 500, cors); }
    }
    return env.ASSETS.fetch(req);
  },
  async scheduled(event, env, ctx) {
    const hourUtc = new Date(event.scheduledTime).getUTCHours();
    if (hourUtc === 13 || hourUtc === 14) ctx.waitUntil(remindAll(env).then(() => refreshJackpots(env, [], null)));
    else ctx.waitUntil(runFetch(env));
  },
};
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };

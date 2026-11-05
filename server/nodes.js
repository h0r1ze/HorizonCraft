import crypto from 'crypto';
import { pipeline } from 'stream';
import { request } from 'undici';
import WebSocket from 'ws';
import * as store from './store.js';

/* Ноды: другие машины с HorizonCraft в режиме агента (см. agent.js).
   Главная панель не дублирует логику: запросы к серверам, которые живут на ноде, пересылаются
   агенту как есть, а ответы агента возвращаются в браузер. Поэтому на ноде работают файлы,
   бэкапы, консоль, игроки и импорт точно так же, как на этой машине. */

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
const db = () => store.get();

export const all = () => db().nodes;
export const get = id => db().nodes.find(n => n.id === id) || null;

const status = new Map();    // id ноды -> { online, checkedAt, error, version, hostInfo, servers }
const inflight = new Map();

export const hostOf = n => n.publicHost || new URL(n.url).hostname;
export const tag = n => ({ id: n.id, name: n.name, host: hostOf(n), online: !!status.get(n.id)?.online });
export const localTag = () => ({ id: 'local', name: 'Эта машина', host: db().settings.publicHost || '', online: true });

/* ---------- проверка ввода ---------- */
export function cleanUrl(u) {
  let x;
  try { x = new URL(String(u || '').trim()); }
  catch { throw bad('Адрес ноды указывается полностью, например http://192.168.1.20:8088'); }
  if (!/^https?:$/.test(x.protocol)) throw bad('Адрес ноды должен начинаться с http:// или https://');
  if (x.username || x.password || x.search || x.hash || (x.pathname !== '/' && x.pathname !== '')) {
    throw bad('Укажите только адрес и порт, без пути и параметров');
  }
  return x.origin;
}
const cleanName = v => {
  const s = String(v ?? '').trim();
  if (!s || s.length > 40) throw bad('Название ноды: от 1 до 40 символов');
  return s;
};
const cleanToken = v => {
  const s = String(v ?? '').trim();
  if (!/^[\x21-\x7e]{24,200}$/.test(s)) throw bad('Токен: от 24 символов, без пробелов');
  return s;
};
const cleanHost = v => {
  const s = String(v ?? '').trim();
  if (s && !/^[A-Za-z0-9.-]{1,253}$/.test(s)) throw bad('Недопустимый адрес для игроков');
  return s;
};

/* ---------- запросы к агенту ---------- */
function mapErr(e) {
  if (e.status) return e;
  const code = String(e.code || e.cause?.code || '');
  const msg = /ECONNREFUSED/.test(code) ? 'Соединение отклонено: проверьте адрес и порт и что агент запущен'
    : /ENOTFOUND|EAI_AGAIN/.test(code) ? 'Адрес ноды не найден'
    : /TIMEOUT|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/.test(code) ? 'Нода не отвечает'
    : /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code) ? 'Сертификат ноды не прошёл проверку'
    : 'Нода недоступна: ' + (e.message || code);
  return bad(msg, 502);
}
const auth = n => ({ authorization: 'Bearer ' + n.token });
const badToken = () => bad('Нода не приняла токен: проверьте AGENT_TOKEN на ноде', 502);

export async function json(n, method, path, body, timeout = 10000) {
  let res;
  try {
    res = await request(n.url + '/api' + path, {
      method,
      headers: { ...auth(n), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      headersTimeout: timeout, bodyTimeout: timeout,
    });
  } catch (e) { throw mapErr(e); }
  const text = await res.body.text();
  let data = {};
  try { data = JSON.parse(text); } catch {}
  if (res.statusCode === 401) throw badToken();
  if (res.statusCode >= 400) throw bad(data.error || `Нода ответила ${res.statusCode}`, res.statusCode);
  return data;
}

/* ---------- состояние нод ---------- */
export function refresh(n, maxAge = 0) {
  const st = status.get(n.id);
  if (st && Date.now() - st.checkedAt < maxAge) return Promise.resolve(st);
  if (inflight.has(n.id)) return inflight.get(n.id);
  const p = (async () => {
    try {
      const [me, hostInfo, servers] = await Promise.all([
        json(n, 'GET', '/me', undefined, 6000),
        json(n, 'GET', '/host', undefined, 6000),
        json(n, 'GET', '/servers', undefined, 10000),
      ]);
      let changed = false;
      for (const s of servers) if (db().placement[s.id] !== n.id) { db().placement[s.id] = n.id; changed = true; }
      if (changed) store.save();
      const next = { online: true, checkedAt: Date.now(), error: null, version: me.version || '', hostInfo, servers };
      status.set(n.id, next);
      return next;
    } catch (e) {
      const next = { ...(status.get(n.id) || {}), online: false, checkedAt: Date.now(), error: e.message };
      status.set(n.id, next);
      return next;
    } finally { inflight.delete(n.id); }
  })();
  inflight.set(n.id, p);
  return p;
}

export function startPolling() {
  const tick = () => all().forEach(n => refresh(n));
  tick();
  setInterval(tick, 5000).unref?.();
}

export function publicNode(n) {
  const st = status.get(n.id) || {};
  const hi = st.hostInfo;
  return {
    id: n.id, name: n.name, url: n.url, publicHost: n.publicHost || '', host: hostOf(n),
    online: !!st.online, checked: !!st.checkedAt, error: st.error || null, version: st.version || '',
    servers: st.servers ? st.servers.length : null,
    hostInfo: hi ? {
      cpu: hi.cpu, cores: hi.cores, model: hi.model, memUsed: hi.memUsed, memTotal: hi.memTotal,
      disk: hi.disk, uptime: hi.uptime,
    } : null,
  };
}

/** Серверы всех нод для общего списка. Если нода недоступна, показываем последние известные данные. */
export async function allServers() {
  const list = all();
  const sts = await Promise.all(list.map(n => refresh(n, 1500)));
  return list.flatMap((n, i) => (sts[i].servers || []).map(s => ({
    ...s, node: tag(n),
    ...(sts[i].online ? {} : { state: 'unreachable', busy: null, error: null }),
  })));
}

/* ---------- где живёт сервер ---------- */
export const place = (id, nodeId) => { if (db().placement[id] !== nodeId) { db().placement[id] = nodeId; store.save(); } };
export const unplace = id => { if (id in db().placement) { delete db().placement[id]; store.save(); } };
export async function locate(id) {
  let nid = db().placement[id];
  if (!nid) { await Promise.all(all().map(n => refresh(n, 3000))); nid = db().placement[id]; }
  return nid ? get(nid) : null;
}

/* ---------- управление списком нод ---------- */
async function verify(n) {
  const me = await json(n, 'GET', '/me', undefined, 8000);
  if (!me.agent) throw bad('Нода ответила, но режим агента на ней не включён (AGENT_TOKEN)', 502);
}

export async function add(b) {
  const n = { id: crypto.randomBytes(4).toString('hex'), name: cleanName(b.name), url: cleanUrl(b.url), token: cleanToken(b.token), publicHost: cleanHost(b.publicHost) };
  if (all().some(x => x.url === n.url)) throw bad('Нода с таким адресом уже добавлена');
  await verify(n);
  db().nodes.push(n);
  store.save();
  await refresh(n);
  const key = db().settings.cfApiKey;
  if (key) json(n, 'PUT', '/settings', { cfApiKey: key }, 25000).catch(e => console.error('Ключ CurseForge не передан ноде:', e.message));
  return n;
}

export async function update(id, b) {
  const n = get(id);
  if (!n) throw bad('Нода не найдена', 404);
  const next = { ...n };
  if ('name' in b) next.name = cleanName(b.name);
  if ('publicHost' in b) next.publicHost = cleanHost(b.publicHost);
  if ('url' in b && b.url) next.url = cleanUrl(b.url);
  if ('token' in b && b.token) next.token = cleanToken(b.token);
  if (next.url !== n.url || next.token !== n.token) {
    if (all().some(x => x.id !== id && x.url === next.url)) throw bad('Нода с таким адресом уже добавлена');
    await verify(next);
  }
  Object.assign(n, next);
  store.save();
  await refresh(n);
  return n;
}

export function remove(id) {
  const n = get(id);
  if (!n) throw bad('Нода не найдена', 404);
  db().nodes = db().nodes.filter(x => x.id !== id);
  for (const [sid, nid] of Object.entries(db().placement)) if (nid === id) delete db().placement[sid];
  status.delete(id);
  store.save();
}

/** Передаёт изменение настроек (например, ключ CurseForge) всем доступным нодам. Ошибки только в журнал. */
export function broadcast(body) {
  for (const n of all()) {
    if (!status.get(n.id)?.online) continue;
    json(n, 'PUT', '/settings', body, 25000).catch(e => console.error(`Настройки не переданы ноде «${n.name}»:`, e.message));
  }
}

/* ---------- проксирование HTTP ---------- */
const PASS = ['content-type', 'content-length', 'content-disposition', 'content-range', 'accept-ranges', 'cache-control', 'etag', 'last-modified'];
const FWD = ['content-type', 'content-length', 'accept', 'range', 'if-none-match', 'if-modified-since'];

/** Пересылает запрос браузера агенту и возвращает его ответ. annotate(data) может дополнить JSON-ответ. */
export async function proxy(n, req, res, opts = {}) {
  const u = new URL(req.originalUrl, 'http://x');
  u.searchParams.delete('node');
  const path = u.pathname.replace(/^\/api/, '') + u.search;
  const headers = { ...auth(n) };
  for (const k of FWD) if (req.headers[k]) headers[k] = req.headers[k];
  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (req._body) { // JSON уже прочитан глобальным парсером
      body = JSON.stringify(req.body ?? {});
      delete headers['content-length'];
      headers['content-type'] = 'application/json';
    } else body = req;
  }
  let r;
  try {
    r = await request(n.url + '/api' + path, {
      method: req.method, headers, body,
      headersTimeout: body === req ? 3600e3 : 60e3, // загрузка архива и его разбор на ноде могут идти долго
      bodyTimeout: 0,
    });
  } catch (e) { throw mapErr(e); }
  if (r.statusCode === 401) { r.body.resume(); throw badToken(); }
  const ct = String(r.headers['content-type'] || '');
  if (opts.annotate && r.statusCode < 300 && ct.includes('application/json')) {
    let data = null;
    try { data = JSON.parse(await r.body.text()); } catch {}
    if (data && typeof data === 'object') opts.annotate(data);
    opts.onDone?.(r.statusCode);
    return res.status(r.statusCode).json(data ?? {});
  }
  opts.onDone?.(r.statusCode);
  res.status(r.statusCode);
  for (const k of PASS) if (r.headers[k]) res.setHeader(k, r.headers[k]);
  res.on('close', () => { if (!r.body.destroyed) r.body.destroy(); });
  pipeline(r.body, res, () => {});
}

/* ---------- проксирование консоли (WebSocket) ---------- */
export function proxyWs(n, req, socket, head, wss, serverId) {
  const url = n.url.replace(/^http/, 'ws') + `/ws/servers/${serverId}/console`;
  const up = new WebSocket(url, { headers: auth(n), handshakeTimeout: 8000 });
  let opened = false;
  up.on('error', () => {
    if (!opened) { try { socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch {} socket.destroy(); }
  });
  up.on('open', () => {
    opened = true;
    wss.handleUpgrade(req, socket, head, ws => {
      ws.on('message', d => { if (up.readyState === 1) up.send(d.toString()); });
      up.on('message', d => { if (ws.readyState === 1) ws.send(d.toString()); });
      ws.on('close', () => { try { up.close(); } catch {} });
      up.on('close', () => { try { ws.close(); } catch {} });
      ws.on('error', () => {});
    });
  });
}

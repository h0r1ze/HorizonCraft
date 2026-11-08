import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import net from 'net';
import http from 'http';
import https from 'https';
import os from 'os';
import * as store from '../store.js';
import { DATA_DIR } from '../dock.js';
import * as C from './certs.js';
import { Acme, DIRECTORY } from './acme.js';
import * as CH from './challenge.js';
import * as PC from './portchange.js';

/* HTTPS для самой панели. Панель сама завершает TLS на том порту, который выбрал администратор (в контейнере 8088,
   снаружи PANEL_PORT), поэтому отдельный обратный прокси не нужен.

   Режимы сертификата, как в 3x-ui:
     letsencrypt-domain  Let's Encrypt для домена (проверка http-01 на порту 80)
     letsencrypt-ip      Let's Encrypt для публичного IP-адреса (профиль shortlived, 160 часов, продление автоматически)
     selfsigned          самоподписанный: для локальной сети, куда Let's Encrypt сертификат не выдаст
     custom              свой сертификат и ключ
     off                 без шифрования (HTTP)
   Один и тот же порт понимает и TLS, и обычный HTTP: открытый HTTP получает перенаправление на HTTPS. */

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
export const MODES = ['off', 'selfsigned', 'letsencrypt-domain', 'letsencrypt-ip', 'custom'];
const DIR = path.join(DATA_DIR, 'tls');
const F = { cert: path.join(DIR, 'cert.pem'), key: path.join(DIR, 'key.pem'), custom: path.join(DIR, 'custom.pem'), customKey: path.join(DIR, 'custom.key') };
const HOUR = 3600e3, DAY = 24 * HOUR;

let docker = null;
let active = null;          // { cert, key, info, kind: 'selfsigned' | 'acme' | 'custom' | 'fallback' }
let httpsServer = null;     // HTTPS-сервер, которому передаётся действующий сертификат
let job = null;             // текущий или последний выпуск
let timer = null;
let lastAttempt = 0;
const emptyJob = () => ({ running: false, steps: [], error: '', startedAt: 0, finishedAt: 0, mode: '' });

/* ---------- настройки ---------- */
export function cfg() {
  const db = store.get();
  const fresh = !db.tls;
  const t = (db.tls ??= {});
  if (fresh) {
    const m = String(process.env.TLS_MODE || '');
    t.mode = MODES.includes(m) ? m : 'off';
    t.host = String(process.env.TLS_HOST || '').trim().toLowerCase();
    t.hosts = process.env.TLS_HOSTS ? C.cleanNames(process.env.TLS_HOSTS) : [];
    t.email = String(process.env.ACME_EMAIL || '').trim();
    t.staging = process.env.ACME_STAGING === '1';
    t.acmePort = Number(process.env.ACME_PORT) || 80;
    store.save();
  }
  t.mode ??= 'off'; t.host ??= ''; t.hosts ??= []; t.email ??= ''; t.staging ??= false; t.acmePort ??= 80;
  return t;
}
const isLe = m => m === 'letsencrypt-domain' || m === 'letsencrypt-ip';

/** Частные и служебные адреса, на которые Let's Encrypt сертификат не выдаёт. */
export function isPublicIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return !(a === 10 || a === 127 || a === 0 || a >= 224 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)));
  }
  if (v === 6) { const x = ip.toLowerCase(); return !(x === '::1' || x === '::' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith('ff') || x.startsWith('::ffff:') || x.startsWith('2001:db8')); }
  return false;
}

/** Имена для сертификата: основной адрес, дополнительные и всегда localhost. */
export function namesFor(t = cfg()) {
  const out = [];
  const add = n => { if (n && !out.includes(n)) out.push(n); };
  add(t.host); t.hosts.forEach(add);
  if (t.mode === 'selfsigned') {
    if (!out.length) for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) add(a.address);
    add('localhost'); add('127.0.0.1');
  }
  return out;
}

/* ---------- файлы ---------- */
const write = (file, text, mode = 0o600) => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(file, text, { mode }); try { fs.chmodSync(file, mode); } catch {} };
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

function setActive(cert, key, kind) {
  const info = C.certInfo(cert);
  active = { cert, key, info, kind };
  // Сертификат по умолчанию: клиенты, которые заходят по IP-адресу, не передают имя (SNI), и им нужен именно он
  httpsServer?.setSecureContext({ cert, key, minVersion: 'TLSv1.2' });
  return active;
}
function persist(cert, key, kind) {
  write(F.cert, cert, 0o644); write(F.key, key);
  write(path.join(DIR, 'meta.json'), JSON.stringify({ kind, at: Date.now() }), 0o644);
  return setActive(cert, key, kind);
}
function loadActive() {
  const cert = read(F.cert), key = read(F.key);
  if (!cert || !key) return null;
  let kind = 'selfsigned';
  try { kind = JSON.parse(read(path.join(DIR, 'meta.json'))).kind || kind; } catch {}
  try { C.checkPair(cert, key); } catch { return null; }
  return setActive(cert, key, kind);
}
/** Временный сертификат в памяти: панель остаётся доступной по HTTPS, пока настоящий не выпущен. */
function fallback() {
  const names = namesFor({ ...cfg(), mode: 'selfsigned' });
  const s = C.selfSigned(names.length ? names : ['localhost'], { days: 30 });
  return setActive(s.cert, s.key, 'fallback');
}

/* ---------- самоподписанный и свой ---------- */
export function makeSelfSigned() {
  const names = namesFor({ ...cfg(), mode: 'selfsigned' });
  const s = C.selfSigned(names);
  return persist(s.cert, s.key, 'selfsigned');
}
export function setCustom(certPem, keyText) {
  const info = C.checkPair(certPem, keyText);
  write(F.custom, certPem, 0o644); write(F.customKey, keyText);
  persist(certPem, keyText, 'custom');
  return info;
}
const hasCustom = () => !!read(F.custom) && !!read(F.customKey);

/* ---------- Let's Encrypt ---------- */
const directoryOf = t => process.env.ACME_DIRECTORY || (t.staging ? DIRECTORY.staging : DIRECTORY.production);
function accountKey(dir) {
  const file = path.join(DIR, `acme-${crypto.createHash('sha1').update(dir).digest('hex').slice(0, 10)}.key`);
  const pemText = read(file);
  if (pemText) { try { return crypto.createPrivateKey(pemText); } catch {} }
  const k = C.newKey(); write(file, C.keyPem(k)); return k;
}

function strategy(t) {
  if (process.env.ACME_CHALLENGE === 'inprocess') return CH.inProcess({ port: t.acmePort });
  if (!docker) throw bad('Docker недоступен: панели нечем временно открыть порт для проверки адреса');
  return CH.container(docker, { hostPort: t.acmePort });
}

export function validateLe(t) {
  if (t.mode === 'letsencrypt-ip') {
    if (!net.isIP(t.host)) throw bad('Для сертификата на IP-адрес укажите именно IP-адрес (например 203.0.113.10), а не домен.');
    // со своим ACME-каталогом (внутренний центр сертификации) локальные адреса допустимы
    if (!isPublicIp(t.host) && !process.env.ACME_DIRECTORY) throw bad(`${t.host} это локальный адрес, и Let's Encrypt не выдаёт сертификаты на такие адреса. В локальной сети используйте самоподписанный сертификат, а Let's Encrypt для домена или публичного IP-адреса.`);
    if (t.hosts.length) throw bad('Сертификат на IP-адрес выпускается для одного адреса, дополнительные имена не поддерживаются.');
  } else {
    if (!t.host || net.isIP(t.host)) throw bad('Для Let\'s Encrypt по домену укажите доменное имя, которое указывает на этот сервер.');
    if (!t.host.includes('.') || t.host.endsWith('.local') || t.host.endsWith('.lan') || t.host.endsWith('.internal')) throw bad('Это не публичное доменное имя: Let\'s Encrypt выдаёт сертификаты только на домены из интернета.');
    if (t.hosts.some(n => net.isIP(n))) throw bad('Дополнительные имена должны быть доменами.');
  }
}

export async function issue(reason = 'manual') {
  if (job?.running) return job;
  const t = cfg();
  if (!isLe(t.mode)) throw bad('Выпуск Let\'s Encrypt включается в режиме «Let\'s Encrypt для домена» или «для IP-адреса»');
  validateLe(t);
  const names = namesFor(t), mode = t.mode;
  job = { ...emptyJob(), running: true, startedAt: Date.now(), mode };
  const cur = job;
  const log = s => { cur.steps.push({ at: Date.now(), text: s }); };
  lastAttempt = Date.now();
  (async () => {
    try {
      const dir = directoryOf(t);
      log(dir === DIRECTORY.staging ? 'Тестовый сервер Let\'s Encrypt (сертификат не будет доверенным)' : `Выпуск через ${new URL(dir).host}`);
      const acme = new Acme({ directory: dir, accountKey: accountKey(dir), email: t.email, insecure: process.env.ACME_INSECURE === '1' });
      const key = C.newKey();
      const r = await acme.issue({
        names, profile: mode === 'letsencrypt-ip' ? 'shortlived' : '', csr: C.makeCsr(key, names),
        challenge: strategy(t), onStatus: log,
      });
      C.checkPair(r.chain, C.keyPem(key));
      persist(r.chain, C.keyPem(key), 'acme');
      t.issuedAt = Date.now(); t.lastError = ''; t.lastErrorAt = 0; store.save();
      log('Готово: сертификат установлен');
      console.log(`TLS: сертификат выпущен для ${names.join(', ')}, действует до ${new Date(active.info.notAfter).toISOString()}`);
    } catch (e) {
      cur.error = e.message;
      t.lastError = e.message; t.lastErrorAt = Date.now(); store.save();
      log('Ошибка: ' + e.message);
      console.error('TLS: не удалось выпустить сертификат:', e.message);
    } finally { cur.running = false; cur.finishedAt = Date.now(); }
  })();
  return cur;
}

/* ---------- что нужно сделать с текущим сертификатом ---------- */
function needsRenewal(t) {
  if (!active || active.kind !== 'acme') return true;
  const names = namesFor(t);
  if (!names.every(n => C.coversHost(active.info, n))) return true;
  const left = active.info.notAfter - Date.now();
  return left < Math.max(2 * DAY, active.info.lifetimeMs / 3);
}

/** Привести сертификат в соответствие с настройками. force: выпустить заново в любом случае. */
export async function ensure({ force = false } = {}) {
  const t = cfg();
  if (t.mode === 'off') return;
  if (t.mode === 'selfsigned') {
    const names = namesFor(t);
    if (force || !active || active.kind !== 'selfsigned' || !names.every(n => C.coversHost(active.info, n)) || active.info.notAfter - Date.now() < 30 * DAY) makeSelfSigned();
    return;
  }
  if (t.mode === 'custom') {
    if (hasCustom()) { if (force || active?.kind !== 'custom') { try { persist(read(F.custom), read(F.customKey), 'custom'); } catch { if (!active) fallback(); } } }
    else if (!active) fallback();
    return;
  }
  // Let's Encrypt
  if (!active || active.info.notAfter < Date.now()) fallback();   // пока нет настоящего сертификата, отдаём временный
  if (force || needsRenewal(t)) { try { await issue(force ? 'manual' : 'auto'); } catch (e) { t.lastError = e.message; store.save(); } }
}

export function start(dockerApi) {
  docker = dockerApi;
  loadActive();
  const t = cfg();
  ensure().catch(e => console.error('TLS:', e.message));
  clearInterval(timer);
  timer = setInterval(() => {
    const c = cfg();
    if (!isLe(c.mode) || job?.running) return;
    if (Date.now() - lastAttempt < 30 * 60e3) return;      // при ошибках пробуем не чаще, чем раз в 30 минут
    if (needsRenewal(c)) issue('auto').catch(e => { c.lastError = e.message; store.save(); });
  }, 10 * 60e3);
  timer.unref?.();
  if (t.mode !== 'off') console.log(`TLS: режим ${t.mode}${t.host ? ', адрес ' + t.host : ''}`);
}

/* ---------- сервер: HTTP и HTTPS на одном порту ---------- */
export function createServer(app) {
  const plain = http.createServer(app);
  if (!active) loadActive() || fallback();
  const secure = https.createServer({ minVersion: 'TLSv1.2', cert: active.cert, key: active.key }, app);
  httpsServer = secure;
  const redirect = http.createServer((req, res) => {
    const host = req.headers.host;
    if (!host || /[\s\/\\]/.test(host)) { res.writeHead(400); return res.end(); }
    res.writeHead(308, { Location: `https://${host}${req.url}`, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Панель работает по HTTPS: https://' + host);
  });
  const mux = net.createServer({ pauseOnConnect: true }, socket => {
    socket.on('error', () => {});
    socket.setTimeout(15000, () => socket.destroy());
    socket.once('data', chunk => {
      socket.setTimeout(0);
      const isTls = chunk[0] === 0x16;
      const mode = cfg().mode;
      const target = mode === 'off' ? (isTls ? null : plain) : (isTls ? secure : redirect);
      if (!target) return socket.destroy();
      socket.pause(); socket.unshift(chunk);
      target.emit('connection', socket);
      process.nextTick(() => socket.resume());
    });
    socket.resume();
  });
  mux.servers = [plain, secure];
  mux.setMaxListeners(0);
  return mux;
}

/** Заголовки безопасности и HSTS (только для доверенного сертификата Let's Encrypt). */
export function headers(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  const t = cfg();
  if (req.secure && isLe(t.mode) && !t.staging && !process.env.ACME_DIRECTORY && active?.kind === 'acme') res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
}

/* ---------- состояние для интерфейса ---------- */
export function status(req) {
  const t = cfg();
  let nextRenewAt = 0;
  if (isLe(t.mode) && active?.kind === 'acme') nextRenewAt = active.info.notAfter - Math.max(2 * DAY, active.info.lifetimeMs / 3);
  const warn = [];
  const shown = t.mode === 'off' ? null : active;     // в режиме HTTP сертификата нет, внутренний временный не показываем
  if (t.mode === 'off') warn.push('http');
  if (shown?.kind === 'fallback') warn.push('fallback');
  return {
    mode: t.mode, host: t.host, hosts: t.hosts, email: t.email, staging: t.staging, acmePort: t.acmePort,
    secure: !!req?.secure, port: Number(process.env.PANEL_PORT) || 0, warnings: warn, portChange: PC.last(),
    cert: shown ? { ...shown.info, kind: shown.kind, names: shown.info.san } : null,
    customLoaded: hasCustom(), lastError: t.lastError || '', lastErrorAt: t.lastErrorAt || 0, issuedAt: t.issuedAt || 0, nextRenewAt,
    job: job ? { ...job, steps: job.steps.slice(-20) } : null,
    directory: process.env.ACME_DIRECTORY ? 'custom' : t.staging ? 'staging' : 'production',
  };
}

export function certPem() { return active?.cert || ''; }

/* ---------- изменение настроек ---------- */
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,30}$/;
export async function update(b) {
  const t = cfg(), before = JSON.stringify([t.mode, t.host, t.hosts, t.staging]);
  const next = { ...t };
  if ('mode' in b) { if (!MODES.includes(b.mode)) throw bad('Неизвестный режим'); next.mode = b.mode; }
  if ('host' in b) { const h = C.cleanNames([String(b.host || '')]); next.host = h[0] || ''; }
  if ('hosts' in b) next.hosts = C.cleanNames(b.hosts).filter(h => h !== next.host);
  if ('email' in b) { const e = String(b.email || '').trim(); if (e && !EMAIL.test(e)) throw bad('Некорректный адрес электронной почты'); next.email = e; }
  if ('staging' in b) next.staging = !!b.staging;
  if ('acmePort' in b) { const p = Number(b.acmePort); if (!Number.isInteger(p) || p < 1 || p > 65535) throw bad('Порт проверки: число от 1 до 65535'); next.acmePort = p; }
  if (isLe(next.mode)) validateLe(next);
  if (next.mode === 'custom' && !hasCustom()) throw bad('Сначала загрузите свой сертификат и ключ');
  if (next.mode === 'selfsigned' && next.host === '' && !namesFor({ ...next }).length) throw bad('Укажите адрес, по которому вы открываете панель');
  Object.assign(t, next);
  store.save();
  const changed = before !== JSON.stringify([t.mode, t.host, t.hosts, t.staging]);
  await ensure({ force: changed && isLe(t.mode) });
  return t;
}

export async function stop() { clearInterval(timer); }

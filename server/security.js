import fs from 'fs';
import path from 'path';
import net from 'net';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import * as store from './store.js';

/* Защита панели: заголовки, проверка источника запросов, ограничение перебора пароля, сессии и безопасные пути.
   Панель управляет Docker на хосте, поэтому вход в неё равен полному доступу к машине. */

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });

/* ---------- заголовки ---------- */
/* Политика содержимого: скрипты и стили только свои, без встроенных скриптов и eval. Картинки по https нужны
   для значков модов (CurseForge, Modrinth) и голов игроков, рамка по http(s) для карты мира (Dynmap на своём порту). */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "frame-src 'self' http: https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

export function headers(req, res, next) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  next();
}
/** Ответы API не должны оседать в кэше браузера или прокси: в них настройки и содержимое файлов. Картинки задают свой кэш сами. */
export function noStore(req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  next();
}

/* ---------- источник запроса (защита от запросов с чужих сайтов) ---------- */
const hostOnly = h => String(h || '').trim().toLowerCase();
/** Запрос пришёл с чужого сайта? Браузер сам сообщает источник: Origin и Sec-Fetch-Site подделать со страницы нельзя.
    Запросы без этих заголовков (curl, скрипты, главная панель к ноде) страницами не отправляются и пропускаются. */
export function crossSite(headers) {
  // За обратным прокси настоящий адрес панели приходит в X-Forwarded-Host. Страница чужого сайта этот заголовок задать не может.
  const hosts = [headers.host, ...String(headers['x-forwarded-host'] || '').split(',')].map(hostOnly).filter(Boolean);
  const origin = headers.origin;
  if (origin && origin !== 'null') {
    let o;
    try { o = new URL(origin).host.toLowerCase(); } catch { return true; }
    return !hosts.includes(o);
  }
  if (origin === 'null') return true;
  const sfs = headers['sec-fetch-site'];
  return !!sfs && sfs !== 'same-origin' && sfs !== 'none';
}
/** Изменяющие запросы принимаются только со страниц самой панели. Cookie и так помечена SameSite=Strict, это второй рубеж. */
export function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (crossSite(req.headers)) return res.status(403).json({ error: 'Запрос с другого сайта отклонён' });
  next();
}

/* ---------- ограничение перебора пароля ---------- */
/* По адресу: после 5 неудач пауза минута, дальше она удваивается до часа и сбрасывается через сутки без ошибок.
   По всем адресам сразу: при потоке неудач каждый вход замедляется, чтобы перебор с тысячи адресов тоже был бесполезен.
   Адреса IPv6 считаются по сети /64: один компьютер легко меняет младшие биты. */
const FREE = 5, BASE = 60e3, MAX = 3600e3, FORGET = 86400e3, GLOBAL_WIN = 600e3, GLOBAL_SLOW = 20, MAX_KEYS = 20000;
const tries = new Map();   // ключ → { n, level, until, at }
let globalFails = [];
export function ipKey(ip) {
  const s = String(ip || '').replace(/^::ffff:/i, '');
  if (net.isIPv6(s)) return s.split(':').slice(0, 4).join(':') + '::/64';
  return s || 'unknown';
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const limiter = {
  /** Бросает 429, если адрес сейчас заблокирован. Возвращает запись для отметки исхода. */
  check(ip, now = Date.now()) {
    const k = ipKey(ip), a = tries.get(k);
    if (a && a.until > now) {
      const sec = Math.ceil((a.until - now) / 1000);
      const e = bad(`Слишком много попыток. Подождите ${sec >= 120 ? Math.ceil(sec / 60) + ' мин' : sec + ' с'}.`, 429);
      e.retryAfter = sec;
      throw e;
    }
    return k;
  },
  fail(k, now = Date.now()) {
    let a = tries.get(k);
    if (!a || now - a.at > FORGET) a = { n: 0, level: 0, until: 0, at: now };
    a.n++; a.at = now;
    if (a.n >= FREE) { a.until = now + Math.min(MAX, BASE * 2 ** a.level); a.level++; a.n = 0; }
    tries.set(k, a);
    globalFails.push(now);
    if (tries.size > MAX_KEYS) for (const [key, v] of tries) { if (v.until < now && now - v.at > BASE) tries.delete(key); if (tries.size <= MAX_KEYS / 2) break; }
  },
  ok(k) { tries.delete(k); },
  /** Замедление при массовом переборе. */
  async slow(now = Date.now()) {
    globalFails = globalFails.filter(t => now - t < GLOBAL_WIN);
    if (globalFails.length >= GLOBAL_SLOW) await sleep(Math.min(5000, 1000 + (globalFails.length - GLOBAL_SLOW) * 100));
  },
  reset() { tries.clear(); globalFails = []; },
  state: k => tries.get(k) || null,
};

/* ---------- пароль ---------- */
export const BCRYPT_COST = 12;
const DUMMY = bcrypt.hashSync('horizoncraft-dummy', BCRYPT_COST);
const WEAK = new Set(['password', 'password1', '12345678', '123456789', '1234567890', 'qwertyui', 'qwerty123', 'qwertyuiop', 'admin123', 'administrator',
  'minecraft', 'minecraft1', 'horizoncraft', 'change-me-please', 'changeme', 'letmein123', '11111111', '00000000', 'iloveyou', 'пароль123', 'йцукенгш']);
/** Слабый пароль: короче 10 символов, из известных или из одного вида символов (только цифры или одна повторяющаяся буква). */
export function weakPassword(p) {
  const s = String(p || '');
  return s.length < 10 || WEAK.has(s.toLowerCase()) || /^\d+$/.test(s) || /^(.)\1*$/.test(s);
}
export function checkNewPassword(p) {
  const s = String(p ?? '');
  if (s.length < 8) throw bad('Новый пароль: минимум 8 символов');
  if (s.length > 200) throw bad('Новый пароль: не больше 200 символов');
  if (WEAK.has(s.toLowerCase()) || /^(.)\1*$/.test(s)) throw bad('Этот пароль слишком простой, его подбирают первым. Придумайте другой.');
  return s;
}
/** Сверяет пароль. Без пользователя всё равно считает хеш, чтобы по времени ответа нельзя было отличить один случай от другого. */
export async function verifyPassword(password) {
  const u = store.get().user;
  const p = String(password ?? '').slice(0, 1000);
  const ok = await bcrypt.compare(p, u?.hash || DUMMY);
  return !!u && ok;
}
export const hashPassword = p => bcrypt.hash(String(p), BCRYPT_COST);
/** Старые хеши с меньшей стоимостью пересчитываются при удачном входе. */
export async function upgradeHash(password) {
  const u = store.get().user;
  let changed = false;
  try { if (bcrypt.getRounds(u.hash) < BCRYPT_COST) { u.hash = await hashPassword(password); changed = true; } } catch {}
  const weak = weakPassword(password);
  if (!!u.weak !== weak) { if (weak) u.weak = true; else delete u.weak; changed = true; }
  if (changed) store.save();
}

/* ---------- сессии ---------- */
/* В токене записан номер поколения сессий. Смена пароля и «Выйти на всех устройствах» увеличивают его,
   и все выданные раньше токены перестают приниматься, даже если их украли. */
export const COOKIE = 'mcp_token';
const TTL_DAYS = 7;
const gen = () => store.get().user?.gen || 0;
export function issue(res, req) {
  const t = jwt.sign({ u: 'admin', g: gen() }, store.get().secret, { algorithm: 'HS256', expiresIn: `${TTL_DAYS}d` });
  res.cookie(COOKIE, t, { httpOnly: true, sameSite: 'strict', secure: !!req.secure, path: '/', maxAge: TTL_DAYS * 864e5 });
}
export function clear(res, req) {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'strict', secure: !!req?.secure, path: '/' });
}
export function verify(token) {
  const p = jwt.verify(String(token || ''), store.get().secret, { algorithms: ['HS256'] });
  if (p.u !== 'admin' || (p.g || 0) !== gen()) throw new Error('сессия отозвана');
  return p;
}
/** Отзывает все сессии. */
export function revokeAll() {
  const u = store.get().user;
  if (!u) return;
  u.gen = (u.gen || 0) + 1;
  store.save();
}
export const cookieOf = headers => /(?:^|;\s*)mcp_token=([^;]+)/.exec(headers.cookie || '')?.[1] || '';

/* ---------- безопасные пути внутри папки сервера ---------- */
/* Папку сервера видит и сам сервер Minecraft: плагин или мод может создать в ней символическую ссылку наружу.
   Панель работает с правами root, поэтому перед чтением и записью проверяет, куда путь ведёт на самом деле. */
const inside = (root, p) => p === root || p.startsWith(root + path.sep);
/** Настоящий путь ближайшей существующей части p (для ещё не созданных файлов и папок). */
function realOfExisting(p) {
  let cur = p;
  for (let i = 0; i < 64; i++) {
    try { return { real: fs.realpathSync(cur), exact: cur === p }; }
    catch (e) {
      // битая ссылка: lstat видит её, а realpath нет. Такая запись тоже ведёт неизвестно куда
      try { if (fs.lstatSync(cur).isSymbolicLink()) throw bad('Недопустимый путь: символическая ссылка'); } catch (x) { if (x.status) throw x; }
      const up = path.dirname(cur);
      if (up === cur) break;
      cur = up;
    }
  }
  throw bad('Недопустимый путь');
}
/** Путь rel внутри base. Бросает ошибку, если он выходит наружу напрямую («..») или через символическую ссылку. */
export function resolveInside(base, rel = '') {
  base = path.resolve(base);
  const p = path.resolve(base, '.' + path.sep + String(rel ?? '').replace(/\0/g, '').replace(/^[\\/]+/, ''));
  if (!inside(base, p)) throw bad('Недопустимый путь');
  let rb;
  try { rb = fs.realpathSync(base); } catch { return { base, p }; }   // папки сервера ещё нет: проверять нечего
  if (!inside(rb, realOfExisting(p).real)) throw bad('Недопустимый путь');
  return { base, p };
}
/** Перед записью файла панелью: родительская папка должна быть внутри base, а на месте файла не должно быть ссылки
    (ссылку убираем: запись пойдёт в обычный файл, а не туда, куда она указывала). */
export function guardWrite(base, file) {
  base = path.resolve(base); file = path.resolve(file);
  if (!inside(base, file) || file === base) throw bad('Недопустимый путь');
  let rb;
  try { rb = fs.realpathSync(base); } catch { return file; }
  if (!inside(rb, realOfExisting(path.dirname(file)).real)) throw bad('Недопустимый путь: папка ведёт за пределы сервера');
  try { if (fs.lstatSync(file).isSymbolicLink()) fs.unlinkSync(file); } catch {}
  return file;
}
/** В папке dest нет символических ссылок на пути записей архива? names: пути из архива. */
export function assertNoLinks(dest, names) {
  const seen = new Set();
  for (const n of names) {
    const parts = String(n).split(/[\\/]/).filter(x => x && x !== '.');
    let cur = dest;
    for (const part of parts) {
      cur = path.join(cur, part);
      if (seen.has(cur)) continue;
      seen.add(cur);
      let st;
      try { st = fs.lstatSync(cur); } catch { break; }      // дальше ничего нет, распаковка создаст сама
      if (st.isSymbolicLink()) throw bad(`В папке сервера «${path.relative(dest, cur)}» является символической ссылкой. Распаковка поверх ссылок запрещена: удалите её и повторите.`);
      if (!st.isDirectory()) break;
    }
    if (seen.size > 200000) break;
  }
}
/** Имя загружаемого файла: только последняя часть пути, без управляющих символов. */
export function cleanFileName(name) {
  const s = path.basename(String(name || '').replace(/\\/g, '/')).replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (!s || s === '.' || s === '..' || s.length > 255) throw bad('Недопустимое имя файла');
  return s;
}
/** Смена владельца без перехода по ссылке. */
export const lchown = (p, uid = 1000, gid = 1000) => { try { fs.lchownSync(p, uid, gid); } catch {} };
export const randomToken = (n = 32) => crypto.randomBytes(n).toString('hex');

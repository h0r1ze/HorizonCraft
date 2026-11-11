import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import * as dk from './dock.js';

/* Неудачные попытки входа: игроки, которых сервер не пустил (белый список, бан, сервер полон, ошибка проверки
   лицензии и другое) или которые отвалились, не успев войти. Берутся из журналов сервера (logs/latest.log и архивы
   за последние дни), поэтому список доступен и при остановленном сервере. Если игрок после неудачи всё же зашёл,
   он из списка пропадает. */

const NICK = '[A-Za-z0-9_.]{1,32}';
const WHO = `(?:(?:com\\.mojang\\.authlib\\.)?GameProfile(?:@[0-9a-f]+)?\\[id=[^,\\]]*,\\s*name=(${NICK})[^\\]]*\\]|(${NICK}))`;
const ADDR = '\\(/\\[?([0-9a-fA-F.:]+?)\\]?(?::\\d+)?\\)';
const LINE = /^\[(\d\d):(\d\d):(\d\d)\] \[[^\]]*\/(?:INFO|WARN)\](?: \[[^\]]*\])?: (.*)$/;
const DISC = new RegExp(`^Disconnecting ${WHO} ${ADDR}: (.*)$`);
const LOST = new RegExp(`^${WHO} ${ADDR} lost connection: (.*)$`);
const JOIN = new RegExp(`^(${NICK}) joined the game$`);
const AUTH = new RegExp(`^UUID of player (${NICK}) is `);
const AUTH_GAP = 120e3;   // «прервал вход» считается попыткой, только если вход начался незадолго до этого
const JOIN2 = new RegExp(`^(${NICK})\\[/[^\\]]+\\] logged in with entity id`);

const BOOT = /^\[bootstrap\]|^Starting minecraft server version|^Loading Paper|^Environment: /;
const MAX_FILES = 20, MAX_AGE = 30 * 86400e3, MAX_BYTES = 40 * 1024 * 1024, MERGE = 5000;

/** Причина отказа по тексту сервера (английский текст или ключ перевода). */
export function kindOf(text) {
  const t = String(text);
  if (/white-?listed|not_whitelisted/i.test(t)) return 'whitelist';
  if (/banned/i.test(t)) return 'banned';
  if (/server is full|server_full/i.test(t)) return 'full';
  if (/verify username|unverified_username|invalid session|authentication servers|not authenticated|invalid_public_key|profile public key/i.test(t)) return 'auth';
  if (/outdated|incompatible|mismatch|missing mods|mod rejections|version/i.test(t)) return 'version';
  if (/^(disconnected|timed out|connection reset|end of stream)|internal exception|multiplayer\.disconnect\.generic/i.test(t)) return 'left';
  return 'other';
}

/** Разбор текста одного файла журнала. day: полночь дня, к которому относится файл (мс).
    Возвращает { fails, joins, end, gone, boot }: end — кто остался в игре к концу файла, gone — кто выходил,
    boot — был ли в файле запуск сервера. Выход в начале файла без входа помечается cont: игрок мог зайти ещё в прошлом файле
    (журнал переключается в полночь), это решается при сборке файлов по порядку. */
export function parse(text, day) {
  const fails = [], joins = [], inGame = new Set(), gone = new Set();   // кто сейчас в игре: их выход — обычный выход, а не неудачная попытка
  let boot = false;
  const authAt = new Map();
  for (const raw of String(text).split('\n')) {
    const m = LINE.exec(raw.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r$/, ''));
    if (!m) continue;
    const t = day + (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000, msg = m[4];
    let x;
    if (BOOT.test(msg)) { boot = true; inGame.clear(); continue; }
    if ((x = AUTH.exec(msg))) { authAt.set(x[1].toLowerCase(), t); continue; }
    if ((x = DISC.exec(msg)) || (x = LOST.exec(msg))) {
      const name = x[1] || x[2], k = name.toLowerCase(), text = x[4].replace(/§./g, '').trim().slice(0, 160);
      gone.add(k);
      if (inGame.delete(k)) continue;
      const prev = fails[fails.length - 1];
      // «Disconnecting …» и следом «… lost connection» описывают одну попытку: оставляем более содержательную причину
      if (prev && prev.name === name && t - prev.t <= MERGE) { if (prev.kind === 'left') { prev.kind = kindOf(text); prev.text = text; } continue; }
      // голое «lost connection» без начала входа рядом — это выход игрока, вошедшего раньше, чем начинается журнал
      const kind = kindOf(text);
      if (kind === 'left' && !(t - (authAt.get(k) ?? -Infinity) <= AUTH_GAP)) continue;
      fails.push({ t, name, ip: x[3], kind, text, ...(boot ? {} : { cont: true }) });
    } else if ((x = JOIN.exec(msg)) || (x = JOIN2.exec(msg))) {
      const k = x[1].toLowerCase();
      if (!inGame.has(k)) joins.push({ t, name: x[1] });
      inGame.add(k);
    }
  }
  return { fails, joins, end: [...inGame], gone: [...gone], boot };
}

const cache = new Map();   // путь архива -> { key, data }
const midnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

function readLogs(id) {
  const dir = path.join(dk.serverDir(id), 'logs');
  const out = { fails: [], joins: [] };
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  const now = Date.now();
  const arch = names.map(n => ({ n, m: /^(\d{4})-(\d\d)-(\d\d)-\d+\.log(\.gz)?$/.exec(n) })).filter(x => x.m)
    .map(x => ({ n: x.n, gz: !!x.m[4], day: new Date(+x.m[1], +x.m[2] - 1, +x.m[3]).getTime() }))
    .filter(x => now - x.day < MAX_AGE).sort((a, b) => b.day - a.day || b.n.localeCompare(a.n, 'en', { numeric: true })).slice(0, MAX_FILES).reverse();
  // файлы идут по порядку: кто остался в игре в конце файла, тот мог выйти уже в следующем (после полуночи)
  let carried = new Set();
  const add = d => {
    out.fails.push(...d.fails.filter(f => !(f.cont && carried.has(f.name.toLowerCase()))));
    out.joins.push(...d.joins);
    carried = d.boot ? new Set(d.end) : new Set([...[...carried].filter(k => !d.gone.includes(k)), ...d.end]);
  };
  for (const a of arch) {
    const file = path.join(dir, a.n);
    try {
      const st = fs.statSync(file), key = `${st.size}:${st.mtimeMs}`;
      let c = cache.get(file);
      if (!c || c.key !== key) {
        if (st.size > MAX_BYTES) continue;
        const buf = fs.readFileSync(file);
        c = { key, data: parse((a.gz ? zlib.gunzipSync(buf) : buf).toString('utf8'), a.day) };
        cache.set(file, c);
      }
      add(c.data);
    } catch {}
  }
  try {
    const file = path.join(dir, 'latest.log'), st = fs.statSync(file);
    if (st.size <= MAX_BYTES) {
      // в latest.log только время: день берём по времени изменения файла
      const d = parse(fs.readFileSync(file, 'utf8'), midnight(st.mtime));
      const lim = st.mtimeMs + 120e3;
      for (const k of ['fails', 'joins']) for (const e of d[k]) if (e.t > lim) e.t -= 86400e3;
      add(d);
    }
  } catch {}
  for (const f of cache.keys()) if (f.startsWith(dir + path.sep) && !arch.some(a => path.join(dir, a.n) === f)) cache.delete(f);
  return out;
}

/** Сводка по никам: последняя причина, время, число попыток, адрес. hidden: { ник в нижнем регистре: время, до которого попытки скрыты }. */
export function summarize({ fails, joins }, hidden = {}) {
  const lastJoin = new Map();
  for (const j of joins) { const k = j.name.toLowerCase(); if (!(lastJoin.get(k) >= j.t)) lastJoin.set(k, j.t); }
  const by = new Map();
  for (const f of [...fails].sort((a, b) => a.t - b.t)) {
    const k = f.name.toLowerCase();
    if (f.t <= (lastJoin.get(k) || 0) || f.t <= (hidden[k] || 0)) continue;
    const e = by.get(k) || { name: f.name, count: 0, first: f.t };
    Object.assign(e, { name: f.name, count: e.count + 1, last: f.t, kind: f.kind, text: f.text, ip: f.ip });
    by.set(k, e);
  }
  return [...by.values()].sort((a, b) => b.last - a.last).slice(0, 100);
}

export const list = cfg => summarize(readLogs(cfg.id), cfg.attemptsHidden || {});

/** Скрывает попытки игрока (или всех) до текущего момента. Новые попытки снова появятся. */
export function hide(cfg, name) {
  const h = (cfg.attemptsHidden ||= {}), now = Date.now();
  if (name) h[String(name).toLowerCase()] = now;
  else for (const e of list(cfg)) h[e.name.toLowerCase()] = now;
  for (const k of Object.keys(h)) if (now - h[k] > MAX_AGE) delete h[k];
}

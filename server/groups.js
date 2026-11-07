import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as store from './store.js';
import * as dk from './dock.js';
import { cfFetch } from './net.js';

/* Группы игроков: ADMIN, MODERATOR, VIP, FLY, HORIZON.
   Права выдаёт плагин LuckPerms, команды /fly и /tp даёт EssentialsX. Панель сама скачивает оба плагина с Modrinth,
   создаёт в LuckPerms пять групп и назначает игрокам группу командами через RCON. Цветная приписка группы
   показывается так же, как обычные приписки к никам (команда team). Работает на Paper и Purpur. */

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });

export const SUPPORTED = ['PAPER', 'PURPUR'];

// Телепорт по запросу: игрок просит другого (/tpa) или приглашает к себе (/tpahere), второй принимает или отклоняет.
const TP_REQUEST = ['essentials.tpa', 'essentials.tpahere', 'essentials.tpaccept', 'essentials.tpdeny', 'essentials.tpacancel'];

export const GROUPS = [
  {
    id: 'admin', name: 'ADMIN', prefix: '&c&l[ADMIN]', weight: 100, title: 'Полный доступ', perms: ['*'],
    can: ['Все команды сервера и всех плагинов', 'Выдача предметов, смена режима игры, управление правами'], cant: [],
  },
  {
    id: 'moderator', name: 'MODERATOR', prefix: '&9&l[MODERATOR]', weight: 80, title: 'Доступ с ограничениями',
    perms: ['essentials.kick', 'essentials.ban', 'essentials.tempban', 'essentials.unban', 'essentials.mute', 'essentials.tp', 'essentials.tphere',
      'essentials.vanish', 'essentials.invsee', 'essentials.seen', 'essentials.whois', 'essentials.fly', ...TP_REQUEST],
    can: ['Кик, бан (в том числе временный) и мут', 'Телепорт к игрокам и игроков к себе', 'Невидимость, просмотр инвентаря, полёт'],
    cant: ['Выдача предметов и смена режима игры', 'OP и управление правами', 'Остановка сервера'],
  },
  {
    id: 'vip', name: 'VIP', prefix: '&e&l[VIP]', weight: 60, title: 'Полёт и телепорт', perms: ['essentials.fly', ...TP_REQUEST],
    can: ['Полёт (/fly)', 'Телепорт по запросу (/tpa, /tpahere)'], cant: ['Кик, бан и остальные команды'],
  },
  {
    id: 'fly', name: 'FLY', prefix: '&a&l[FLY]', weight: 40, title: 'Только полёт', perms: ['essentials.fly'],
    can: ['Полёт (/fly)'], cant: ['Телепорт и остальные команды'],
  },
  {
    id: 'horizon', name: 'HORIZON', prefix: '&7&l[HORIZON]', weight: 20, title: 'Обычный игрок, телепорт', perms: [...TP_REQUEST],
    can: ['Телепорт по запросу (/tpa, /tpahere)'], cant: ['Полёт и любые привилегии'],
  },
];
const NICK = /^[A-Za-z0-9_.]{1,32}$/;
const BY_ID = Object.fromEntries(GROUPS.map(g => [g.id, g]));
export const groupById = id => BY_ID[id] || null;
// Игрок без назначенной группы получает группу LuckPerms «default»: ей выдаются права HORIZON.
const DEFAULT_PERMS = BY_ID.horizon.perms;

/* ---------- плагины ---------- */
const PLUGINS = [
  { key: 'luckperms', slug: 'luckperms', title: 'LuckPerms', jar: /^luckperms.*\.jar$/i },
  { key: 'essentials', slug: 'essentialsx', title: 'EssentialsX', jar: /^essentials(x)?[-_.]?\d.*\.jar$|^essentials\.jar$|^essentialsx\.jar$/i },
];
const pluginsDir = cfg => path.join(dk.serverDir(cfg.id), 'plugins');
const files = cfg => { try { return fs.readdirSync(pluginsDir(cfg)); } catch { return []; } };
export const jarsOf = cfg => Object.fromEntries(PLUGINS.map(p => [p.key, files(cfg).some(n => p.jar.test(n))]));

/** Скачивает недостающие плагины. Выбирается свежий релиз для Paper без привязки к версии игры:
    у EssentialsX метка «поддерживаемая версия» обычно отстаёт от новых версий Minecraft, а плагин при этом работает. */
export async function install(cfg) {
  if (!SUPPORTED.includes(cfg.type)) throw bad('Группы работают на Paper и Purpur');
  const { mr, download, CDN_HOST } = await import('./updates.js');
  const have = jarsOf(cfg), done = [];
  fs.mkdirSync(pluginsDir(cfg), { recursive: true });
  for (const p of PLUGINS) {
    if (have[p.key]) continue;
    const loaders = encodeURIComponent(JSON.stringify(cfg.type === 'PURPUR' ? ['purpur', 'paper', 'spigot', 'bukkit'] : ['paper', 'spigot', 'bukkit']));
    const versions = await mr(`/project/${p.slug}/version?loaders=${loaders}`);
    const v = versions.find(x => x.version_type === 'release') || versions[0];
    const f = v?.files?.find(x => x.primary) || v?.files?.[0];
    if (!f) throw bad(`Для ${p.title} на Modrinth не нашлось подходящей версии`, 502);
    const name = path.basename(f.filename || '');
    if (!/^[\w.+() \[\]-]{1,200}\.jar$/.test(name)) throw bad('Недопустимое имя файла плагина');
    if (new URL(f.url).hostname !== CDN_HOST) throw bad('Недопустимый адрес загрузки');
    const dest = path.join(pluginsDir(cfg), name), tmp = dest + '.hcdl';
    await download(f.url, tmp, f.hashes?.sha1, f.size);
    fs.renameSync(tmp, dest);
    try { fs.chownSync(dest, 1000, 1000); } catch {}
    done.push({ plugin: p.title, file: name, version: v.version_number });
  }
  return done;
}

/* ---------- участники ---------- */
export const membersOf = cfg => cfg.groups?.members || {};
/** Участники из чужого описания сервера (перенос на другую машину): только корректные ники и известные группы. */
export function cleanMembers(m) {
  const out = {};
  if (!m || typeof m !== 'object' || Array.isArray(m)) return out;
  for (const [nick, gid] of Object.entries(m).slice(0, 500)) if (NICK.test(nick) && BY_ID[gid]) out[nick] = gid;
  return out;
}
const keyOf = (members, nick) => Object.keys(members).find(k => k.toLowerCase() === nick.toLowerCase());

/** Записывает группу игрока в настройки сервера (пустая группа убирает игрока). */
export function setMember(cfg, nick, gid) {
  const g = (cfg.groups ||= { on: false, members: {} });
  g.members ||= {};
  const old = keyOf(g.members, nick);
  if (old) delete g.members[old];
  if (gid) g.members[nick] = gid;
  store.save();
}

/* ---------- UUID игрока: LuckPerms принимает и ник, и UUID, но по UUID работает и для тех, кто ещё не заходил ---------- */
const withDashes = h => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
export function offlineUuid(nick) {
  const h = crypto.createHash('md5').update('OfflinePlayer:' + nick).digest();
  h[6] = (h[6] & 0x0f) | 0x30; h[8] = (h[8] & 0x3f) | 0x80;
  return withDashes(h.toString('hex'));
}
function onlineMode(cfg) {
  const env = String(cfg.props?.ONLINE_MODE ?? cfg.customEnv?.ONLINE_MODE ?? '').toLowerCase();
  if (env) return env !== 'false';
  try {
    const m = /^online-mode=(\w+)/m.exec(fs.readFileSync(path.join(dk.serverDir(cfg.id), 'server.properties'), 'utf8'));
    if (m) return m[1].toLowerCase() !== 'false';
  } catch {}
  return true;
}
export async function uuidFor(cfg, nick) {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(dk.serverDir(cfg.id), 'usercache.json'), 'utf8'));
    const hit = list.find(x => String(x.name).toLowerCase() === nick.toLowerCase());
    if (hit?.uuid) return hit.uuid;
  } catch {}
  if (!onlineMode(cfg)) return offlineUuid(nick);
  try {
    const r = await cfFetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(nick)}`, { signal: AbortSignal.timeout(6000) });
    if (r.ok) { const j = await r.json(); if (/^[0-9a-f]{32}$/i.test(j.id || '')) return withDashes(j.id.toLowerCase()); }
  } catch {}
  return null;
}

/* ---------- LuckPerms через RCON ---------- */
export async function ready(cfg) {
  const i = await dk.inspect(cfg.id);
  return !!i?.State.Running && i.State.Health?.Status !== 'starting';
}
/** Загружены ли оба плагина (команда plugins перечисляет их по именам). */
export async function loaded(cfg) {
  try {
    const out = await dk.rcon(cfg.id, 'plugins');
    return /LuckPerms/.test(out) && /Essentials/.test(out);
  } catch { return false; }
}
const lp = (cfg, cmd) => dk.rcon(cfg.id, 'lp ' + cmd);

/** Создаёт в LuckPerms пять групп с правами и настраивает группу default (права HORIZON). */
export async function applyDefinitions(cfg) {
  for (const g of GROUPS) {
    await lp(cfg, `creategroup ${g.id}`);
    await lp(cfg, `group ${g.id} permission clear`);
    for (const p of g.perms) await lp(cfg, `group ${g.id} permission set ${p} true`);
    await lp(cfg, `group ${g.id} setweight ${g.weight}`);
  }
  await lp(cfg, 'group default permission clear');
  for (const p of DEFAULT_PERMS) await lp(cfg, `group default permission set ${p} true`);
}

/** Назначает игроку группу (null возвращает его в default). */
export async function applyMember(cfg, nick, gid) {
  if (!NICK.test(nick)) throw bad('Недопустимый ник');
  const target = (await uuidFor(cfg, nick)) || nick;
  await lp(cfg, `user ${target} parent set ${gid && BY_ID[gid] ? gid : 'default'}`);
}

export async function applyAll(cfg) {
  await applyDefinitions(cfg);
  for (const [nick, gid] of Object.entries(membersOf(cfg))) await applyMember(cfg, nick, gid).catch(e => console.error('groups', nick, e.message));
}

/** Вызывается из опроса сервера: после запуска применяет права, а вошедшим игрокам назначает их группу. */
export function onPoll(cfg, L, online, startedAt) {
  if (!cfg.groups?.on) return;
  if (L.groupStamp !== startedAt) {
    L.groupStamp = startedAt; L.groupDone = new Set();
    loaded(cfg).then(ok => { if (ok) return applyAll(cfg); L.groupStamp = null; }).catch(e => { L.groupStamp = null; console.error('groups', e.message); });
    return;
  }
  const members = membersOf(cfg);
  for (const nick of online) {
    const key = keyOf(members, nick);
    if (!key || L.groupDone?.has(key.toLowerCase())) continue;
    (L.groupDone ||= new Set()).add(key.toLowerCase());
    applyMember(cfg, key, members[key]).catch(e => { L.groupDone.delete(key.toLowerCase()); console.error('groups', key, e.message); });
  }
}

/* ---------- описание для интерфейса ---------- */
export async function status(cfg) {
  const jars = jarsOf(cfg), supported = SUPPORTED.includes(cfg.type);
  const up = supported && (await ready(cfg).catch(() => false));
  return {
    supported, type: cfg.type, jars, installed: jars.luckperms && jars.essentials, on: !!cfg.groups?.on,
    active: up && (await loaded(cfg)), members: membersOf(cfg),
    groups: GROUPS.map(({ id, name, prefix, title, can, cant }) => ({ id, name, prefix, title, can, cant })),
  };
}

export function register(r, { h, view, busy }) {
  r.get('/servers/:id/groups', h(async (req, res) => res.json(await status(req.cfg))));

  r.post('/servers/:id/groups/install', h(async (req, res) => {
    const cfg = req.cfg;
    if (!SUPPORTED.includes(cfg.type)) throw bad('Группы работают на Paper и Purpur. Сначала переведите сервер на Paper.');
    if (busy.has(cfg.id)) throw bad('Сервер занят: ' + busy.get(cfg.id), 409);
    const done = await install(cfg);
    (cfg.groups ||= { members: {} }).on = true;
    cfg.groups.members ||= {};
    store.save();
    res.json({ ...(await status(cfg)), downloaded: done, server: await view(cfg) });
  }));

  // Применить права заново (после ручных правок в LuckPerms или если плагины загрузились позже)
  r.post('/servers/:id/groups/apply', h(async (req, res) => {
    const cfg = req.cfg;
    if (!cfg.groups?.on) throw bad('Группы не включены');
    if (!(await ready(cfg))) throw bad('Сервер должен быть запущен');
    if (!(await loaded(cfg))) throw bad('Плагины LuckPerms и EssentialsX ещё не загружены. Перезапустите сервер.');
    await applyAll(cfg);
    res.json(await status(cfg));
  }));
}

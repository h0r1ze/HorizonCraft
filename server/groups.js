import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as store from './store.js';
import * as dk from './dock.js';
import { cfFetch } from './net.js';
import * as M from '../public/mc.js';

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

/* ---------- каталог прав: что можно выдать группе галочкой ----------
   Каждый пункт включает один или несколько узлов прав. Любой другой узел можно добавить вручную. */
const nodes = (title, ...n) => ({ title, nodes: n });
export const CATALOG = [
  { cat: 'Полёт и перемещение', items: [
    nodes('Полёт (/fly)', 'essentials.fly'),
    nodes('Скорость ходьбы и полёта (/speed)', 'essentials.speed'),
    nodes('Дом (/home, /sethome)', 'essentials.home', 'essentials.sethome'),
    nodes('Возврат на прошлое место (/back)', 'essentials.back'),
    nodes('Точка спавна (/spawn)', 'essentials.spawn'),
    nodes('Варпы (/warp)', 'essentials.warp', 'essentials.warps.*'),
  ] },
  { cat: 'Телепорт', items: [
    nodes('Телепорт по запросу (/tpa, /tpahere)', ...TP_REQUEST),
    nodes('Телепорт к игрокам и игроков к себе (/tp, /tphere)', 'essentials.tp', 'essentials.tphere'),
    nodes('Телепорт по координатам', 'essentials.tppos'),
    nodes('Телепорт всех к себе (/tpall)', 'essentials.tpall'),
  ] },
  { cat: 'Модерация', items: [
    nodes('Кик (/kick)', 'essentials.kick'),
    nodes('Бан и разбан (/ban, /unban)', 'essentials.ban', 'essentials.unban'),
    nodes('Временный бан (/tempban)', 'essentials.tempban'),
    nodes('Мут (/mute)', 'essentials.mute'),
    nodes('Невидимость (/vanish)', 'essentials.vanish'),
    nodes('Просмотр инвентаря (/invsee)', 'essentials.invsee'),
    nodes('Сведения об игроке (/seen, /whois)', 'essentials.seen', 'essentials.whois'),
  ] },
  { cat: 'Игровой процесс', items: [
    nodes('Смена режима игры (/gamemode)', 'essentials.gamemode'),
    nodes('Выдача предметов (/give, /item)', 'essentials.give', 'essentials.item'),
    nodes('Лечение и сытость (/heal, /feed)', 'essentials.heal', 'essentials.feed'),
    nodes('Бессмертие (/god)', 'essentials.god'),
    nodes('Верстак и сундук Края (/workbench, /enderchest)', 'essentials.workbench', 'essentials.enderchest'),
    nodes('Погода и время (/weather, /time)', 'essentials.weather', 'essentials.time'),
  ] },
  { cat: 'Чат', items: [
    nodes('Личные сообщения (/msg)', 'essentials.msg'),
    nodes('Цвета и стили в чате', 'essentials.chat.color', 'essentials.chat.format'),
    nodes('Свой ник (/nick)', 'essentials.nick'),
    nodes('Объявления (/broadcast)', 'essentials.broadcast'),
  ] },
  { cat: 'Администрирование', items: [
    nodes('Все права (*)', '*'),
    nodes('Управление правами (LuckPerms)', 'luckperms.*'),
    nodes('Выдача OP (/op)', 'minecraft.command.op'),
    nodes('Остановка сервера (/stop)', 'minecraft.command.stop'),
    nodes('Белый список (/whitelist)', 'minecraft.command.whitelist'),
    nodes('Перезагрузка Essentials', 'essentials.reload'),
  ] },
];
const ITEMS = CATALOG.flatMap(c => c.items);
const PERM = /^[A-Za-z0-9_.*:-]{1,100}$/;
export const LIMITS = { groups: 20, perms: 200, name: 24, prefix: 24, title: 60, weight: [1, 999] };

const clText = (x, max) => String(x ?? '').replace(/[\u0000-\u001f\u007f§]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
/** Проверяет и чистит описание группы. Бросает ошибку с понятным текстом. */
export function cleanDef(raw, base = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const name = 'name' in r ? clText(r.name, LIMITS.name) : base.name;
  if (!name) throw bad('Введите название группы');
  if (!/^[\p{L}\p{N}_ +.!()#&-]+$/u.test(name)) throw bad('В названии допустимы буквы, цифры, пробел и знаки _ - + . ! ( ) # &');
  const prefix = 'prefix' in r ? clText(r.prefix, 120) : base.prefix ?? '';
  if (M.strip(prefix).length > LIMITS.prefix) throw bad(`Приписка длиннее ${LIMITS.prefix} знаков`);
  const w = 'weight' in r ? Number(r.weight) : base.weight ?? 10;
  if (!Number.isInteger(w) || w < LIMITS.weight[0] || w > LIMITS.weight[1]) throw bad(`Приоритет должен быть целым числом от ${LIMITS.weight[0]} до ${LIMITS.weight[1]}`);
  const title = 'title' in r ? clText(r.title, LIMITS.title) : base.title ?? '';
  let perms = 'perms' in r ? r.perms : base.perms ?? [];
  if (!Array.isArray(perms)) throw bad('Права должны быть списком');
  perms = [...new Set(perms.map(x => String(x ?? '').trim()))];
  if (perms.length > LIMITS.perms) throw bad(`Не больше ${LIMITS.perms} прав в группе`);
  const badPerm = perms.find(x => !PERM.test(x));
  if (badPerm !== undefined) throw bad('Недопустимое право: ' + (badPerm.slice(0, 40) || 'пустое'));
  return { name, prefix, weight: w, title, perms };
}
/** Правки групп из чужого описания сервера (перенос на другую машину): только корректные записи. */
export function cleanDefs(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw).slice(0, LIMITS.groups)) {
    if (!/^[a-z0-9_-]{1,24}$/.test(id) || id === 'default') continue;
    try { out[id] = { ...cleanDef(v, BY_ID[id] ? { ...BY_ID[id], perms: BY_ID[id].perms } : {}), ...(BY_ID[id] ? {} : { custom: true }) }; } catch {}
  }
  return out;
}

/** Описание для карточки: что группе разрешено (по каталогу прав). */
function describe(g, edited) {
  if (!edited && g.can) return { can: g.can };
  const set = new Set(g.perms), can = [];
  if (set.has('*')) can.push('Все права');
  for (const it of ITEMS) if (it.nodes[0] !== '*' && it.nodes.every(n => set.has(n))) can.push(it.title);
  const known = new Set(ITEMS.flatMap(i => i.nodes)), other = g.perms.filter(n => !known.has(n)).length;
  if (other) can.push(`Другие права: ${other}`);
  return { can: can.length ? can : ['Нет особых прав'] };
}

/** Группы сервера: встроенные пять с правками владельца плюс созданные им самим, по убыванию приоритета. */
export function groupsOf(cfg) {
  const defs = cfg.groups?.defs || {}, gone = new Set(cfg.groups?.deleted || []), out = [];
  for (const b of GROUPS) {
    if (gone.has(b.id)) continue;
    const d = defs[b.id], g = { ...b, ...(d || {}), id: b.id, perms: [...(d?.perms ?? b.perms)] };
    out.push({ ...g, builtin: true, edited: !!d, ...describe(g, !!d) });
  }
  for (const [id, d] of Object.entries(defs)) {
    if (BY_ID[id]) continue;
    const g = { id, name: d.name, prefix: d.prefix || '', weight: d.weight, title: d.title || '', perms: [...(d.perms || [])] };
    out.push({ ...g, builtin: false, edited: true, ...describe(g, true) });
  }
  return out.sort((a, b) => b.weight - a.weight);
}
export const groupById = (id, cfg) => groupsOf(cfg || {}).find(g => g.id === id) || null;
// Игрок без назначенной группы получает группу LuckPerms «default»: ей выдаются права HORIZON (с учётом правок).
const defaultPerms = cfg => groupById('horizon', cfg)?.perms || [];
/** Встроенные группы, которые владелец удалил (их можно вернуть). */
export const deletedOf = cfg => GROUPS.filter(b => (cfg.groups?.deleted || []).includes(b.id)).map(b => ({ id: b.id, name: b.name }));

/* ---------- плагины ---------- */
const PLUGINS = [
  { key: 'luckperms', slug: 'luckperms', title: 'LuckPerms', jar: /^luckperms.*\.jar$/i },
  { key: 'essentials', slug: 'essentialsx', title: 'EssentialsX', jar: /^essentials(x)?[-_.]?\d.*\.jar$|^essentials\.jar$|^essentialsx\.jar$/i },
  // для чата без скобок: формат чата (EssentialsX Chat) и мост Vault, через который Essentials берёт префиксы из LuckPerms
  { key: 'chat', slug: 'essentialsx-chat-module', title: 'EssentialsX Chat', jar: /^essentialsxchat.*\.jar$/i },
  { key: 'vault', slug: 'vaultunlocked', title: 'VaultUnlocked', jar: /^vault.*\.jar$/i },
];
const CORE = ['luckperms', 'essentials'], CHAT = ['chat', 'vault'];
const pluginsDir = cfg => path.join(dk.serverDir(cfg.id), 'plugins');
const files = cfg => { try { return fs.readdirSync(pluginsDir(cfg)); } catch { return []; } };

/* Сервер Minecraft работает не от root (uid 1000). Папку plugins, созданную панелью от root, он не может дополнить:
   плагины не создают свои папки (LuckPerms: «AccessDeniedException», Essentials: «node is null») и отключаются. */
const OWNER = 1000;
const own = p => { try { fs.chownSync(p, OWNER, OWNER); } catch {} };
function ownTree(dir) {
  own(dir);
  let list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of list) { const f = path.join(dir, e.name); if (e.isDirectory()) ownTree(f); else own(f); }
}
/** Возвращает true, если права на папку plugins пришлось исправить (серверу нужен перезапуск). */
export function fixPerms(cfg) {
  const d = pluginsDir(cfg);
  try { const st = fs.statSync(d); if (st.uid === OWNER || process.getuid?.() !== 0) return false; } catch { return false; }
  ownTree(d);
  return true;
}
export const jarsOf = cfg => Object.fromEntries(PLUGINS.map(p => [p.key, files(cfg).some(n => p.jar.test(n))]));

/** Скачивает недостающие плагины. Выбирается свежий релиз для Paper без привязки к версии игры:
    у EssentialsX метка «поддерживаемая версия» обычно отстаёт от новых версий Minecraft, а плагин при этом работает. */
export async function install(cfg, keys = CORE) {
  if (!SUPPORTED.includes(cfg.type)) throw bad('Группы работают на Paper и Purpur');
  const { mr, download, CDN_HOST } = await import('./updates.js');
  const have = jarsOf(cfg), done = [];
  fs.mkdirSync(pluginsDir(cfg), { recursive: true });
  own(pluginsDir(cfg));
  for (const p of PLUGINS) {
    if (have[p.key] || !keys.includes(p.key)) continue;
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
    own(dest);
    done.push({ plugin: p.title, file: name, version: v.version_number });
  }
  return done;
}

/* ---------- участники ---------- */
export const membersOf = cfg => cfg.groups?.members || {};
/** Участники из чужого описания сервера (перенос на другую машину): только корректные ники и известные группы. */
export function cleanMembers(m, defs = {}, deleted = []) {
  const out = {};
  if (!m || typeof m !== 'object' || Array.isArray(m)) return out;
  for (const [nick, gid] of Object.entries(m).slice(0, 500)) if (NICK.test(nick) && ((BY_ID[gid] && !deleted.includes(gid)) || defs[gid])) out[nick] = gid;
  return out;
}
/** Список удалённых встроенных групп из чужого описания сервера. */
export const cleanDeleted = raw => (Array.isArray(raw) ? [...new Set(raw.filter(id => BY_ID[id]))] : []);
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
/** Состояние плагинов: в списке (команда plugins) и действительно работают. Отключённый плагин тоже виден в списке,
    но его команды отвечают ошибкой «unexpected error». chat: загружены ли модуль чата и Vault. */
const stripColors = s => s.replace(/\x1b\[[0-9;]*m/g, '').replace(/§./g, '');
export async function pluginState(cfg) {
  try {
    const raw = await dk.rconRaw(cfg.id, 'plugins'), out = stripColors(raw);
    const listed = /LuckPerms/.test(out) && /Essentials/.test(out);
    if (!listed) return { ok: false, chat: false };
    // Отключённые плагины в списке красные. Их команды отвечают ошибкой и пишут трассировку в консоль сервера, поэтому
    // при каждом опросе их не трогаем. Если цветов в ответе нет совсем, проверяем командами, как раньше.
    const green = n => new RegExp(`\\x1b\\[(?:32|92)m\\s*${n}\\b`).test(raw);
    if (/\x1b\[\d+m/.test(raw) && (!green('LuckPerms') || !green('Essentials'))) return { ok: false, chat: false };
    const fail = /unexpected error/i;
    const ok = !fail.test(await dk.rcon(cfg.id, 'lp info')) && !fail.test(await dk.rcon(cfg.id, 'essentials:fly'));
    return { ok, chat: ok && /EssentialsChat/.test(out) && /Vault/.test(out) };
  } catch { return { ok: false, chat: false }; }
}
export const loaded = async cfg => (await pluginState(cfg)).ok;
const lp = (cfg, cmd) => dk.rcon(cfg.id, 'lp ' + cmd);

/** Записывает в LuckPerms права и приоритет одной группы (группа HORIZON заодно задаёт права для default). */
export async function applyGroup(cfg, g) {
  await lp(cfg, `creategroup ${g.id}`);
  await lp(cfg, `group ${g.id} permission clear`);
  for (const p of g.perms) await lp(cfg, `group ${g.id} permission set ${p} true`);
  await lp(cfg, `group ${g.id} setweight ${g.weight}`);
  if (g.id === 'horizon') await applyDefault(cfg);
}
async function applyDefault(cfg) {
  await lp(cfg, 'group default permission clear');
  for (const p of defaultPerms(cfg)) await lp(cfg, `group default permission set ${p} true`);
}
/** Удаляет из LuckPerms группы, которые владелец удалил в панели (пока сервер был выключен или плагины не загружены). */
async function applyRemoved(cfg) {
  const g = cfg.groups;
  for (const id of g?.removed || []) await lp(cfg, `deletegroup ${id}`).catch(() => {});
  if (g?.removed?.length) { g.removed = []; store.save(); }
}

/** Создаёт в LuckPerms все группы с правами и настраивает группу default (права HORIZON). */
export async function applyDefinitions(cfg) {
  await applyRemoved(cfg);
  for (const g of groupsOf(cfg)) await applyGroup(cfg, g);
  await applyDefault(cfg);
}

/** Назначает игроку группу (null возвращает его в default). */
export async function applyMember(cfg, nick, gid) {
  if (!NICK.test(nick)) throw bad('Недопустимый ник');
  const target = (await uuidFor(cfg, nick)) || nick;
  await lp(cfg, `user ${target} parent set ${gid && groupById(gid, cfg) ? gid : 'default'}`);
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
    loaded(cfg).then(ok => { if (ok) return applyAll(cfg).then(() => applyChat(cfg)).then(() => cfg.groups.hideLog && applyLogNotify(cfg, false)); L.groupStamp = null; }).catch(e => { L.groupStamp = null; console.error('groups', e.message); });
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

/* ---------- чат без скобок: «[ADMIN] Ник: сообщение» вместо «<Ник> сообщение» ----------
   Скобки входят в стандартный формат чата Minecraft. Формат меняет модуль EssentialsX Chat, а префиксы он берёт из LuckPerms
   через Vault (приписка команды team ему не видна: {TEAMPREFIX} в этой сборке пустой). Поэтому панель дублирует приписки
   игроков в метаданные LuckPerms (префикс и суффикс с приоритетом 100). */
export const CHAT_FORMAT = '{DISPLAYNAME}&7:&r {MESSAGE}';
export const CHAT_DEFAULT = '<{DISPLAYNAME}> {MESSAGE}';
const essentialsConfig = cfg => path.join(pluginsDir(cfg), 'Essentials', 'config.yml');

/** Подставляет формат чата в раздел chat: конфигурации Essentials. null, если такого раздела нет. */
export function patchChatFormat(text, format) {
  const i = text.search(/^chat:[ \t]*$/m);
  if (i < 0) return null;
  const rest = text.slice(i), re = /^  format: .*$/m, m = re.exec(rest);
  if (!m) return null;
  const current = m[0].replace(/^  format:\s*/, '').replace(/^'(.*)'$/, '$1');
  if (current === format) return { text, changed: false, current };
  return { text: text.slice(0, i) + rest.replace(re, () => `  format: '${format}'`), changed: true, current };
}

/** Цвет операторов в Essentials ('4' по умолчанию: красный ник). Пока включён чат без скобок, он отключён, иначе ник оператора
    всегда красный и цвет из панели не виден. */
export function patchOpsColor(text, value) {
  const re = /^ops-name-color:[ 	]*(.*)$/m, m = re.exec(text);
  if (!m) return null;
  const current = m[1].replace(/\s+#.*$/, '').trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
  if (current === value) return { text, changed: false, current };
  return { text: text.replace(re, () => `ops-name-color: '${value}'`), changed: true, current };
}

/** Записывает формат чата в конфигурацию Essentials. 'pending': конфигурации ещё нет (создаётся при первом запуске). */
export function applyChatFormat(cfg, on) {
  const file = essentialsConfig(cfg);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return 'pending'; }
  const cur = patchChatFormat(text, on ? CHAT_FORMAT : CHAT_DEFAULT);
  if (!cur) return 'pending';
  let out = text, changed = false;
  // выключая, возвращаем стандартный формат только если стоял наш, чужую настройку не трогаем
  if (on || cur.current === CHAT_FORMAT) { out = cur.text; changed = cur.changed; }
  const ops = patchOpsColor(out, on ? 'none' : '4');
  if (ops && (on || ops.current === 'none') && ops.changed) { out = ops.text; changed = true; }
  if (!changed) return 'same';
  fs.writeFileSync(file, out);
  return 'changed';
}

const q = s => String(s || '').replace(/["\r\n§]/g, '').trim();
async function chatTarget(cfg, nick) { return (await uuidFor(cfg, nick)) || nick; }
/** Префикс для чата: приписка, затем сброс оформления (ник не наследует жирность и цвет приписки) и цвет самого ника. */
export function chatPrefix(pre, color) {
  const c = /^[0-9a-f]$/i.test(color || '') ? `&${String(color).toLowerCase()}` : '';
  return pre ? `${pre} &r${c}` : c;
}
/** Передаёт приписку игрока в LuckPerms: префикс и суффикс, которые Essentials выводит в чате. */
export async function applyChatTag(cfg, nick, tag) {
  if (!cfg.groups?.on || !cfg.groups.chat || !NICK.test(nick)) return;
  const t = await chatTarget(cfg, nick), pre = q(tag?.prefix), suf = q(tag?.suffix);
  const pfx = chatPrefix(pre, tag?.color), sfx = suf ? `&r ${suf}` : '';
  await lp(cfg, pfx ? `user ${t} meta setprefix 100 "${pfx}"` : `user ${t} meta removeprefix 100`);
  await lp(cfg, sfx ? `user ${t} meta setsuffix 100 "${sfx}"` : `user ${t} meta removesuffix 100`);
}
export async function removeChatTag(cfg, nick) {
  if (!cfg.groups?.on || !NICK.test(nick)) return;
  const t = await chatTarget(cfg, nick);
  await lp(cfg, `user ${t} meta removeprefix 100`);
  await lp(cfg, `user ${t} meta removesuffix 100`);
}
/* ---------- уведомления LuckPerms ----------
   LuckPerms пишет операторам и администраторам в игровой чат строку «[LP] ЛОГ > …» при каждом изменении прав, в том числе
   при каждой смене группы из панели. Параметр log-notify в настройках LuckPerms отключает эти строки. */
const lpConfig = cfg => path.join(pluginsDir(cfg), 'LuckPerms', 'config.yml');
export function patchLogNotify(text, show) {
  const re = /^log-notify:[ \t]*(.*)$/m, m = re.exec(text);
  if (!m) return null;
  const current = m[1].replace(/\s+#.*$/, '').trim().toLowerCase(), want = show ? 'true' : 'false';
  if (current === want) return { text, changed: false, current };
  return { text: text.replace(re, () => `log-notify: ${want}`), changed: true, current };
}
/** Записывает log-notify в настройки LuckPerms и перечитывает их. 'pending': файла ещё нет (создаётся при первом запуске). */
export async function applyLogNotify(cfg, show, live = true) {
  const file = lpConfig(cfg);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return 'pending'; }
  const r = patchLogNotify(text, show);
  if (!r) return 'pending';
  if (!r.changed) return 'same';
  fs.writeFileSync(file, r.text);
  if (live) await lp(cfg, 'reloadconfig').catch(() => {});
  return 'changed';
}

/** После запуска сервера и при включении: формат чата и приписки всех игроков. */
export async function applyChat(cfg, force = false) {
  const g = cfg.groups;
  if (!g?.on) return 'off';
  const res = applyChatFormat(cfg, !!g.chat);
  if (res === 'changed' || force) await dk.rcon(cfg.id, 'essentials:essentials reload').catch(() => {});
  if (g.chat) for (const [nick, tag] of Object.entries(cfg.tags || {})) await applyChatTag(cfg, nick, tag).catch(e => console.error('groups chat', nick, e.message));
  return res;
}

/* ---------- описание для интерфейса ---------- */
export async function status(cfg) {
  const jars = jarsOf(cfg), supported = SUPPORTED.includes(cfg.type);
  if (supported && cfg.groups?.on && fixPerms(cfg)) { cfg.groups.fixedAt = Date.now(); store.save(); }
  const up = supported && (await ready(cfg).catch(() => false));
  const st = up ? await pluginState(cfg) : { ok: false, chat: false };
  return {
    supported, type: cfg.type, jars, installed: jars.luckperms && jars.essentials, on: !!cfg.groups?.on,
    active: st.ok, members: membersOf(cfg), fixedAt: cfg.groups?.fixedAt || 0, deleted: deletedOf(cfg),
    chat: { on: !!cfg.groups?.chat, installed: jars.chat && jars.vault, loaded: st.chat },
    hideLog: !!cfg.groups?.hideLog,
    groups: groupsOf(cfg).map(({ id, name, prefix, title, can, weight, perms, builtin, edited }) => ({ id, name, prefix, title, can, weight, perms, builtin, edited })),
    catalog: CATALOG, limits: LIMITS,
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

  // Чат без скобок: ставит модуль чата и Vault, меняет формат, передаёт приписки в LuckPerms
  r.post('/servers/:id/groups/chat', h(async (req, res) => {
    const cfg = req.cfg, on = !!req.body?.on;
    if (!cfg.groups?.on) throw bad('Сначала включите группы');
    if (busy.has(cfg.id)) throw bad('Сервер занят: ' + busy.get(cfg.id), 409);
    const downloaded = on ? await install(cfg, CHAT) : [];
    cfg.groups.chat = on;
    store.save();
    let applied = false;
    if (await ready(cfg) && (await pluginState(cfg)).chat) {
      if (!on) for (const nick of Object.keys(cfg.tags || {})) await removeChatTag(cfg, nick).catch(() => {});
      await applyChat(cfg, true);
      applied = true;
    }
    res.json({ ...(await status(cfg)), downloaded, applied, restart: on && !applied });
  }));

  /* Редактор групп: название, приписка, приоритет, описание и права. Свои группы создаются и удаляются, встроенные
     можно править и сбрасывать к исходным. Изменения сразу уходят в LuckPerms, если сервер запущен. */
  const live = async cfg => (await ready(cfg).catch(() => false)) && (await loaded(cfg));
  const needOn = req => { if (!req.cfg.groups?.on) throw bad('Сначала включите группы'); };
  const unDelete = (cfg, ids) => {
    cfg.groups.deleted = (cfg.groups.deleted || []).filter(x => !ids.includes(x));
    cfg.groups.removed = (cfg.groups.removed || []).filter(x => !ids.includes(x));
  };
  const uniqueName = (cfg, name, id) => { if (groupsOf(cfg).some(g => g.id !== id && g.name.toLowerCase() === name.toLowerCase())) throw bad('Группа с таким названием уже есть'); };
  const slug = (cfg, name) => {
    const base = (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'group');
    const taken = id => id === 'default' || BY_ID[id] || groupById(id, cfg);
    let id = base, n = 2;
    while (taken(id)) id = `${base}-${n++}`;
    return id;
  };
  const done = async (cfg, id, extra = {}) => {
    let applied = false;
    if (await live(cfg)) { const g = id && groupById(id, cfg); if (g) await applyGroup(cfg, g); await applyRemoved(cfg); if (!id) await applyDefault(cfg); applied = true; }
    return { ...(await status(cfg)), applied, ...extra };
  };

  r.post('/servers/:id/groups/defs', h(async (req, res) => {
    const cfg = req.cfg; needOn(req);
    if (groupsOf(cfg).length >= LIMITS.groups) throw bad(`Не больше ${LIMITS.groups} групп`);
    const d = cleanDef(req.body, { weight: 10 });
    uniqueName(cfg, d.name);
    const id = slug(cfg, d.name);
    (cfg.groups.defs ||= {})[id] = { ...d, custom: true };
    cfg.groups.removed = (cfg.groups.removed || []).filter(x => x !== id);
    store.save();
    res.json(await done(cfg, id, { id }));
  }));

  r.put('/servers/:id/groups/defs/:gid', h(async (req, res) => {
    const cfg = req.cfg; needOn(req);
    const cur = groupById(req.params.gid, cfg);
    if (!cur) throw bad('Неизвестная группа', 404);
    const d = cleanDef(req.body, cur);
    uniqueName(cfg, d.name, cur.id);
    (cfg.groups.defs ||= {})[cur.id] = cur.builtin ? d : { ...d, custom: true };
    store.save();
    res.json(await done(cfg, cur.id));
  }));

  r.post('/servers/:id/groups/defs/:gid/reset', h(async (req, res) => {
    const cfg = req.cfg; needOn(req);
    if (!BY_ID[req.params.gid]) throw bad('Сбросить можно только встроенную группу');
    if (cfg.groups.defs) delete cfg.groups.defs[req.params.gid];
    unDelete(cfg, [req.params.gid]);
    store.save();
    res.json(await done(cfg, req.params.gid));
  }));

  // Вернуть удалённые стандартные группы с исходными правами
  r.post('/servers/:id/groups/restore', h(async (req, res) => {
    const cfg = req.cfg; needOn(req);
    const ids = (cfg.groups.deleted || []).slice();
    if (!ids.length) throw bad('Удалённых стандартных групп нет');
    for (const id of ids) if (cfg.groups.defs) delete cfg.groups.defs[id];
    unDelete(cfg, ids);
    store.save();
    let applied = false;
    if (await live(cfg)) { for (const id of ids) await applyGroup(cfg, groupById(id, cfg)); applied = true; }
    res.json({ ...(await status(cfg)), applied });
  }));

  r.delete('/servers/:id/groups/defs/:gid', h(async (req, res) => {
    const cfg = req.cfg; needOn(req);
    const cur = groupById(req.params.gid, cfg);
    if (!cur) throw bad('Неизвестная группа', 404);
    const lv = await live(cfg), moved = [];
    for (const [nick, gid] of Object.entries(membersOf(cfg))) if (gid === cur.id) {
      moved.push(nick); setMember(cfg, nick, '');
      if (lv) await applyMember(cfg, nick, null).catch(() => {});
    }
    if (cfg.groups.defs) delete cfg.groups.defs[cur.id];
    if (cur.builtin) (cfg.groups.deleted ||= []).push(cur.id);
    (cfg.groups.removed ||= []).push(cur.id);
    store.save();
    res.json(await done(cfg, null, { moved }));
  }));

  // Скрыть или вернуть строки «[LP] ЛОГ» в игровом чате администраторов
  r.post('/servers/:id/groups/log', h(async (req, res) => {
    const cfg = req.cfg, hide = !!req.body?.hide;
    if (!cfg.groups?.on) throw bad('Сначала включите группы');
    cfg.groups.hideLog = hide;
    store.save();
    const result = await applyLogNotify(cfg, !hide, await live(cfg));
    res.json({ ...(await status(cfg)), applied: result !== 'pending' });
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

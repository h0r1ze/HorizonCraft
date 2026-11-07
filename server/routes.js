import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import sharp from 'sharp';
import { glowFrom } from './color.js';
import { cfFetch, probeCurseForge, searchState } from './net.js';
import * as store from './store.js';
import * as dk from './dock.js';
import * as sv from './services.js';
import * as imp from './importer.js';
import * as P from './proxy.js';
import * as M from '../public/mc.js';
import * as chat from './chat.js';
import * as nodes from './nodes.js';
import * as transfer from './transfer.js';
import * as mapMod from './map.js';
import * as migrateMod from './migrate.js';
import * as updatesMod from './updates.js';
import * as templatesMod from './templates.js';
import * as discordMod from './discord.js';
import * as groupsMod from './groups.js';
import * as worldsMod from './worlds.js';
import { agentAuth, AGENT, VERSION } from './agent.js';

const h = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(e => {
    if (!e.status) console.error(e);
    res.status(e.status || 500).json({ error: e.message || 'Ошибка' });
  });
const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });

export const TYPES = ['VANILLA', 'PAPER', 'PURPUR', 'FABRIC', 'FORGE', 'NEOFORGE', 'AUTO_CURSEFORGE'];
const JAVA = ['auto', 'latest', 'java21', 'java17', 'java11', 'java8'];
const RESERVED = ['RCON_PASSWORD', 'ENABLE_RCON', 'EULA', 'TYPE'];

const { busy, errs, run } = sv;

async function view(cfg) {
  const info = await dk.inspect(cfg.id);
  const { rconPassword, discord, ...rest } = cfg;
  const mo = dk.motdOf(cfg);
  const L = sv.live.get(cfg.id);
  return {
    ...rest,
    discord: discord?.on ? { on: true } : null,
    motd: { follow: mo.follow, l1: cfg.motd?.l1 || '', l2: mo.l2 },
    players: L?.running && L.max != null ? L.count : null,
    maxPlayers: L?.running ? L.max : null,
    cpu: L?.running ? L.cpu : null,
    cores: L?.running ? L.cores : null,
    cpus: L?.running ? L.cpus : null,
    mem: L?.running ? L.mem : null,
    state: dk.stateOf(info),
    outdated: !!info && info.Config.Labels?.['mcpanel.spec'] !== dk.specOf(cfg),
    startedAt: info?.State?.StartedAt || null,
    busy: busy.get(cfg.id) || null,
    error: errs.get(cfg.id) || null,
    image: `${dk.IMG}:${dk.javaTag(cfg)}`,
  };
}

// ---------- валидация ----------
const csv = (v, re) => {
  const items = String(v ?? '').split(/[\s,]+/).filter(Boolean);
  for (const i of items) if (!re.test(i)) throw bad(`Недопустимое значение: ${i}`);
  return items.join(',');
};
function envMap(obj, strictUpper) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(k)) throw bad(`Недопустимое имя переменной: ${k}`);
    if (RESERVED.includes(k)) throw bad(`Переменную ${k} менять нельзя`);
    const sv = String(v ?? '');
    if (sv.length > 500 || /[\r\n]/.test(sv)) throw bad(`Недопустимое значение для ${k}`);
    out[k] = sv;
  }
  return out;
}

function sanitize(b, cur = {}) {
  const o = {};
  if ('nameFmt' in b) {
    // название с цветом и стилем: в name хранится чистый текст, в nameFmt - исходная строка с кодами
    const f = String(b.nameFmt).replace(/[\r\n§]/g, ' ').trim();
    const plain = M.strip(f).trim();
    if (!plain || plain.length > 40) throw bad('Название: от 1 до 40 символов (коды форматирования не считаются)');
    if (f.length > 200) throw bad('Слишком много кодов форматирования');
    o.name = plain;
    o.nameFmt = f === M.escape(plain) ? '' : f;
  } else if ('name' in b) {
    const n = String(b.name).trim();
    if (!n || n.length > 40) throw bad('Название: от 1 до 40 символов');
    o.name = n;
    o.nameFmt = '';
  }
  if ('motd' in b) {
    const m = b.motd || {};
    const line = v => {
      const t = String(v ?? '').replace(/[\r\n§]/g, ' ').trim();
      if (t.length > 200 || M.strip(t).length > 80) throw bad('Описание: не больше 80 символов в строке');
      return t;
    };
    o.motd = { follow: m.follow !== false, l1: line(m.l1), l2: line(m.l2) };
  }
  if ('type' in b) { if (!TYPES.includes(b.type)) throw bad('Неизвестный тип сервера'); o.type = b.type; }
  if ('version' in b) {
    if (!/^[A-Za-z0-9._-]{1,40}$/.test(b.version)) throw bad('Недопустимая версия');
    o.version = b.version;
  }
  if ('memory' in b) {
    const m = String(b.memory).toUpperCase();
    if (!/^\d{1,5}[MG]$/.test(m)) throw bad('Память: например 4G или 2048M');
    o.memory = m;
  }
  if ('port' in b) {
    const p = Number(b.port);
    if (!Number.isInteger(p) || p < 1024 || p > 65535) throw bad('Порт: 1024-65535');
    o.port = p;
  }
  if ('javaTag' in b) { if (!JAVA.includes(b.javaTag)) throw bad('Недопустимая версия Java'); o.javaTag = b.javaTag; }
  if ('proxy' in b) {
    const p = b.proxy || {};
    const on = !!p.on, node = String(p.node || '');
    if (on && !node) throw bad('Выберите узел прокси');
    if (on && !P.nodeExists(node)) throw bad('Выбранный узел прокси не найден');
    o.proxy = { on, node, scope: p.scope === 'all' ? 'all' : 'install' };
  }
  if ('loaderVersion' in b) {
    if (!/^[A-Za-z0-9._-]{0,40}$/.test(String(b.loaderVersion))) throw bad('Недопустимая версия загрузчика');
    o.loaderVersion = String(b.loaderVersion);
  }
  if ('cfSlug' in b) { if (!/^[a-z0-9-]{0,100}$/.test(b.cfSlug)) throw bad('Недопустимый slug сборки'); o.cfSlug = b.cfSlug; }
  if ('cfFileId' in b) { if (!/^\d{0,12}$/.test(String(b.cfFileId))) throw bad('ID файла - только цифры'); o.cfFileId = String(b.cfFileId); }
  if ('cfMods' in b) o.cfMods = csv(b.cfMods, /^[A-Za-z0-9_.:\/-]{1,200}$/);
  if ('modrinthMods' in b) o.modrinthMods = csv(b.modrinthMods, /^[A-Za-z0-9_.:@-]{1,100}$/);
  if ('extraPorts' in b) o.extraPorts = csv(b.extraPorts, /^\d{2,5}\/(tcp|udp)$/);
  if ('domain' in b) o.domain = csv(String(b.domain).toLowerCase(), /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/);
  if ('props' in b) o.props = envMap(b.props);
  if ('customEnv' in b) o.customEnv = envMap(b.customEnv);
  return o;
}

function checkPorts(cfg, others) {
  const used = others.filter(s => s.id !== cfg.id);
  if (used.some(s => s.port === cfg.port)) throw bad(`Порт ${cfg.port} уже занят другим сервером`);
  const routerOn = store.get().servers.some(s => s.id !== cfg.id && s.domain) || cfg.domain;
  if (routerOn && cfg.port === 25565) throw bad('Порт 25565 зарезервирован под маршрутизатор доменов');
}
/** Порты хоста, которые уже опубликованы контейнерами Docker (в том числе чужими). */
const dockerPorts = async () => { try { return await dk.publishedPorts(); } catch { return new Set(); } };
/** Следующий свободный порт: не занят ни серверами панели, ни другими контейнерами на этой машине. */
const nextPort = async () => {
  const used = new Set(store.get().servers.map(s => s.port));
  for (const p of await dockerPorts()) used.add(p);
  let p = 25570;
  while (used.has(p)) p++;
  return p;
};

// ---------- расписание ----------
function cleanTasks(list, current = []) {
  const old = new Map((current || []).map(t => [t.id, t]));
  return (Array.isArray(list) ? list : []).slice(0, 20).map(t => {
    if (!['backup', 'restart', 'command'].includes(t.kind)) throw bad('Неизвестный тип задачи');
    const mode = t.mode === 'interval' ? 'interval' : 'daily';
    const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(t.time) ? t.time : '04:00';
    const hours = Math.min(168, Math.max(1, parseInt(t.hours) || 6));
    const command = String(t.command || '').replace(/[\r\n]/g, ' ').trim().slice(0, 200);
    if (t.kind === 'command' && !command) throw bad('Для задачи «команда» укажите команду');
    const prev = old.get(t.id);
    return {
      id: prev ? prev.id : crypto.randomBytes(4).toString('hex'),
      kind: t.kind, mode, time, hours, command, enabled: !!t.enabled,
      keep: Math.min(50, Math.max(1, parseInt(t.keep) || 7)),
      lastRun: prev?.lastRun || Date.now(), lastRunDay: prev?.lastRunDay || '', lastStatus: prev?.lastStatus || '',
    };
  });
}

/** Удаляет сервер: контейнер, запись и, по желанию, файлы. */
async function removeServer(cfg, withData) {
  await dk.remove(cfg.id);
  const st = store.get();
  st.servers = st.servers.filter(x => x.id !== cfg.id);
  store.save();
  if (withData) fs.rmSync(dk.serverDir(cfg.id), { recursive: true, force: true });
  for (const sm of [false, true]) fs.rmSync(coverFile(cfg.id, sm), { force: true });
  fs.rmSync(logoFile(cfg.id), { force: true });
  dk.syncRouter().catch(e => console.error(e));
}

// ---------- обложки ----------
const COVERS = path.join(dk.DATA_DIR, 'covers');
const coverFile = (id, sm) => path.join(COVERS, `${id}${sm ? '-sm' : ''}.webp`);
const logoFile = dk.logoPath;

// ---------- файлы ----------
function safe(id, rel = '') {
  const base = path.resolve(dk.serverDir(id));
  const p = path.resolve(base, '.' + path.sep + String(rel).replace(/^[\\/]+/, ''));
  if (p !== base && !p.startsWith(base + path.sep)) throw bad('Недопустимый путь');
  try {
    const rb = fs.realpathSync(base), rp = fs.realpathSync(p);
    if (rp !== rb && !rp.startsWith(rb + path.sep)) throw bad('Недопустимый путь');
  } catch (e) { if (e.status) throw e; }
  return { base, p };
}
const own = p => { try { fs.chownSync(p, 1000, 1000); } catch {} };

// ---------- кэш версий ----------
let vCache = { at: 0, list: [] };
async function versions() {
  if (Date.now() - vCache.at < 3600e3 && vCache.list.length) return vCache.list;
  const r = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
  if (!r.ok) throw bad('Не удалось получить список версий', 502);
  const j = await r.json();
  vCache = { at: Date.now(), list: j.versions.filter(v => v.type === 'release').map(v => v.id) };
  return vCache.list;
}

// ---------- перенос и шаблоны: «портативное» описание сервера ----------
/** Описание сервера, которое можно передать на другую машину: без пароля RCON, id и привязки к этой машине. */
function portable(cfg) {
  const { rconPassword, id, createdAt, cover, logo, iconSynced, discord, ...rest } = JSON.parse(JSON.stringify(cfg));
  const img = (has, f) => (has && fs.existsSync(f) ? fs.readFileSync(f).toString('base64') : undefined);
  return { ...rest, images: { cover: img(cover, coverFile(cfg.id)), logo: img(logo, logoFile(cfg.id)) } };
}

const PORTABLE_KEYS = ['name', 'nameFmt', 'motd', 'type', 'version', 'memory', 'javaTag', 'loaderVersion', 'cfSlug', 'cfFileId', 'cfMods', 'modrinthMods', 'extraPorts', 'props', 'customEnv'];

function cleanTags(t) {
  const out = {};
  if (!t || typeof t !== 'object') return out;
  const cl = x => { const s = String(x ?? '').replace(/[\r\n§]/g, ' ').trim(); return s.length > 120 || M.strip(s).length > 24 ? '' : s; };
  for (const [nick, v] of Object.entries(t).slice(0, 500)) {
    if (!/^[A-Za-z0-9_.]{1,32}$/.test(nick)) continue;
    out[nick] = { prefix: cl(v?.prefix), suffix: cl(v?.suffix), color: v?.color && M.COLOR_NAME[v.color] ? String(v.color) : '' };
  }
  return out;
}

async function restoreImages(cfg, im) {
  if (!im || typeof im !== 'object') return;
  try {
    const decode = b64 => (typeof b64 === 'string' && b64.length < 6e6 ? Buffer.from(b64, 'base64') : null);
    const cover = decode(im.cover), logo = decode(im.logo);
    if (cover?.length) {
      const meta = await sharp(cover, { limitInputPixels: 50e6 }).metadata();
      if (meta.format === 'webp') {
        fs.mkdirSync(COVERS, { recursive: true });
        fs.writeFileSync(coverFile(cfg.id), cover);
        await sharp(cover).resize(640, 360, { fit: 'cover' }).webp({ quality: 76, effort: 4 }).toFile(coverFile(cfg.id, true));
        cfg.cover = { v: Date.now(), bytes: cover.length };
      }
    }
    if (logo?.length) {
      const meta = await sharp(logo, { limitInputPixels: 50e6 }).metadata();
      if (meta.format === 'webp') {
        fs.mkdirSync(COVERS, { recursive: true });
        fs.writeFileSync(logoFile(cfg.id), logo);
        cfg.logo = { v: Date.now(), glow: await glowFrom(logo), bytes: logo.length };
      }
    }
  } catch (e) { console.error('images', e.message); }
}

/** Превращает принятую передачу (описание + файлы) в настоящий сервер на этой машине. */
async function finishStaged(token, { start = false, name } = {}) {
  const { dir, root, config: c } = transfer.staged(token);
  const pick = {};
  for (const k of PORTABLE_KEYS) if (c[k] !== undefined && c[k] !== null) pick[k] = c[k];
  if (!pick.nameFmt || name) delete pick.nameFmt;
  if (name) pick.name = name;
  const o = sanitize(pick);
  if (!o.type) throw bad('В описании нет типа сервера');
  if (o.type === 'AUTO_CURSEFORGE' && !o.cfSlug) throw bad('В описании сборки CurseForge не указана сборка');
  if (o.type === 'AUTO_CURSEFORGE' && !store.get().settings.cfApiKey) throw bad('На этой машине не задан ключ CurseForge: добавьте его в «Настройках»');
  const servers = store.get().servers;
  const cfg = {
    name: 'Перенесённый сервер', memory: '4G', javaTag: 'auto', loaderVersion: '',
    cfSlug: '', cfFileId: '', cfMods: '', modrinthMods: '', extraPorts: '', domain: '', props: {}, customEnv: {},
    ...o, port: Number(c.port) || 0,
    id: crypto.randomBytes(4).toString('hex'), rconPassword: crypto.randomBytes(12).toString('hex'),
    createdAt: new Date().toISOString(),
  };
  try {
    sanitize({ port: cfg.port }); checkPorts(cfg, servers);
    if ((await dockerPorts()).has(cfg.port)) throw new Error('порт занят другим контейнером');
  } catch { cfg.port = await nextPort(); }
  if (Array.isArray(c.schedule)) cfg.schedule = cleanTasks(c.schedule);
  if (c.tags) cfg.tags = cleanTags(c.tags);
  if (c.groups?.on) cfg.groups = { on: true, members: groupsMod.cleanMembers(c.groups.members) };
  if (c.map?.on) cfg.map = { on: true, port: await mapMod.allocPort(), added: !!c.map.added };
  const dest = dk.serverDir(cfg.id);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  if (root) fs.renameSync(root, dest); else fs.mkdirSync(dest, { recursive: true });
  await restoreImages(cfg, c.images);
  fs.rmSync(dir, { recursive: true, force: true });
  await imp.chown(dest);
  servers.push(cfg);
  store.save();
  if (start) run(cfg.id, 'Запуск…', () => dk.start(cfg));
  return view(cfg);
}

export function verify(token) {
  return jwt.verify(token, store.get().secret);
}

export function createRouter() {
  const r = express.Router();
  const attempts = new Map();

  r.post('/login', h(async (req, res) => {
    const a = attempts.get(req.ip) || { n: 0, until: 0 };
    if (a.until > Date.now()) throw bad('Слишком много попыток. Подождите минуту.', 429);
    const u = store.get().user;
    if (!u || !(await bcrypt.compare(String(req.body.password || ''), u.hash))) {
      a.n++;
      if (a.n >= 5) { a.until = Date.now() + 60000; a.n = 0; }
      attempts.set(req.ip, a);
      throw bad('Неверный пароль', 401);
    }
    attempts.delete(req.ip);
    const t = jwt.sign({ u: 'admin' }, store.get().secret, { expiresIn: '7d' });
    res.cookie('mcp_token', t, { httpOnly: true, sameSite: 'strict', maxAge: 7 * 864e5 });
    res.json({ ok: true });
  }));
  r.post('/logout', (req, res) => { res.clearCookie('mcp_token'); res.json({ ok: true }); });

  r.use((req, res, next) => {
    if (agentAuth(req.headers)) return next(); // главная панель обращается к этой как к ноде
    try { verify(req.cookies?.mcp_token); next(); }
    catch { res.status(401).json({ error: 'Требуется вход' }); }
  });

  r.get('/me', (req, res) => res.json({ ok: true, agent: AGENT, version: VERSION }));

  // ---------- ноды: серверы на других машинах ----------
  r.get('/nodes', h(async (req, res) => {
    await Promise.all(nodes.all().map(n => nodes.refresh(n, 4000)));
    res.json(nodes.all().map(nodes.publicNode));
  }));
  r.post('/nodes', h(async (req, res) => res.json(nodes.publicNode(await nodes.add(req.body || {})))));
  r.put('/nodes/:nid', h(async (req, res) => res.json(nodes.publicNode(await nodes.update(req.params.nid, req.body || {})))));
  r.delete('/nodes/:nid', h(async (req, res) => { nodes.remove(req.params.nid); res.json({ ok: true }); }));
  r.post('/nodes/:nid/test', h(async (req, res) => {
    const n = nodes.get(req.params.nid);
    if (!n) throw bad('Нода не найдена', 404);
    await nodes.refresh(n);
    res.json(nodes.publicNode(n));
  }));

  /* Запросы к серверам, которые живут на ноде, а также загрузка архива (?node=) и обновление образов (?node=)
     пересылаются агенту. Всё остальное выполняется локально. */
  const SRV = /^\/servers\/([a-f0-9]{8})(\/|$)/;
  r.use(h(async (req, res, next) => {
    let n = null, m;
    if ((m = SRV.exec(req.path))) {
      if (!store.get().servers.some(s => s.id === m[1])) n = await nodes.locate(m[1]);
    } else if (/^\/(import|images)(\/|$)/.test(req.path) && req.query.node && req.query.node !== 'local') {
      n = nodes.get(String(req.query.node));
      if (!n) throw bad('Нода не найдена', 404);
    }
    if (!n) return next();
    const exact = m && req.path === `/servers/${m[1]}`;
    const annotate = (exact && req.method !== 'DELETE') || (m && req.method === 'POST' && req.path.endsWith('/clone'))
      || (/^\/import\/[a-f0-9]{16}\/confirm$/.test(req.path) && req.method === 'POST');
    await nodes.proxy(n, req, res, {
      annotate: annotate ? data => {
        if (/^[a-f0-9]{8}$/.test(data.id || '')) nodes.place(data.id, n.id);
        data.node = nodes.tag(n);
      } : null,
      onDone: code => { if (exact && req.method === 'DELETE' && code < 300) nodes.unplace(m[1]); },
    });
  }));

  r.post('/password', h(async (req, res) => {
    const { old, next } = req.body;
    if (!(await bcrypt.compare(String(old || ''), store.get().user.hash))) throw bad('Старый пароль неверен');
    if (String(next || '').length < 8) throw bad('Новый пароль: минимум 8 символов');
    store.get().user.hash = await bcrypt.hash(next, 10);
    store.save();
    res.json({ ok: true });
  }));

  // Доступ к поиску CurseForge со временем может измениться, поэтому раз в 10 минут перепроверяем его в фоне.
  const refreshCf = () => {
    const s = store.get().settings;
    if (!s.cfApiKey || Date.now() - (s.cfCheckedAt || 0) < 600000) return;
    s.cfCheckedAt = Date.now();
    probeCurseForge(s.cfApiKey).then(pr => { s.cfSearchOk = searchState(pr); store.save(); }).catch(() => {});
  };
  r.post('/settings/cf/recheck', h(async (req, res) => {
    const s = store.get().settings;
    if (!s.cfApiKey) throw bad('Ключ CurseForge не задан');
    const probe = await probeCurseForge(s.cfApiKey);
    s.cfSearchOk = searchState(probe);
    s.cfCheckedAt = Date.now();
    store.save();
    res.json({ ok: true, searchOk: s.cfSearchOk, probe });
  }));
  r.get('/settings', (req, res) => {
    refreshCf();
    const s = store.get().settings;
    res.json({
      publicHost: s.publicHost || '',
      cfApiKeySet: !!s.cfApiKey,
      cfSearchOk: s.cfApiKey ? (s.cfSearchOk ?? null) : null,
      cfApiKeyHint: s.cfApiKey ? '••••' + s.cfApiKey.slice(-4) : '',
      panelProxy: s.panelProxy || { on: false, node: '' },
    });
  });
  r.put('/settings', h(async (req, res) => {
    const s = store.get().settings, b = req.body;
    if ('publicHost' in b) {
      const v = String(b.publicHost).trim();
      if (v && !/^[A-Za-z0-9.-]{1,253}$/.test(v)) throw bad('Недопустимый адрес');
      s.publicHost = v;
    }
    if (b.clearCfApiKey) { delete s.cfApiKey; delete s.cfSearchOk; }
    else if (b.cfApiKey) {
      const key = String(b.cfApiKey).trim();
      if (!/^[\x21-\x7e]{10,200}$/.test(key)) throw bad('Недопустимый ключ');
      if (key.startsWith('cfc_pat_')) {
        throw bad('Это личный токен профиля (cfc_pat_…), он не подходит. Нужен ключ из раздела «API keys», он начинается с $2a$10$.');
      }
      const pr = await probeCurseForge(key);
      if (pr.games === 401 || pr.games === 403) {
        throw bad('CurseForge отклонил ключ (ошибка ' + pr.games + '). Скопируйте ключ целиком со страницы «API keys» на console.curseforge.com.');
      }
      s.cfApiKey = key;
      // Поиск у некоторых ключей закрыт, хотя остальные запросы проходят.
      s.cfSearchOk = searchState(pr);
    }
    // Переключатель: запросы самой панели к CurseForge идут через выбранный узел прокси.
    let probe = null;
    if ('panelProxy' in b) {
      const p = b.panelProxy || {};
      const on = !!p.on, node = String(p.node || '');
      if (on && !P.nodeExists(node)) throw bad('Выберите узел прокси');
      s.panelProxy = { on, node: on ? node : (s.panelProxy?.node || '') };
      if (s.cfApiKey) { probe = await probeCurseForge(s.cfApiKey); s.cfSearchOk = searchState(probe); }
    }
    store.save();
    // Ключ CurseForge нужен и нодам: сборки скачивают они сами.
    if (b.clearCfApiKey) nodes.broadcast({ clearCfApiKey: true });
    else if (b.cfApiKey) nodes.broadcast({ cfApiKey: s.cfApiKey });
    res.json({ ok: true, searchOk: s.cfSearchOk ?? null, probe });
  }));

  // ---------- прокси: узлы, подписка 3x-ui ----------
  const proxyState = () => ({
    nodes: P.publicNodes(), subscription: P.publicSubscription(),
    external: store.get().settings.downloadProxy || '',
  });
  const ve = fn => { try { return fn(); } catch (e) { throw e.status ? e : bad(e.message); } };
  const applyProxy = async () => {
    store.save();
    try { await dk.syncProxy(); } catch (e) { throw bad('Настройки сохранены, но запустить прокси не удалось: ' + e.message, 502); }
  };
  r.get('/proxy', (req, res) => res.json(proxyState()));
  r.post('/proxy/subscription', h(async (req, res) => {
    const s = store.get().settings, b = req.body || {};
    const url = String(b.url || '').trim() || (b.refresh ? s.subscription?.url || '' : '');
    const pasted = String(b.content || '').trim();
    if (!url && !pasted) throw bad('Укажите адрес подписки или вставьте её содержимое');
    const text = pasted || await (async () => { try { return await P.fetchSubscription(url); } catch (e) { throw bad(e.message, 502); } })();
    const parsed = ve(() => P.parseSubscription(text));
    if (!parsed.nodes.length) {
      throw bad('В подписке нет подходящих узлов VLESS (нужны security=reality или tls).' + (parsed.skipped[0] ? ` Пропущено: ${parsed.skipped[0].name}: ${parsed.skipped[0].reason}` : ''));
    }
    ve(() => P.applySubscription(url, parsed));
    await applyProxy();
    res.json(proxyState());
  }));
  r.delete('/proxy/subscription', h(async (req, res) => {
    P.clearSubscription();
    await applyProxy();
    res.json(proxyState());
  }));
  r.post('/proxy/manual', h(async (req, res) => {
    ve(() => P.addManual(req.body?.link, req.body?.name));
    await applyProxy();
    res.json(proxyState());
  }));
  r.delete('/proxy/nodes/:nid', h(async (req, res) => {
    if (!/^[a-f0-9]{8}$/.test(req.params.nid)) throw bad('Недопустимый идентификатор');
    ve(() => P.removeNode(req.params.nid));
    await applyProxy();
    res.json(proxyState());
  }));
  r.put('/proxy/external', h(async (req, res) => {
    const s = store.get().settings;
    const v = String(req.body?.address || '').trim();
    if (v && !/^[A-Za-z0-9.-]+:\d{2,5}$/.test(v)) throw bad('Прокси указывается как адрес:порт, например 127.0.0.1:10808');
    if (v) s.downloadProxy = v; else { delete s.downloadProxy; P.dropFromServers('external'); }
    await applyProxy();
    res.json(proxyState());
  }));
  r.post('/proxy/test', h(async (req, res) => {
    const node = String(req.body?.node || '');
    if (!P.nodeExists(node)) throw bad('Узел не найден');
    const host = String(req.body?.host || '');
    if (host && !/^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(host)) throw bad('Недопустимый адрес для проверки');
    res.json(host ? await dk.testProxy(node, host, '/') : await dk.testProxy(node));
  }));

  r.get('/versions', h(async (req, res) => res.json(await versions())));

  r.get('/cf/search', h(async (req, res) => {
    const key = store.get().settings.cfApiKey;
    if (!key) throw bad('Ключ CurseForge не задан. Добавьте его в «Настройках».');
    const q = new URLSearchParams({
      gameId: '432', classId: req.query.kind === 'mod' ? '6' : '4471',
      searchFilter: String(req.query.q || ''), sortField: '2', sortOrder: 'desc', pageSize: '24',
    });
    if (/^[\d.]+$/.test(req.query.gameVersion || '')) q.set('gameVersion', req.query.gameVersion);
    const lt = { forge: 1, fabric: 4, neoforge: 6 }[String(req.query.loader || '').toLowerCase()];
    if (lt && req.query.kind === 'mod') q.set('modLoaderType', String(lt));
    const resp = await cfFetch('https://api.curseforge.com/v1/mods/search?' + q, {
      headers: { 'x-api-key': key, Accept: 'application/json' },
    });
    if (resp.status === 403) throw bad('CurseForge закрыл поиск для этого ключа. Добавляйте моды по ID проекта.', 502);
    if (!resp.ok) throw bad(`CurseForge ответил ${resp.status}. Проверьте ключ.`, 502);
    const j = await resp.json();
    res.json(j.data.map(m => ({
      id: m.id, name: m.name, slug: m.slug, summary: m.summary, icon: m.logo?.thumbnailUrl,
      downloads: m.downloadCount, author: m.authors?.[0]?.name, url: m.links?.websiteUrl,
    })));
  }));

  r.get('/cf/mod/:modId', h(async (req, res) => {
    const key = store.get().settings.cfApiKey;
    if (!key) throw bad('Ключ CurseForge не задан. Добавьте его в «Настройках».');
    if (!/^\d{1,9}$/.test(req.params.modId)) throw bad('ID проекта состоит только из цифр');
    const resp = await cfFetch(`https://api.curseforge.com/v1/mods/${req.params.modId}`, {
      headers: { 'x-api-key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(15000),
    });
    if (resp.status === 404) throw bad('Проект с таким ID не найден', 404);
    if (!resp.ok) throw bad(`CurseForge ответил ${resp.status}`, 502);
    const m = (await resp.json()).data;
    res.json({
      id: m.id, name: m.name, slug: m.slug, summary: m.summary, icon: m.logo?.thumbnailUrl,
      downloads: m.downloadCount, author: m.authors?.[0]?.name, url: m.links?.websiteUrl,
      kind: m.classId === 4471 ? 'modpack' : m.classId === 6 ? 'mod' : 'other',
    });
  }));

  // ---------- серверы ----------
  r.get('/servers', h(async (req, res) => {
    const local = (await Promise.all(store.get().servers.map(view))).map(s => ({ ...s, node: nodes.localTag() }));
    res.json([...local, ...(await nodes.allServers())]);
  }));

  r.post('/servers', h(async (req, res) => {
    const { nodeId, ...b } = req.body || {};
    if (b.templateId) return res.json(await templatesMod.createServer({ ...b, nodeId }, ctx));
    if (nodeId && nodeId !== 'local') { // создание на ноде: агент делает всё сам (порт, папка, образ)
      const n = nodes.get(String(nodeId));
      if (!n) throw bad('Нода не найдена', 404);
      const created = await nodes.json(n, 'POST', '/servers', b, 30000);
      nodes.place(created.id, n.id);
      await nodes.refresh(n);
      return res.json({ ...created, node: nodes.tag(n) });
    }
    const base = {
      name: 'Новый сервер', type: 'PAPER', version: 'LATEST', memory: '4G', port: await nextPort(),
      javaTag: 'auto', cfSlug: '', cfFileId: '', cfMods: '', modrinthMods: '', extraPorts: '', domain: '',
      props: { MOTD: 'Сервер на HorizonCraft', MAX_PLAYERS: '20', DIFFICULTY: 'normal', MODE: 'survival', ONLINE_MODE: 'TRUE' },
      customEnv: {},
    };
    const cfg = {
      ...base, ...sanitize(b),
      id: crypto.randomBytes(4).toString('hex'),
      rconPassword: crypto.randomBytes(12).toString('hex'),
      createdAt: new Date().toISOString(),
    };
    if (cfg.type === 'AUTO_CURSEFORGE' && !cfg.cfSlug) throw bad('Для сборки CurseForge нужно выбрать сборку');
    if (cfg.type === 'AUTO_CURSEFORGE' && !store.get().settings.cfApiKey) throw bad('Сначала добавьте ключ CurseForge в «Настройках»');
    checkPorts(cfg, store.get().servers);
    store.get().servers.push(cfg);
    store.save();
    fs.mkdirSync(dk.serverDir(cfg.id), { recursive: true });
    own(dk.serverDir(cfg.id));
    dk.ensureImage(`${dk.IMG}:${dk.javaTag(cfg)}`).catch(() => {});
    if (cfg.domain) dk.syncRouter().catch(e => console.error(e));
    res.json(await view(cfg));
  }));

  r.param('id', (req, res, next, id) => {
    const cfg = store.get().servers.find(s => s.id === id);
    if (!cfg) return res.status(404).json({ error: 'Сервер не найден' });
    req.cfg = cfg;
    next();
  });

  r.get('/servers/:id', h(async (req, res) => res.json(await view(req.cfg))));

  // Обложка: принимаем уже обрезанный кадр, повторно сжимаем и храним две копии (заголовок и карточка).
  const rawBody = (req, res, next) => express.raw({ type: () => true, limit: '12mb' })(req, res, err => (err
    ? res.status(err.status || 400).json({ error: err.status === 413 ? 'Файл больше 12 МБ' : 'Не удалось принять файл' })
    : next()));
  r.post('/servers/:id/cover', rawBody, h(async (req, res) => {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || !buf.length) throw bad('Файл не получен');
    const opts = { limitInputPixels: 50e6, failOn: 'error' };
    let meta;
    try { meta = await sharp(buf, opts).metadata(); } catch { throw bad('Не удалось прочитать изображение'); }
    if (!['jpeg', 'png', 'webp', 'gif'].includes(meta.format)) throw bad('Поддерживаются JPEG, PNG, WebP и GIF');
    fs.mkdirSync(COVERS, { recursive: true });
    try {
      const base = sharp(buf, opts).rotate();
      const big = await base.clone().resize(1280, 720, { fit: 'cover' }).webp({ quality: 82, effort: 4 }).toBuffer();
      fs.writeFileSync(coverFile(req.cfg.id), big);
      await base.clone().resize(640, 360, { fit: 'cover' }).webp({ quality: 76, effort: 4 }).toFile(coverFile(req.cfg.id, true));
      // По желанию значок сервера делается из центра кадра обложки.
      if (req.query.icon === '1') { await saveLogo(req.cfg, await sharp(big).extract({ left: 280, top: 0, width: 720, height: 720 }).toBuffer()); await dk.syncIcon(req.cfg); }
    } catch (e) { throw bad('Не удалось обработать изображение'); }
    req.cfg.cover = { v: Date.now(), bytes: fs.statSync(coverFile(req.cfg.id)).size };
    store.save();
    res.json(await view(req.cfg));
  }));

  // Значок сервера: квадрат 256x256 и автоматически подобранный цвет свечения.
  async function saveLogo(cfg, input) {
    fs.mkdirSync(COVERS, { recursive: true });
    const out = await sharp(input, { limitInputPixels: 50e6 }).rotate().resize(256, 256, { fit: 'cover' }).webp({ quality: 84, effort: 4 }).toBuffer();
    fs.writeFileSync(logoFile(cfg.id), out);
    cfg.logo = { v: Date.now(), glow: await glowFrom(out), bytes: out.length };
  }
  r.post('/servers/:id/logo', rawBody, h(async (req, res) => {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || !buf.length) throw bad('Файл не получен');
    let meta;
    try { meta = await sharp(buf, { limitInputPixels: 50e6 }).metadata(); } catch { throw bad('Не удалось прочитать изображение'); }
    if (!['jpeg', 'png', 'webp', 'gif'].includes(meta.format)) throw bad('Поддерживаются JPEG, PNG, WebP и GIF');
    try { await saveLogo(req.cfg, buf); } catch { throw bad('Не удалось обработать изображение'); }
    store.save();
    await dk.syncIcon(req.cfg);
    res.json(await view(req.cfg));
  }));
  r.get('/servers/:id/logo', (req, res) => {
    const f = logoFile(req.cfg.id);
    if (!fs.existsSync(f)) return res.status(404).json({ error: 'Значка нет' });
    res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(f).pipe(res);
  });
  r.delete('/servers/:id/logo', h(async (req, res) => {
    fs.rmSync(logoFile(req.cfg.id), { force: true });
    delete req.cfg.logo;
    store.save();
    await dk.syncIcon(req.cfg);
    res.json(await view(req.cfg));
  }));
  r.get('/servers/:id/cover', (req, res) => {
    const f = coverFile(req.cfg.id, req.query.size === 'sm');
    if (!fs.existsSync(f)) return res.status(404).json({ error: 'Обложки нет' });
    res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(f).pipe(res);
  });
  r.delete('/servers/:id/cover', h(async (req, res) => {
    for (const sm of [false, true]) fs.rmSync(coverFile(req.cfg.id, sm), { force: true });
    delete req.cfg.cover;
    // значок остаётся: это отдельное изображение
    store.save();
    res.json(await view(req.cfg));
  }));

  r.patch('/servers/:id', h(async (req, res) => {
    const upd = sanitize(req.body, req.cfg);
    const next = { ...req.cfg, ...upd };
    checkPorts(next, store.get().servers);
    if (next.type === 'AUTO_CURSEFORGE' && !next.cfSlug) throw bad('Для сборки CurseForge нужно выбрать сборку');
    Object.assign(req.cfg, upd);
    store.save();
    if ('domain' in upd) dk.syncRouter().catch(e => console.error(e));
    res.json(await view(req.cfg));
  }));

  r.delete('/servers/:id', h(async (req, res) => {
    await removeServer(req.cfg, req.query.data === '1');
    res.json({ ok: true });
  }));

  r.post('/servers/:id/action', h(async (req, res) => {
    const { id } = req.cfg, a = req.body.action;
    if (busy.has(id)) throw bad('Сервер занят: ' + busy.get(id), 409);
    const cfg = req.cfg;
    if (a === 'start') run(id, 'Запуск…', () => dk.start(cfg));
    else if (a === 'stop') run(id, 'Остановка…', () => dk.stop(id));
    else if (a === 'restart') run(id, 'Перезапуск…', async () => { await dk.stop(id); await dk.start(cfg); });
    else if (a === 'kill') run(id, 'Принудительная остановка…', () => dk.kill(id));
    else if (a === 'recreate') run(id, 'Пересоздание контейнера…', async () => { await dk.stop(id); await dk.remove(id); await dk.start(cfg); });
    else throw bad('Неизвестное действие');
    res.json({ ok: true });
  }));

  r.get('/servers/:id/stats', h(async (req, res) => {
    const info = await dk.inspect(req.cfg.id);
    if (!info?.State.Running) return res.json({ running: false });
    res.json({ running: true, ...(await dk.stats(req.cfg.id)) });
  }));

  r.post('/servers/:id/command', h(async (req, res) => {
    const cmd = String(req.body.cmd || '').replace(/[\r\n]/g, ' ').trim();
    if (!cmd) throw bad('Пустая команда');
    res.json({ out: await dk.rcon(req.cfg.id, cmd) });
  }));

  // ---------- игроки ----------
  const readNames = (id, file) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dk.serverDir(id), file), 'utf8')).map(x => x.name).filter(Boolean);
    } catch { return []; }
  };
  r.get('/servers/:id/players', h(async (req, res) => {
    const id = req.cfg.id;
    const info = await dk.inspect(id);
    const out = {
      running: !!info?.State.Running, online: [], max: null,
      ops: readNames(id, 'ops.json'), whitelist: readNames(id, 'whitelist.json'),
      banned: readNames(id, 'banned-players.json'), tags: req.cfg.tags || {}, groups: groupsMod.membersOf(req.cfg),
    };
    if (out.running) {
      const t = await dk.rcon(id, 'list');
      const m = /There are (\d+) of a max of (\d+) players online:\s*(.*)/s.exec(t);
      if (m) { out.max = +m[2]; out.online = m[3].split(',').map(x => x.trim()).filter(Boolean).map(x => chat.resolveNick(x, req.cfg.tags) || x); }
    }
    res.json(out);
  }));
  r.post('/servers/:id/players/:action', h(async (req, res) => {
    const name = String(req.body.name || '');
    if (!/^[A-Za-z0-9_.]{1,32}$/.test(name)) throw bad('Недопустимый ник');
    const reason = String(req.body.reason || '').replace(/[\r\n]/g, ' ').slice(0, 100);
    const mode = ['survival', 'creative', 'adventure', 'spectator'].includes(req.body.mode) ? req.body.mode : 'survival';
    const map = {
      kick: `kick ${name} ${reason}`, ban: `ban ${name} ${reason}`, pardon: `pardon ${name}`,
      op: `op ${name}`, deop: `deop ${name}`, tell: `tell ${name} ${reason}`, gamemode: `gamemode ${mode} ${name}`,
      'wl-add': `whitelist add ${name}`, 'wl-remove': `whitelist remove ${name}`,
    };
    const cmd = map[req.params.action];
    if (!cmd) throw bad('Неизвестное действие');
    res.json({ out: await dk.rcon(req.cfg.id, cmd.trim()) });
  }));
  const ready = async cfg => { const i = await dk.inspect(cfg.id); return !!i?.State.Running && i.State.Health?.Status !== 'starting'; };
  r.put('/servers/:id/tags', h(async (req, res) => {
    const nick = String(req.body.nick || '').trim();
    if (!/^[A-Za-z0-9_.]{1,32}$/.test(nick)) throw bad('Недопустимый ник');
    const cl = v => {
      const t = String(v ?? '').replace(/[\r\n§]/g, ' ').trim();
      if (t.length > 120 || M.strip(t).length > 24) throw bad('Приписка: не больше 24 символов');
      return t;
    };
    const color = req.body.color && M.COLOR_NAME[req.body.color] ? String(req.body.color) : '';
    const tag = { prefix: cl(req.body.prefix), suffix: cl(req.body.suffix), color };
    const tags = (req.cfg.tags ||= {});
    const old = Object.keys(tags).find(k => k.toLowerCase() === nick.toLowerCase());
    const live = await ready(req.cfg);
    // Группа игрока (права LuckPerms). Поле group необязательно: без него группа не меняется, пустое значение её снимает.
    let groupError = null;
    if ('group' in req.body) {
      const gid = String(req.body.group || '');
      if (gid && !groupsMod.groupById(gid)) throw bad('Неизвестная группа');
      groupsMod.setMember(req.cfg, nick, gid);
      if (live && req.cfg.groups?.on) {
        try {
          if (!(await groupsMod.loaded(req.cfg))) groupError = 'Плагины прав ещё не загружены, группа применится после перезапуска сервера';
          else await groupsMod.applyMember(req.cfg, nick, gid || null);
        } catch (e) { groupError = e.message; }
      }
    }
    if (old && old !== nick) { delete tags[old]; if (live) await sv.removeTag(req.cfg, old).catch(() => {}); }
    if (!tag.prefix && !tag.suffix && !tag.color) {
      delete tags[nick]; store.save();
      if (live) await sv.removeTag(req.cfg, nick).catch(() => {});
      return res.json({ tags, applied: live, error: groupError });
    }
    tags[nick] = tag;
    store.save();
    let errors = [];
    if (live) { try { errors = await sv.applyTag(req.cfg, nick, tag); } catch (e) { errors = [e.message]; } }
    res.json({ tags, applied: live && !errors.length, error: errors[0] || groupError || null });
  }));
  r.delete('/servers/:id/tags/:nick', h(async (req, res) => {
    const tags = req.cfg.tags || {};
    const key = Object.keys(tags).find(k => k.toLowerCase() === String(req.params.nick).toLowerCase());
    const live = await ready(req.cfg);
    if (key) { delete tags[key]; store.save(); if (live) await sv.removeTag(req.cfg, key).catch(() => {}); }
    // вместе с припиской игрок теряет и группу: права возвращаются к обычным
    const nick = key || String(req.params.nick);
    if (Object.keys(groupsMod.membersOf(req.cfg)).some(k => k.toLowerCase() === nick.toLowerCase())) {
      groupsMod.setMember(req.cfg, nick, '');
      if (live && req.cfg.groups?.on) await groupsMod.applyMember(req.cfg, nick, null).catch(() => {});
    }
    res.json({ tags });
  }));
  r.get('/servers/:id/chat', h(async (req, res) => {
    const after = Number(req.query.after) || 0;
    const info = await dk.inspect(req.cfg.id);
    res.json({ events: await chat.history(req.cfg, after), tags: req.cfg.tags || {}, running: !!info?.State.Running && info.State.Health?.Status !== 'starting' });
  }));
  r.post('/servers/:id/chat', h(async (req, res) => {
    if (!(await ready(req.cfg))) throw bad('Сервер не запущен', 409);
    await chat.send(req.cfg, req.body.name, req.body.text);
    res.json({ ok: true });
  }));
  r.post('/servers/:id/whitelist', h(async (req, res) => {
    res.json({ out: await dk.rcon(req.cfg.id, req.body.on ? 'whitelist on' : 'whitelist off') });
  }));

  // ---------- файлы ----------
  r.get('/servers/:id/files', h(async (req, res) => {
    const { p, base } = safe(req.cfg.id, req.query.path);
    if (!fs.existsSync(p)) return res.json({ path: '', entries: [] });
    const entries = fs.readdirSync(p, { withFileTypes: true }).map(d => {
      let st = {};
      try { st = fs.statSync(path.join(p, d.name)); } catch {}
      return { name: d.name, dir: d.isDirectory(), size: st.size || 0, mtime: st.mtimeMs || 0 };
    }).sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
    res.json({ path: path.relative(base, p).split(path.sep).join('/'), entries });
  }));
  r.get('/servers/:id/file', h(async (req, res) => {
    const { p } = safe(req.cfg.id, req.query.path);
    const st = fs.statSync(p);
    if (!st.isFile()) throw bad('Это не файл');
    if (req.query.download) return res.download(p);
    if (st.size > 2 * 1024 * 1024) throw bad('Файл больше 2 МБ - скачайте его');
    const buf = fs.readFileSync(p);
    if (buf.includes(0)) throw bad('Бинарный файл нельзя открыть как текст');
    res.json({ content: buf.toString('utf8') });
  }));
  r.put('/servers/:id/file', h(async (req, res) => {
    const { p } = safe(req.cfg.id, req.body.path);
    if (typeof req.body.content !== 'string') throw bad('Нет содержимого');
    fs.writeFileSync(p, req.body.content);
    own(p);
    res.json({ ok: true });
  }));
  r.delete('/servers/:id/file', h(async (req, res) => {
    const { p, base } = safe(req.cfg.id, req.query.path);
    if (p === base) throw bad('Нельзя удалить корень');
    fs.rmSync(p, { recursive: true, force: true });
    res.json({ ok: true });
  }));
  r.post('/servers/:id/mkdir', h(async (req, res) => {
    const { p } = safe(req.cfg.id, req.body.path);
    fs.mkdirSync(p, { recursive: true });
    own(p);
    res.json({ ok: true });
  }));
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        try {
          const { p } = safe(req.cfg.id, req.query.path);
          fs.mkdirSync(p, { recursive: true });
          cb(null, p);
        } catch (e) { cb(e); }
      },
      filename: (req, file, cb) => cb(null, path.basename(file.originalname)),
    }),
  });
  r.post('/servers/:id/upload', upload.array('files', 50), h(async (req, res) => {
    (req.files || []).forEach(f => own(f.path));
    res.json({ ok: true, count: (req.files || []).length });
  }));

  // ---------- распаковка архивов в файлах сервера ----------
  r.get('/servers/:id/archive', h(async (req, res) => {
    const { p } = safe(req.cfg.id, req.query.path);
    if (!fs.statSync(p).isFile()) throw bad('Это не файл');
    const i = await imp.inspect(p);
    res.json({ kind: i.kind, count: i.count, total: i.total, singleRoot: i.singleRoot, plain: i.singleRoot ? imp.PLAIN_DIRS.includes(i.singleRoot) : false });
  }));
  r.post('/servers/:id/extract', h(async (req, res) => {
    const { id } = req.cfg;
    const { p } = safe(id, req.body.path);
    if (!fs.statSync(p).isFile()) throw bad('Это не файл');
    if (busy.has(id)) throw bad('Сервер занят: ' + busy.get(id), 409);
    const info = await imp.inspect(p);
    imp.checkSpace(info.total, path.dirname(p));
    const dest = path.dirname(p);
    const flatten = !!req.body.flatten && !!info.singleRoot;
    const remove = !!req.body.remove;
    run(id, 'Распаковка…', async () => {
      if (flatten) {
        const tmp = path.join(dest, '.extract-' + crypto.randomBytes(4).toString('hex'));
        try {
          await imp.extract(p, info.kind, tmp);
          fs.cpSync(path.join(tmp, info.singleRoot), dest, { recursive: true, force: true });
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
      } else await imp.extract(p, info.kind, dest);
      await imp.chown(dest);
      if (remove) fs.rmSync(p, { force: true });
    });
    res.json({ ok: true });
  }));

  // ---------- загрузка готового сервера ----------
  const upImport = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        try {
          req.importToken = crypto.randomBytes(8).toString('hex');
          const d = path.join(imp.IMPORT_DIR, req.importToken);
          fs.mkdirSync(d, { recursive: true });
          cb(null, d);
        } catch (e) { cb(e); }
      },
      filename: (req, file, cb) => cb(null, 'upload.bin'),
    }),
    limits: { fileSize: 8 * 1024 ** 3 },
  });
  r.post('/import', (req, res, next) => {
    imp.cleanupOld();
    upImport.single('file')(req, res, err => (err
      ? res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Файл больше 8 ГБ' : err.message })
      : next()));
  }, h(async (req, res) => {
    if (!req.file) throw bad('Файл не получен');
    const token = req.importToken, dir = path.join(imp.IMPORT_DIR, token);
    try {
      const info = await imp.analyzeUpload(dir);
      const base = path.basename(req.file.originalname || '', path.extname(req.file.originalname || '')).replace(/\.tar$/i, '');
      res.json({ token, ...info, suggestedName: base.slice(0, 40) || 'Загруженный сервер' });
    } catch (e) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw bad(e.message);
    }
  }));
  r.delete('/import/:token', h(async (req, res) => {
    if (/^[a-f0-9]{16}$/.test(req.params.token)) fs.rmSync(path.join(imp.IMPORT_DIR, req.params.token), { recursive: true, force: true });
    res.json({ ok: true });
  }));
  r.post('/import/:token/confirm', h(async (req, res) => {
    if (!/^[a-f0-9]{16}$/.test(req.params.token)) throw bad('Недопустимый идентификатор');
    const dir = path.join(imp.IMPORT_DIR, req.params.token);
    const metaFile = path.join(dir, 'meta.json');
    if (!fs.existsSync(metaFile)) throw bad('Загрузка не найдена или устарела. Загрузите архив заново.', 404);
    const b = req.body;
    const pick = {};
    for (const k of ['name', 'type', 'version', 'memory', 'loaderVersion', 'javaTag']) if (b[k] !== undefined && b[k] !== '') pick[k] = b[k];
    const o = sanitize(pick);
    if (!o.type || o.type === 'AUTO_CURSEFORGE') throw bad('Выберите тип сервера');
    if (!o.version) throw bad('Укажите версию Minecraft');
    const cfg = {
      name: 'Загруженный сервер', memory: '4G', port: await nextPort(), javaTag: 'auto', loaderVersion: '',
      cfSlug: '', cfFileId: '', cfMods: '', modrinthMods: '', extraPorts: '', domain: '',
      props: {}, customEnv: {}, ...o,
      id: crypto.randomBytes(4).toString('hex'), rconPassword: crypto.randomBytes(12).toString('hex'),
      createdAt: new Date().toISOString(),
    };
    checkPorts(cfg, store.get().servers);
    const root = path.join(dir, JSON.parse(fs.readFileSync(metaFile, 'utf8')).root || 'root');
    const dest = dk.serverDir(cfg.id);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(root, dest);
    fs.rmSync(dir, { recursive: true, force: true });
    await imp.chown(dest);
    store.get().servers.push(cfg);
    store.save();
    if (b.start) run(cfg.id, 'Запуск…', () => dk.start(cfg));
    res.json(await view(cfg));
  }));

  // ---------- мониторинг ----------
  r.get('/host', (req, res) => res.json(sv.hostInfo()));

  r.get('/servers/:id/overview', h(async (req, res) => {
    const L = sv.live.get(req.cfg.id);
    const backups = sv.listBackups(req.cfg.id);
    res.json({
      hist: L?.hist || [], running: !!L?.running, online: L?.online || [], max: L?.max ?? null,
      memLimit: L?.memLimit || 0, diskBytes: await sv.dirSize(req.cfg.id),
      backups: backups.length, backupsSize: backups.reduce((a, b) => a + b.size, 0),
      lastBackup: backups[0]?.mtime || null,
    });
  }));

  r.post('/servers/:id/say', h(async (req, res) => {
    const msg = String(req.body.message || '').replace(/[\r\n]/g, ' ').trim().slice(0, 200);
    if (!msg) throw bad('Пустое сообщение');
    res.json({ out: await dk.rcon(req.cfg.id, 'say ' + msg) });
  }));

  // ---------- клонирование ----------
  r.post('/servers/:id/clone', h(async (req, res) => {
    const src = req.cfg;
    const name = String(req.body.name || '').trim().slice(0, 40) || src.name + ' (копия)';
    const withData = !!req.body.withData;
    if (withData && (await dk.inspect(src.id))?.State.Running) throw bad('Остановите сервер, чтобы скопировать мир');
    const cfg = {
      ...JSON.parse(JSON.stringify(src)), cover: undefined, logo: undefined, iconSynced: undefined, discord: undefined, nameFmt: '', name, id: crypto.randomBytes(4).toString('hex'),
      rconPassword: crypto.randomBytes(12).toString('hex'), createdAt: new Date().toISOString(),
      port: await nextPort(), domain: '', schedule: [],
    };
    store.get().servers.push(cfg);
    store.save();
    if (withData) await sv.cloneData(src.id, cfg.id);
    else fs.mkdirSync(dk.serverDir(cfg.id), { recursive: true });
    res.json(await view(cfg));
  }));

  // ---------- резервные копии ----------
  r.get('/servers/:id/backups', h(async (req, res) => res.json(sv.listBackups(req.cfg.id))));
  r.post('/servers/:id/backups', h(async (req, res) => {
    if (busy.has(req.cfg.id)) throw bad('Сервер занят: ' + busy.get(req.cfg.id), 409);
    run(req.cfg.id, 'Резервная копия…', () => sv.createBackup(req.cfg, 'manual'));
    res.json({ ok: true });
  }));
  const bname = req => {
    if (!sv.BACKUP_RE.test(req.params.name)) throw bad('Недопустимое имя');
    return path.join(sv.backupDir(req.cfg.id), req.params.name);
  };
  r.get('/servers/:id/backups/:name', h(async (req, res) => {
    const f = bname(req);
    if (!fs.existsSync(f)) throw bad('Не найдено', 404);
    res.download(f);
  }));
  r.delete('/servers/:id/backups/:name', h(async (req, res) => {
    fs.rmSync(bname(req), { force: true });
    res.json({ ok: true });
  }));
  r.post('/servers/:id/backups/:name/restore', h(async (req, res) => {
    bname(req);
    if (busy.has(req.cfg.id)) throw bad('Сервер занят: ' + busy.get(req.cfg.id), 409);
    if ((await dk.inspect(req.cfg.id))?.State.Running) throw bad('Остановите сервер перед восстановлением');
    run(req.cfg.id, 'Восстановление…', () => sv.restoreBackup(req.cfg, req.params.name));
    res.json({ ok: true });
  }));

  // ---------- расписание ----------
  r.get('/servers/:id/schedule', (req, res) => res.json(req.cfg.schedule || []));
  r.put('/servers/:id/schedule', h(async (req, res) => {
    req.cfg.schedule = cleanTasks(req.body.tasks, req.cfg.schedule);
    store.save();
    res.json(req.cfg.schedule);
  }));

  // ---------- образы ----------
  r.post('/images/update', h(async (req, res) => {
    const tags = new Set(['latest', ...store.get().servers.map(dk.javaTag)]);
    sv.run('images', 'Обновление образов…', async () => {
      for (const t of tags) await new Promise((ok, no) => dk.docker.pull(`${dk.IMG}:${t}`, (e, s) => (e ? no(e) : dk.docker.modem.followProgress(s, x => (x ? no(x) : ok())))));
    });
    res.json({ ok: true, tags: [...tags] });
  }));
  r.get('/images/status', (req, res) => res.json({ busy: busy.get('images') || null, error: errs.get('images') || null }));

  // ---------- перенос сервера между машинами: сторона источника и сторона приёма ----------
  r.get('/servers/:id/portable', h(async (req, res) => res.json(portable(req.cfg))));
  r.get('/servers/:id/export', h(async (req, res) => {
    const dirs = req.query.dirs ? String(req.query.dirs).split(',').filter(Boolean).slice(0, 16) : null;
    const x = transfer.exportStream(req.cfg.id, { dirs, exclude: req.query.lean === '1' ? ['./plugins/dynmap/web/tiles'] : [] });
    if (!x) throw bad('Нечего упаковывать', 404);
    res.set({ 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${req.cfg.id}.tar.gz"`, 'Cache-Control': 'no-store' });
    res.on('close', () => x.kill());
    x.done.then(d => { if (!d.ok) { console.error('export', d.err); res.destroy(); } });
    x.stream.on('error', () => res.destroy());
    x.stream.pipe(res);
  }));
  r.post('/migrate/begin', h(async (req, res) => {
    const c = req.body?.config;
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw bad('Нет описания сервера');
    res.json({ token: transfer.begin(c) });
  }));
  r.put('/migrate/:token/data', h(async (req, res) => res.json(await transfer.receive(req.params.token, req))));
  r.post('/migrate/:token/finish', h(async (req, res) => {
    res.json(await finishStaged(req.params.token, { start: !!req.body?.start, name: req.body?.name ? String(req.body.name).slice(0, 40) : undefined }));
  }));

  // Всё, что нужно новым разделам (перенос, обновления, карта, шаблоны), из этого модуля.
  const ctx = { h, bad, view, sanitize, finishStaged, portable, removeServer, nextPort, cleanTasks, coverFile, logoFile, run, busy, errs };
  migrateMod.register(r, ctx);
  updatesMod.register(r, ctx);
  mapMod.register(r, ctx);
  templatesMod.register(r, ctx);
  discordMod.register(r, ctx);
  groupsMod.register(r, ctx);
  worldsMod.register(r, ctx);

  return r;
}

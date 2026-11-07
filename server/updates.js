import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { cfFetch } from './net.js';
import * as store from './store.js';
import * as dk from './dock.js';
import * as sv from './services.js';
import { VERSION } from './agent.js';

/* Обновления: ядро сервера сравнивается со списком версий Mojang, плагины и моды определяются по хэшу файла
   в Modrinth (поэтому не важно, как они попали на сервер) и обновляются одним нажатием. */

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
const UA = `h0r1ze/HorizonCraft/${VERSION} (github.com/h0r1ze/HorizonCraft)`;
const API = 'https://api.modrinth.com/v2';
export const CDN_HOST = 'cdn.modrinth.com';
const MAX_JAR = 300 * 1024 ** 2;
const TTL = 30 * 60e3;

const LOADERS = {
  PAPER: ['paper', 'spigot', 'bukkit'], PURPUR: ['purpur', 'paper', 'spigot', 'bukkit'],
  FABRIC: ['fabric'], FORGE: ['forge'], NEOFORGE: ['neoforge'],
};
const dirOf = type => (type === 'PAPER' || type === 'PURPUR' ? 'plugins' : 'mods');

/* ---------- Modrinth ---------- */
export async function mr(pathname, body) {
  let r;
  try {
    r = await cfFetch(API + pathname, {
      method: body ? 'POST' : 'GET',
      headers: { 'User-Agent': UA, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25000),
    });
  } catch { throw bad('Не удалось связаться с Modrinth. Проверьте доступ к интернету или включите прокси для панели.', 502); }
  if (r.status === 429) throw bad('Modrinth ограничил частоту запросов. Повторите через минуту.', 502);
  if (!r.ok) throw bad(`Modrinth ответил ${r.status}`, 502);
  return r.json();
}

let relCache = { at: 0, list: [] };
/** Релизные версии Minecraft, новые первыми. */
export async function releases() {
  if (Date.now() - relCache.at < 3600e3 && relCache.list.length) return relCache.list;
  let r;
  try { r = await cfFetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', { signal: AbortSignal.timeout(20000) }); }
  catch { throw bad('Не удалось получить список версий Minecraft', 502); }
  if (!r.ok) throw bad('Не удалось получить список версий Minecraft', 502);
  const j = await r.json();
  relCache = { at: Date.now(), list: j.versions.filter(v => v.type === 'release').map(v => v.id) };
  return relCache.list;
}

/* ---------- файлы сервера ---------- */
const hashCache = new Map(); // путь|размер|время -> sha1
const sha1File = (file, st) => {
  const key = `${file}|${st.size}|${st.mtimeMs}`;
  if (hashCache.has(key)) return Promise.resolve(hashCache.get(key));
  return new Promise((ok, no) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(file).on('data', d => h.update(d)).on('error', no).on('end', () => {
      const v = h.digest('hex');
      if (hashCache.size > 5000) hashCache.clear();
      hashCache.set(key, v);
      ok(v);
    });
  });
};

async function scanJars(cfg) {
  const dir = path.join(dk.serverDir(cfg.id), dirOf(cfg.type));
  let names = [];
  try { names = fs.readdirSync(dir).filter(n => /\.jar$/i.test(n)); } catch { return { dir, files: [] }; }
  const files = [];
  for (let i = 0; i < names.length; i += 4) {
    await Promise.all(names.slice(i, i + 4).map(async name => {
      const p = path.join(dir, name);
      try {
        const st = fs.statSync(p);
        if (st.isFile()) files.push({ name, size: st.size, sha1: await sha1File(p, st) });
      } catch {}
    }));
  }
  return { dir, files: files.sort((a, b) => a.name.localeCompare(b.name)) };
}

async function installedMc(cfg) {
  if (cfg.version && cfg.version !== 'LATEST') return cfg.version;
  const d = dk.serverDir(cfg.id);
  try {
    const m = /MC: ([\d.]+)/.exec(JSON.parse(fs.readFileSync(path.join(d, 'version_history.json'), 'utf8')).currentVersion || '');
    if (m) return m[1];
  } catch {}
  try {
    const fd = fs.openSync(path.join(d, 'logs', 'latest.log'), 'r');
    const b = Buffer.alloc(32768);
    const n = fs.readSync(fd, b, 0, b.length, 0);
    fs.closeSync(fd);
    const m = /Starting minecraft server version ([\d.]+)/.exec(b.toString('utf8', 0, n));
    if (m) return m[1];
  } catch {}
  return (await releases())[0];
}

/* ---------- проверка ---------- */
const cache = new Map(); // id сервера -> { at, data, files: { имя файла: сведения для установки } }

const primary = v => v.files.find(f => f.primary) || v.files[0];

function coreInfo(cfg, mc, rel, compat) {
  if (cfg.type === 'AUTO_CURSEFORGE') return { kind: 'pack', note: 'Версией Minecraft и модами управляет сборка CurseForge. Обновите сборку на вкладке «Моды».' };
  const pinned = cfg.version && cfg.version !== 'LATEST';
  const idx = rel.indexOf(mc);
  const behind = pinned && idx > 0 ? idx : 0;
  const out = { kind: behind ? 'newer' : pinned ? 'current' : 'auto', pinned, current: mc, latest: rel[0], behind, newer: behind ? rel.slice(0, Math.min(behind, 6)) : [] };
  if (behind && compat) out.compat = compat;
  if (!pinned) out.note = 'Выбрана «последняя» версия: при каждом запуске скачивается актуальное ядро. Перезапуск сервера обновит его.';
  else if (!behind) out.note = 'Установлена самая новая версия Minecraft. Сборки ядра внутри версии подтягиваются при перезапуске.';
  return out;
}

export async function check(cfg, force = false) {
  const hit = cache.get(cfg.id);
  if (!force && hit && Date.now() - hit.at < TTL) return hit.data;

  const rel = await releases();
  const mc = cfg.type === 'AUTO_CURSEFORGE' ? '' : await installedMc(cfg);
  const files = {};
  const mods = [];
  let compat = null;

  if (LOADERS[cfg.type]) {
    const scan = await scanJars(cfg);
    const hashes = [...new Set(scan.files.map(f => f.sha1))];
    let current = {}, latest = {}, titles = new Map();
    if (hashes.length) {
      current = await mr('/version_files', { hashes, algorithm: 'sha1' });
      const known = Object.keys(current);
      if (known.length) {
        latest = await mr('/version_files/update', { hashes: known, algorithm: 'sha1', loaders: LOADERS[cfg.type], game_versions: [mc] });
        const ids = [...new Set(Object.values(current).map(v => v.project_id))];
        for (let i = 0; i < ids.length; i += 100) {
          const part = await mr('/projects?ids=' + encodeURIComponent(JSON.stringify(ids.slice(i, i + 100))));
          for (const p of part) titles.set(p.id, p);
        }
        // Сколько модов уже есть под самую новую версию Minecraft (если сервер отстаёт)
        const target = rel[0];
        if (cfg.version && cfg.version !== 'LATEST' && rel.indexOf(mc) > 0 && mc !== target) {
          try {
            const nx = await mr('/version_files/update', { hashes: known, algorithm: 'sha1', loaders: LOADERS[cfg.type], game_versions: [target] });
            compat = { target, ok: Object.keys(nx).length, total: known.length };
          } catch {}
        }
      }
    }
    for (const f of scan.files) {
      const cur = current[f.sha1];
      if (!cur) { mods.push({ file: f.name, size: f.size, status: 'unknown', name: f.name.replace(/\.jar$/i, '') }); continue; }
      const proj = titles.get(cur.project_id);
      const lat = latest[f.sha1];
      const item = {
        file: f.name, size: f.size, status: 'ok', name: proj?.title || cur.name, slug: proj?.slug || '',
        projectId: cur.project_id, current: cur.version_number,
      };
      if (lat && lat.id !== cur.id && new Date(lat.date_published) > new Date(cur.date_published)) {
        const pf = primary(lat);
        if (pf && pf.hashes?.sha1) {
          item.status = 'update';
          item.latest = {
            version: lat.version_number, channel: lat.version_type, published: lat.date_published,
            changelog: String(lat.changelog || '').slice(0, 600), size: pf.size,
          };
          files[f.name] = { url: pf.url, sha1: pf.hashes.sha1, filename: pf.filename, size: pf.size };
        }
      }
      mods.push(item);
    }
    mods.sort((a, b) => (b.status === 'update') - (a.status === 'update') || a.name.localeCompare(b.name));
  }

  const data = {
    checkedAt: Date.now(), type: cfg.type, mc, dir: LOADERS[cfg.type] ? dirOf(cfg.type) : null,
    supportsMods: !!LOADERS[cfg.type], core: coreInfo(cfg, mc, rel, compat), mods,
    updates: mods.filter(m => m.status === 'update').length,
  };
  cache.set(cfg.id, { at: Date.now(), data, files });
  return data;
}

/* ---------- установка ---------- */
export async function download(url, dest, sha1, expected) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.hostname !== CDN_HOST) throw bad('Недопустимый адрес загрузки');
  const r = await cfFetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15 * 60e3) });
  if (!r.ok) throw bad(`Загрузка не удалась: ${r.status}`, 502);
  const h = crypto.createHash('sha1');
  let n = 0;
  const t = new Transform({
    transform(c, _, cb) {
      n += c.length;
      if (n > MAX_JAR) return cb(new Error('Файл слишком большой'));
      h.update(c);
      cb(null, c);
    },
  });
  try { await pipeline(Readable.fromWeb(r.body), t, fs.createWriteStream(dest)); }
  catch (e) { fs.rmSync(dest, { force: true }); throw e; }
  if (h.digest('hex') !== sha1) { fs.rmSync(dest, { force: true }); throw bad('Контрольная сумма файла не совпала, обновление отменено'); }
  if (expected && n !== expected) { fs.rmSync(dest, { force: true }); throw bad('Размер файла не совпал, обновление отменено'); }
}

const SAFE_NAME = /^[\w.+() \[\]-]{1,200}\.jar$/;
const last = new Map(); // id сервера -> результат последней установки

async function applyMods(cfg, wanted, withBackup) {
  const hit = cache.get(cfg.id);
  if (!hit) throw bad('Сначала выполните проверку обновлений');
  const dir = path.join(dk.serverDir(cfg.id), dirOf(cfg.type));
  const results = [];
  if (withBackup) await sv.createBackup(cfg, 'pre-update');
  for (const file of wanted) {
    const info = hit.files[file];
    if (!info) { results.push({ file, ok: false, error: 'Для этого файла нет обновления' }); continue; }
    const newName = path.basename(info.filename || '');
    if (!SAFE_NAME.test(newName)) { results.push({ file, ok: false, error: 'Недопустимое имя нового файла' }); continue; }
    const oldPath = path.join(dir, file), newPath = path.join(dir, newName);
    try {
      if (newName !== file && fs.existsSync(newPath)) throw bad(`Файл ${newName} уже существует`);
      const tmp = newPath + '.hcupd';
      await download(info.url, tmp, info.sha1, info.size);
      fs.renameSync(tmp, newPath);
      try { fs.chownSync(newPath, 1000, 1000); } catch {}
      if (newName !== file) fs.rmSync(oldPath, { force: true });
      results.push({ file, ok: true, to: newName });
    } catch (e) { results.push({ file, ok: false, error: e.message }); }
  }
  last.set(cfg.id, { at: Date.now(), results });
  await check(cfg, true).catch(() => {});
  return results;
}

/* ---------- фоновая проверка ---------- */
async function backgroundOnce() {
  for (const cfg of store.get().servers) {
    if (cfg.type === 'AUTO_CURSEFORGE') continue; // сборкой управляет CurseForge
    try {
      const d = await check(cfg, true);
      cfg.updInfo = { at: d.checkedAt, mods: d.updates, core: d.core.kind === 'newer' ? d.core.latest : '' };
      store.save();
    } catch {}
    await new Promise(r => setTimeout(r, 3000));
  }
}
export function startChecks() {
  setTimeout(() => backgroundOnce().catch(() => {}), 3 * 60e3).unref?.();
  setInterval(() => backgroundOnce().catch(() => {}), 6 * 3600e3).unref?.();
}

export function register(r, { h, view, run, busy, errs }) {
  r.get('/servers/:id/updates', h(async (req, res) => {
    const data = await check(req.cfg, req.query.refresh === '1');
    res.json({ ...data, lastApply: last.get(req.cfg.id) || null });
  }));

  r.post('/servers/:id/updates/apply', h(async (req, res) => {
    const cfg = req.cfg;
    if (!LOADERS[cfg.type]) throw bad('Для этого типа сервера моды и плагины не обновляются');
    if (busy.has(cfg.id)) throw bad('Сервер занят: ' + busy.get(cfg.id), 409);
    const files = (Array.isArray(req.body?.files) ? req.body.files : []).map(String).slice(0, 500);
    if (!files.length) throw bad('Ничего не выбрано');
    await check(cfg); // кэш нужен, чтобы адреса загрузки брались только из ответа Modrinth, а не от клиента
    run(cfg.id, 'Обновление модов…', () => applyMods(cfg, files, req.body?.backup !== false)
      .then(rs => { const f = rs.filter(x => !x.ok); if (f.length) errs.set(cfg.id, `Не обновлено: ${f.map(x => x.file).join(', ')}`); }));
    res.json({ ok: true });
  }));

  r.post('/servers/:id/updates/core', h(async (req, res) => {
    const cfg = req.cfg, version = String(req.body?.version || '');
    if (cfg.type === 'AUTO_CURSEFORGE') throw bad('Версией сборки управляет CurseForge');
    if (busy.has(cfg.id)) throw bad('Сервер занят: ' + busy.get(cfg.id), 409);
    if (!(await releases()).includes(version)) throw bad('Неизвестная версия Minecraft');
    const info = await dk.inspect(cfg.id);
    if (info?.State.Running) throw bad('Остановите сервер перед сменой версии');
    run(cfg.id, 'Смена версии…', async () => {
      if (req.body?.backup !== false) await sv.createBackup(cfg, 'pre-update');
      cfg.version = version;
      cfg.loaderVersion = ''; // версия загрузчика подбирается под новую версию Minecraft
      delete cfg.updInfo;
      cache.delete(cfg.id);
      store.save();
    });
    res.json({ ok: true, server: await view(cfg) });
  }));
}

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pipeline } from 'stream/promises';
import * as store from './store.js';
import * as dk from './dock.js';
import * as nodes from './nodes.js';
import * as transfer from './transfer.js';

/* Шаблоны серверов: сохранённые настройки (тип, версия, память, свойства, список модов) и, по желанию,
   папки mods, plugins и config. Из шаблона можно создать сервер на этой машине или на любой ноде. */

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
const DIR = path.join(dk.DATA_DIR, 'templates');
const KEYS = ['type', 'version', 'memory', 'javaTag', 'loaderVersion', 'cfSlug', 'cfFileId', 'cfMods', 'modrinthMods', 'extraPorts', 'props', 'customEnv', 'schedule', 'motd'];
const FILE_DIRS = ['mods', 'plugins', 'config', 'defaultconfigs', 'kubejs', 'scripts'];
const MAX_FILES = 2 * 1024 ** 3;

const all = () => (store.get().templates ||= []);
const find = id => all().find(t => t.id === id) || null;
const fileOf = id => path.join(DIR, `${id}.tar.gz`);

const pub = t => ({
  id: t.id, name: t.name, desc: t.desc, createdAt: t.createdAt, from: t.from, hasFiles: t.hasFiles, filesSize: t.filesSize,
  type: t.cfg.type, version: t.cfg.version || '', memory: t.cfg.memory, modrinthMods: t.cfg.modrinthMods || '', cfMods: t.cfg.cfMods || '',
  cfSlug: t.cfg.cfSlug || '', map: !!t.cfg.map?.on, dirs: t.dirs || [],
});

export async function createServer(b, ctx) {
  const t = find(String(b.templateId));
  if (!t) throw bad('Шаблон не найден', 404);
  const config = { ...JSON.parse(JSON.stringify(t.cfg)), name: String(b.name || '').trim().slice(0, 40) || t.name };
  if (b.memory) config.memory = String(b.memory);
  if (b.version && config.type !== 'AUTO_CURSEFORGE') config.version = String(b.version);
  if (b.port) config.port = Number(b.port);
  const n = b.nodeId && b.nodeId !== 'local' ? nodes.get(String(b.nodeId)) : null;
  if (b.nodeId && b.nodeId !== 'local' && !n) throw bad('Нода не найдена', 404);

  const withFiles = t.hasFiles && fs.existsSync(fileOf(t.id));
  if (!n) {
    const token = transfer.begin(config);
    try {
      if (withFiles) await transfer.receive(token, fs.createReadStream(fileOf(t.id)));
      return await ctx.finishStaged(token, { start: false });
    } catch (e) { transfer.discard(token); throw e; }
  }
  nodes.requireNew(n);
  const { token } = await nodes.json(n, 'POST', '/migrate/begin', { config }, 60000);
  try {
    if (withFiles) {
      const res = await nodes.raw(n, 'PUT', `/migrate/${token}/data`, {
        body: fs.createReadStream(fileOf(t.id)), headers: { 'content-type': 'application/gzip' }, timeout: 3600e3,
      });
      await res.body.text();
    }
    const created = await nodes.json(n, 'POST', `/migrate/${token}/finish`, { start: false }, 120000);
    nodes.place(created.id, n.id);
    await nodes.refresh(n);
    return { ...created, node: nodes.tag(n) };
  } catch (e) {
    try { await nodes.json(n, 'DELETE', '/import/' + token); } catch {}
    throw e;
  }
}

export function register(r, ctx) {
  const { h, portable } = ctx;

  r.get('/templates', h(async (req, res) => res.json(all().map(pub).sort((a, b) => b.createdAt.localeCompare(a.createdAt)))));

  r.post('/templates', h(async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name || name.length > 40) throw bad('Название шаблона: от 1 до 40 символов');
    const desc = String(req.body?.desc || '').replace(/[\r\n]/g, ' ').trim().slice(0, 200);
    const sid = String(req.body?.serverId || '');
    if (!/^[a-f0-9]{8}$/.test(sid)) throw bad('Не указан сервер');
    const local = store.get().servers.find(s => s.id === sid);
    const n = local ? null : await nodes.locate(sid);
    if (!local && !n) throw bad('Сервер не найден', 404);
    if (n) nodes.requireNew(n);

    const pf = local ? portable(local) : await nodes.json(n, 'GET', `/servers/${sid}/portable`, undefined, 30000);
    const cfg = {};
    for (const k of KEYS) if (pf[k] !== undefined && pf[k] !== null) cfg[k] = JSON.parse(JSON.stringify(pf[k]));
    if (pf.map?.on) cfg.map = { on: true, added: !!pf.map.added };
    if (Array.isArray(cfg.schedule)) cfg.schedule = cfg.schedule.map(({ lastRun, lastRunDay, lastStatus, ...t }) => t);
    const t = {
      id: crypto.randomBytes(4).toString('hex'), name, desc, createdAt: new Date().toISOString(),
      from: n ? n.name : 'Эта машина', cfg, hasFiles: false, filesSize: 0, dirs: [],
    };

    if (req.body?.withFiles) {
      fs.mkdirSync(DIR, { recursive: true });
      const dest = fileOf(t.id);
      let size = 0;
      const cap = transfer.counter(len => { size += len; if (size > MAX_FILES) cap.destroy(new Error('Файлы больше 2 ГБ: уберите лишнее из mods, plugins или config')); });
      try {
        let source;
        if (local) {
          const x = transfer.exportStream(sid, { dirs: FILE_DIRS, exclude: ['./plugins/dynmap/web/tiles'] });
          if (x) { x.done.then(d => { if (!d.ok) x.stream.destroy(new Error('Не удалось упаковать файлы: ' + d.err.slice(0, 200))); }); source = x.stream; }
        } else {
          try {
            source = (await nodes.raw(n, 'GET', `/servers/${sid}/export?lean=1&dirs=${FILE_DIRS.join(',')}`, { timeout: 120e3 })).body;
          } catch (e) { if (e.status !== 404) throw e; }
        }
        if (source) {
          await pipeline(source, cap, fs.createWriteStream(dest));
          t.hasFiles = size > 0;
          t.filesSize = size;
        }
      } catch (e) { fs.rmSync(dest, { force: true }); throw bad(e.message || 'Не удалось сохранить файлы', e.status || 500); }
      if (t.hasFiles) {
        try {
          const dir = local ? dk.serverDir(sid) : null;
          t.dirs = dir ? FILE_DIRS.filter(d => fs.existsSync(path.join(dir, d))) : [];
        } catch {}
      }
    }
    all().push(t);
    store.save();
    res.json(pub(t));
  }));

  r.put('/templates/:tid', h(async (req, res) => {
    const t = find(req.params.tid);
    if (!t) throw bad('Шаблон не найден', 404);
    if ('name' in (req.body || {})) {
      const name = String(req.body.name).trim();
      if (!name || name.length > 40) throw bad('Название шаблона: от 1 до 40 символов');
      t.name = name;
    }
    if ('desc' in (req.body || {})) t.desc = String(req.body.desc || '').replace(/[\r\n]/g, ' ').trim().slice(0, 200);
    store.save();
    res.json(pub(t));
  }));

  r.delete('/templates/:tid', h(async (req, res) => {
    const t = find(req.params.tid);
    if (!t) throw bad('Шаблон не найден', 404);
    fs.rmSync(fileOf(t.id), { force: true });
    store.get().templates = all().filter(x => x.id !== t.id);
    store.save();
    res.json({ ok: true });
  }));
}

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import * as store from './store.js';
import * as dk from './dock.js';
import * as sv from './services.js';
import * as P from './proxy.js';
import { IMPORT_DIR } from './importer.js';

/* Очистка диска: что осталось от удалённых серверов и что панель накопила сама.
   Удаляется только найденное здесь же при новом поиске: из браузера приходят ключи, а не пути, поэтому удалить
   что-то за пределами этого списка нельзя. Чужие контейнеры и образы (не HorizonCraft) не рассматриваются. */

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
const ID = /^[a-f0-9]{8}$/;
const DAY = 864e5;
const CRASH = /^(hs_err_pid\d+\.log|replay_pid\d+\.log|core(\.\d+)?)$/;
const JAVA_TAGS = ['latest', 'java25', 'java21', 'java17', 'java11', 'java8'];

const du = p => new Promise(resolve => {
  const c = spawn('du', ['-sk', p], { stdio: ['ignore', 'pipe', 'ignore'] });
  let out = '';
  c.stdout.on('data', d => (out += d));
  c.on('close', () => resolve((parseInt(out) || 0) * 1024));
  c.on('error', () => { try { resolve(fs.statSync(p).size); } catch { resolve(0); } });
});
const ls = dir => { try { return fs.readdirSync(dir); } catch { return []; } };
const lstat = p => { try { return fs.lstatSync(p); } catch { return null; } };

/** Ищет лишнее. Каждый элемент: { key, kind, title, detail, bytes }. */
export async function scan() {
  const st = store.get();
  const ids = new Set(st.servers.map(s => s.id));
  const busy = id => sv.busy.has(id);
  const out = [];
  const addPath = async (key, kind, title, detail, p) => out.push({ key, kind, title, detail, bytes: await du(p), path: p });

  // папки удалённых серверов (мир, моды, настройки)
  for (const n of ls(path.join(dk.DATA_DIR, 'servers'))) {
    if (!ID.test(n) || ids.has(n) || busy(n)) continue;
    const p = dk.serverDir(n);
    if (!lstat(p)?.isDirectory()) continue;
    await addPath(`server:${n}`, 'server', `Файлы удалённого сервера ${n}`, 'мир, моды и настройки', p);
  }
  // резервные копии удалённых серверов
  for (const n of ls(path.join(dk.DATA_DIR, 'backups'))) {
    if (!ID.test(n) || ids.has(n)) continue;
    const p = sv.backupDir(n);
    if (!lstat(p)?.isDirectory()) continue;
    const count = ls(p).filter(f => sv.BACKUP_RE.test(f)).length;
    await addPath(`backups:${n}`, 'backups', `Резервные копии удалённого сервера ${n}`, `копий: ${count}`, p);
  }
  // обложки и значки удалённых серверов
  for (const n of ls(path.join(dk.DATA_DIR, 'covers'))) {
    const m = /^([a-f0-9]{8})(-sm|-logo)?\.webp$/.exec(n);
    if (!m || ids.has(m[1])) continue;
    await addPath(`cover:${n}`, 'cover', `Обложка или значок удалённого сервера ${m[1]}`, n, path.join(dk.DATA_DIR, 'covers', n));
  }
  // отчёты о падениях Java в папках существующих серверов (core-файлы бывают размером с память сервера)
  for (const s of st.servers) {
    for (const n of ls(dk.serverDir(s.id))) {
      if (!CRASH.test(n)) continue;
      const p = path.join(dk.serverDir(s.id), n), l = lstat(p);
      if (!l?.isFile()) continue;
      out.push({ key: `crash:${s.id}/${n}`, kind: 'crash', title: `Отчёт о падении Java: ${s.name}`, detail: n, bytes: l.size, path: p });
    }
  }
  // незавершённые загрузки и переносы (старше часа: идущие сейчас не трогаем)
  for (const n of ls(IMPORT_DIR)) {
    if (!/^[a-f0-9]{16}$/.test(n)) continue;
    const p = path.join(IMPORT_DIR, n), l = lstat(p);
    if (!l?.isDirectory() || Date.now() - l.mtimeMs < 3600e3) continue;
    await addPath(`import:${n}`, 'import', 'Незавершённая загрузка или перенос сервера', new Date(l.mtimeMs).toLocaleString('ru-RU'), p);
  }
  // файлы удалённых шаблонов
  const tpl = new Set((st.templates || []).map(t => t.id));
  for (const n of ls(path.join(dk.DATA_DIR, 'templates'))) {
    const m = /^([a-f0-9]{8,32})\.tar\.gz$/.exec(n);
    if (!m || tpl.has(m[1])) continue;
    await addPath(`template:${n}`, 'template', 'Файлы удалённого шаблона', n, path.join(dk.DATA_DIR, 'templates', n));
  }
  // остатки обновлений панели: копии прежнего кода и брошенная распаковка
  const upd = path.join(dk.DATA_DIR, 'update');
  for (const n of ls(upd)) {
    const p = path.join(upd, n), l = lstat(p);
    if (!l) continue;
    const old = /^code-before-.+\.tgz$/.test(n), work = (n === 'src' || n === 'src.tgz') && Date.now() - l.mtimeMs > DAY;
    if (old || work) await addPath(`update:${n}`, 'update', old ? 'Копия кода панели до обновления' : 'Остаток неудачного обновления', n, p);
  }

  // контейнеры удалённых серверов и их спутники TUN
  let containers = [];
  try { containers = await dk.docker.listContainers({ all: true, filters: { label: ['mcpanel.id'] } }); } catch {}
  const prefix = process.env.SERVER_PREFIX || 'mc-';
  for (const c of containers) {
    const id = c.Labels?.['mcpanel.id'], name = (c.Names || [])[0]?.slice(1) || '';
    if (!ID.test(id || '') || ids.has(id) || busy(id)) continue;
    const own = (c.Labels.mcpanel === 'true' && name === prefix + id) || (c.Labels.mcpanel === 'tun' && name === `${P.NAME_PREFIX}-tun-${id}`);
    if (!own) continue;
    out.push({ key: `container:${name}`, kind: 'container', title: `Контейнер удалённого сервера ${id}`, detail: `${name} · ${c.State}`, bytes: 0, cid: c.Id });
  }
  // образы Minecraft с версией Java, которая ни одному серверу не нужна (образ latest нужен для новых серверов)
  const need = new Set(['latest', ...st.servers.map(dk.javaTag)]);
  let images = [];
  try { images = await dk.docker.listImages(); } catch {}
  let used = new Set();
  try { used = new Set((await dk.docker.listContainers({ all: true })).map(c => c.ImageID)); } catch {}
  for (const im of images) {
    for (const ref of im.RepoTags || []) {
      const tag = ref.startsWith(dk.IMG + ':') ? ref.slice(dk.IMG.length + 1) : null;
      if (!tag || !JAVA_TAGS.includes(tag) || need.has(tag) || used.has(im.Id)) continue;
      out.push({ key: `image:${tag}`, kind: 'image', title: `Образ Minecraft с ${tag === 'java8' ? 'Java 8' : tag.replace('java', 'Java ')}`, detail: 'сейчас ни одному серверу не нужен, при необходимости скачается снова', bytes: im.Size || 0, ref });
    }
  }
  return out;
}

const pub = list => list.map(({ key, kind, title, detail, bytes }) => ({ key, kind, title, detail, bytes }));

/** Удаляет выбранное. Список ключей сверяется со свежим поиском. */
export async function clean(keys) {
  if (!Array.isArray(keys) || !keys.length) throw bad('Ничего не выбрано');
  const want = new Set(keys.map(String));
  const found = (await scan()).filter(x => want.has(x.key));
  let freed = 0;
  const failed = [];
  for (const x of found) {
    try {
      if (x.kind === 'container') await dk.docker.getContainer(x.cid).remove({ force: true });
      else if (x.kind === 'image') await dk.docker.getImage(x.ref).remove();
      else fs.rmSync(x.path, { recursive: true, force: true });
      freed += x.bytes;
    } catch (e) { failed.push(`${x.title}: ${e.message}`); }
  }
  return { removed: found.length - failed.length, freed, failed };
}

export function register(r, { h }) {
  r.get('/cleanup', h(async (req, res) => res.json(pub(await scan()))));
  r.post('/cleanup', h(async (req, res) => {
    const result = await clean(req.body?.keys);
    res.json({ ...result, items: pub(await scan()) });
  }));
}

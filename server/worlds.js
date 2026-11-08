import fs from 'fs';
import path from 'path';
import * as dk from './dock.js';
import * as sv from './services.js';

/* Очистка измерений: Мир (Верхний мир), Незер, Край. Удаляются только данные чанков выбранного измерения,
   остальное (инвентари, достижения, настройки, остальные измерения) остаётся. При следующем запуске сервер
   сгенерирует измерение заново. У разных версий и ядер разная раскладка папок, поэтому проверяются все известные. */

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });

export const DIMS = {
  overworld: { title: 'Мир', paths: L => [`${L}/dimensions/minecraft/overworld`, `${L}/region`, `${L}/entities`, `${L}/poi`] },
  nether: { title: 'Незер', paths: L => [`${L}/dimensions/minecraft/the_nether`, `${L}/DIM-1`, `${L}_nether/DIM-1`, `${L}_nether/dimensions/minecraft/the_nether`] },
  end: { title: 'Край', paths: L => [`${L}/dimensions/minecraft/the_end`, `${L}/DIM1`, `${L}_the_end/DIM1`, `${L}_the_end/dimensions/minecraft/the_end`] },
};

const LEVEL_RE = /^[\p{L}\p{N}_ .-]{1,64}$/u;   // буквы любых алфавитов, без слэшей
/** Имя папки мира: из server.properties, иначе из настроек сервера, иначе «world». */
export function levelName(cfg) {
  let name = '';
  try { name = (/^level-name=(.*)$/m.exec(fs.readFileSync(path.join(dk.serverDir(cfg.id), 'server.properties'), 'utf8')) || [])[1] || ''; } catch {}
  name = (name || cfg.props?.LEVEL || cfg.customEnv?.LEVEL || 'world').trim();
  if (!LEVEL_RE.test(name) || name.startsWith('.')) throw bad('Недопустимое имя мира в настройках сервера');
  return name;
}

/** Существующие папки измерения (абсолютные пути строго внутри папки сервера). */
function found(cfg, dim) {
  const root = path.resolve(dk.serverDir(cfg.id));
  const L = levelName(cfg);
  const out = [];
  for (const rel of DIMS[dim].paths(L)) {
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(root + path.sep)) continue;   // защита от выхода за пределы папки сервера
    try { if (fs.statSync(abs).isDirectory()) out.push({ rel, abs }); } catch {}
  }
  return out;
}

async function sizeOf(dir) {
  let n = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let list;
    try { list = await fs.promises.readdir(d, { withFileTypes: true }); } catch { continue; }
    await Promise.all(list.map(async e => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else { try { n += (await fs.promises.stat(p)).size; } catch {} }
    }));
  }
  return n;
}

const last = new Map();   // id сервера -> итог последней очистки

export async function info(cfg) {
  const dims = [];
  for (const [id, d] of Object.entries(DIMS)) {
    const f = found(cfg, id);
    let bytes = 0;
    for (const x of f) bytes += await sizeOf(x.abs);
    dims.push({ id, title: d.title, exists: f.length > 0, bytes });
  }
  return { level: levelName(cfg), dims, last: last.get(cfg.id) || null };
}

export async function clear(cfg, dim, { backup = true, newSeed = false } = {}) {
  if (!DIMS[dim]) throw bad('Неизвестное измерение');
  const L = levelName(cfg), root = path.resolve(dk.serverDir(cfg.id));
  const was = await dk.inspect(cfg.id);
  const running = !!was?.State.Running;
  if (running) await dk.stop(cfg.id);
  const res = { dim, at: Date.now(), removed: [], backup: null, newSeed: false, restarted: false };
  try {
    if (backup) res.backup = await sv.createBackup(cfg, 'pre-clear');
    for (const f of found(cfg, dim)) { fs.rmSync(f.abs, { recursive: true, force: true }); res.removed.push(f.rel); }
    if (dim === 'overworld' && newSeed) {
      for (const n of ['level.dat', 'level.dat_old']) {
        const abs = path.resolve(root, L, n);
        if (abs.startsWith(root + path.sep) && fs.existsSync(abs)) { fs.rmSync(abs, { force: true }); res.newSeed = true; }
      }
    }
  } finally {
    if (running) { await dk.start(cfg); res.restarted = true; }
  }
  last.set(cfg.id, res);
  return res;
}

export function register(r, { h, run, busy }) {
  r.get('/servers/:id/worlds', h(async (req, res) => res.json(await info(req.cfg))));

  r.post('/servers/:id/worlds/clear', h(async (req, res) => {
    const cfg = req.cfg, dim = String(req.body?.dim || '');
    if (!DIMS[dim]) throw bad('Неизвестное измерение');
    if (busy.has(cfg.id)) throw bad('Сервер занят: ' + busy.get(cfg.id), 409);
    if (!found(cfg, dim).length) throw bad(`Измерение «${DIMS[dim].title}» ещё не создано, очищать нечего`);
    const opts = { backup: req.body?.backup !== false, newSeed: !!req.body?.newSeed };
    run(cfg.id, `Очистка: ${DIMS[dim].title}…`, () => clear(cfg, dim, opts));
    res.json({ ok: true });
  }));
}

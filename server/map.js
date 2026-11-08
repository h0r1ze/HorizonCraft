import fs from 'fs';
import path from 'path';
import * as store from './store.js';
import * as dk from './dock.js';

/* Карта мира: плагин Dynmap. Панель ставит его через Modrinth (переменная MODRINTH_PROJECTS образа),
   публикует веб-порт плагина (8123 внутри контейнера) на свободный порт хоста и показывает ссылку. */

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });

export const SUPPORTED = ['PAPER', 'PURPUR'];
// У Dynmap на Modrinth есть только бета-сборки, а образ по умолчанию берёт лишь релизы и падает с ошибкой
// «No candidate versions ... matched versionType=release». Суффикс :beta разрешает бета-версии для этого проекта.
const SLUG = 'dynmap:beta';
const FIRST = 8123, LAST = 8199;
const isDynmap = x => /^dynmap([:@].*)?$/i.test(x);

/** Свободный порт хоста для веб-страницы карты: не занят серверами панели и любыми контейнерами Docker. */
export async function allocPort() {
  const used = new Set();
  for (const s of store.get().servers) {
    used.add(Number(s.port));
    if (s.map?.port) used.add(Number(s.map.port));
    for (const x of dk.parseExtra(s.extraPorts)) used.add(Number(x.port));
  }
  try { for (const p of await dk.publishedPorts()) used.add(Number(p)); } catch {}
  for (let p = FIRST; p <= LAST; p++) if (!used.has(p)) return p;
  throw bad(`Нет свободных портов для карты (${FIRST}-${LAST})`);
}

const jarPresent = cfg => {
  try { return fs.readdirSync(path.join(dk.serverDir(cfg.id), 'plugins')).some(n => /^dynmap.*\.jar$/i.test(n)); }
  catch { return false; }
};

const status = cfg => ({
  supported: SUPPORTED.includes(cfg.type), type: cfg.type,
  on: !!cfg.map?.on, port: cfg.map?.on ? Number(cfg.map.port) : null, installed: jarPresent(cfg),
});

export function register(r, { h, view }) {
  r.get('/servers/:id/map', h(async (req, res) => res.json(status(req.cfg))));

  r.put('/servers/:id/map', h(async (req, res) => {
    const cfg = req.cfg, on = !!req.body?.on;
    const mods = String(cfg.modrinthMods || '').split(/[\s,]+/).filter(Boolean);
    if (on) {
      if (!SUPPORTED.includes(cfg.type)) throw bad('Карта поддерживается на серверах Paper и Purpur. Для других типов поставьте мод карты вручную.');
      const had = mods.some(isDynmap);
      cfg.map = {
        on: true,
        port: cfg.map?.port && cfg.map.on ? cfg.map.port : await allocPort(),
        added: had ? !!cfg.map?.added : true,
      };
      if (!had) cfg.modrinthMods = [...mods, SLUG].join(',');
    } else if (cfg.map) {
      if (cfg.map.added) cfg.modrinthMods = mods.filter(x => !isDynmap(x)).join(',');
      cfg.map = { on: false, port: cfg.map.port, added: false };
    }
    store.save();
    res.json({ ...status(cfg), server: await view(cfg) });
  }));

  r.post('/servers/:id/map/render', h(async (req, res) => {
    const world = String(req.body?.world || 'world').trim();
    if (!/^[\w.-]{1,64}$/.test(world)) throw bad('Недопустимое имя мира');
    if (!status(req.cfg).installed) throw bad('Плагин Dynmap ещё не установлен: запустите сервер после включения карты');
    const info = await dk.inspect(req.cfg.id);
    if (!info?.State.Running) throw bad('Сервер остановлен');
    res.json({ out: (await dk.rcon(req.cfg.id, `dynmap fullrender ${world}`)) || 'Отрисовка запущена' });
  }));
}

import fs from 'fs';
import os from 'os';
import path from 'path';
import { docker, DATA_DIR, publishedPorts } from '../dock.js';
import * as store from '../store.js';
import { INNER_PORT, validPort } from './portspec.js';

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
const FILE = path.join(DATA_DIR, 'tls', 'portchange.json');
let running = false;

/** Порт панели на хосте. Если переменная PANEL_PORT не задана (установка со старым docker-compose.yml),
    при запуске он определяется по пробросу порта собственного контейнера. */
export async function detectPort() {
  if (Number(process.env.PANEL_PORT)) return Number(process.env.PANEL_PORT);
  try {
    const self = await docker.getContainer(os.hostname()).inspect();
    const p = Number(self.HostConfig?.PortBindings?.[`${INNER_PORT}/tcp`]?.[0]?.HostPort);
    if (validPort(p)) { process.env.PANEL_PORT = String(p); return p; }
  } catch {}
  return 0;
}

/** Итог последней смены порта (пишет вспомогательный контейнер): {ok, port, oldPort, error, at} или null. */
export function last() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return null; }
}

/** Порты, занятые серверами панели, картами и контейнерами Docker (в том числе чужими). */
async function taken() {
  const used = new Map();
  for (const s of store.get().servers || []) {
    used.set(Number(s.port), `сервером «${s.name}»`);
    if (s.map?.on && s.map.port) used.set(Number(s.map.port), `картой сервера «${s.name}»`);
    for (const m of String(s.extraPorts || '').matchAll(/(\d{2,5})(?:\/(?:tcp|udp))?/g)) used.set(Number(m[1]), `сервером «${s.name}»`);
  }
  try { for (const p of await publishedPorts()) if (!used.has(p)) used.set(p, 'другим контейнером Docker'); } catch {}
  return used;
}

/** Запускает смену порта: вспомогательный контейнер пересоздаст панель. Возвращает сразу, панель перезапустится через пару секунд. */
export async function change(rawPort) {
  const port = Number(rawPort);
  if (!validPort(port)) throw bad('Порт должен быть числом от 1 до 65535');
  const cur = Number(process.env.PANEL_PORT) || 0;
  if (port === cur) throw bad(`Панель уже работает на порту ${port}`);
  if (running) throw bad('Смена порта уже выполняется');
  const used = (await taken()).get(port);
  if (used) throw bad(`Порт ${port} уже занят ${used}. Выберите другой.`);
  let self;
  try { self = await docker.getContainer(os.hostname()).inspect(); } catch { throw bad('Смена порта работает только в установке через Docker: панель не нашла свой контейнер'); }
  if (!self.HostConfig?.PortBindings?.[`${INNER_PORT}/tcp`]) throw bad(`У контейнера панели нет проброса порта ${INNER_PORT}, меняйте порт через .env и docker compose`);
  const dir = self.Config?.Labels?.['com.docker.compose.project.working_dir'];
  const prefix = process.env.NAME_PREFIX || 'mcpanel';
  const binds = ['/var/run/docker.sock:/var/run/docker.sock', `${DATA_DIR}:${DATA_DIR}`];
  if (dir) binds.push(`${dir}:${dir}`);
  running = true;
  try {
    const c = await docker.createContainer({
      name: `${prefix}-portswap-${Math.random().toString(16).slice(2, 8)}`, Image: self.Config.Image, Cmd: ['node', 'server/tls/portswap.js'],
      Labels: { 'horizoncraft.role': 'portswap' },
      Env: [`SELF=${self.Id}`, `NEW_PORT=${port}`, `DATA_DIR=${DATA_DIR}`],
      // в той же сети Docker, что и панель: иначе помощник не достучится до новой панели и не поймёт, что она поднялась
      HostConfig: { Binds: binds, AutoRemove: true, RestartPolicy: { Name: 'no' }, Memory: 128 * 1024 * 1024, ...(self.HostConfig.NetworkMode && self.HostConfig.NetworkMode !== 'default' ? { NetworkMode: self.HostConfig.NetworkMode } : {}) },
    });
    await c.start();
  } catch (e) { running = false; throw bad('Не удалось запустить смену порта: ' + e.message, 500); }
  try { fs.rmSync(FILE, { force: true }); } catch {}
  return { port };
}

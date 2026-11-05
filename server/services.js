import os from 'os';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import * as store from './store.js';
import * as dk from './dock.js';
import crypto from 'crypto';
import * as M from '../public/mc.js';
import { resolveNick } from './chat.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad = n => String(n).padStart(2, '0');

/* ---------- занятость серверов ---------- */
export const busy = new Map();
export const errs = new Map();
export function run(id, label, fn) {
  busy.set(id, label);
  errs.delete(id);
  fn().catch(e => { errs.set(id, e.message); console.error(e); }).finally(() => busy.delete(id));
}

/* ---------- процессы ---------- */
function sh(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => (err += d));
    p.on('error', reject);
    p.on('close', code => resolve({ code, err }));
  });
}
const du = dir => new Promise(resolve => {
  const p = spawn('du', ['-sk', dir], { stdio: ['ignore', 'pipe', 'ignore'] });
  let out = '';
  p.stdout.on('data', d => (out += d));
  p.on('close', () => resolve((parseInt(out) || 0) * 1024));
  p.on('error', () => resolve(0));
});
const duCache = new Map();
export async function dirSize(id) {
  const c = duCache.get(id);
  if (c && Date.now() - c.at < 60000) return c.size;
  const size = await du(dk.serverDir(id));
  duCache.set(id, { at: Date.now(), size });
  return size;
}

/* ---------- мониторинг ---------- */
export const live = new Map();
export const hostHist = [];
export const host = { cpu: 0 };
const HIST = 180;
let lastCpu = null;

function sampleHost() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) { for (const k in c.times) total += c.times[k]; idle += c.times.idle; }
  if (lastCpu) {
    const dt = total - lastCpu.total, di = idle - lastCpu.idle;
    host.cpu = dt > 0 ? Math.round((1 - di / dt) * 1000) / 10 : 0;
  }
  lastCpu = { idle, total };
  hostHist.push({ t: Date.now(), cpu: host.cpu, mem: os.totalmem() - os.freemem() });
  if (hostHist.length > HIST) hostHist.shift();
}

export function hostInfo() {
  let disk = { total: 0, free: 0 };
  try { const s = fs.statfsSync(dk.DATA_DIR); disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize }; } catch {}
  return {
    cpu: host.cpu, cores: os.cpus().length, model: os.cpus()[0]?.model || '',
    load: os.loadavg(), memTotal: os.totalmem(), memUsed: os.totalmem() - os.freemem(),
    uptime: os.uptime(), disk, hist: hostHist,
  };
}

/* ---------- приписки к никам (команды team: префикс, суффикс и цвет ника) ---------- */
export const teamOf = nick => 'mcp_' + crypto.createHash('sha1').update(String(nick).toLowerCase()).digest('hex').slice(0, 8);
const space = { text: ' ' };
/* Команды team, выданные через RCON, оператору в чат приходят как «[Rcon: ...]». Если на сервере кто-то онлайн,
   на время работы отключаем показ обратной связи и возвращаем как было (имя правила зависит от версии игры). */
async function quiet(cfg, fn) {
  let rule = null, was = false;
  try {
    const info = await dk.inspect(cfg.id);
    const L = live.get(cfg.id);
    if (info?.State.Running && L?.count > 0) {
      for (const r of ['sendCommandFeedback', 'send_command_feedback']) {
        const out = await dk.rcon(cfg.id, `gamerule ${r}`);
        if (/\b(true|false)\b/.test(out) && !/unknown|incorrect|expected|invalid/i.test(out)) { rule = r; was = /true/.test(out); break; }
      }
      if (rule && was) await dk.rcon(cfg.id, `gamerule ${rule} false`);
    }
  } catch {}
  try { return await fn(); }
  finally { if (rule && was) await dk.rcon(cfg.id, `gamerule ${rule} true`).catch(() => {}); }
}

export const applyTag = (cfg, nick, tag) => quiet(cfg, () => applyTagRaw(cfg, nick, tag));
async function applyTagRaw(cfg, nick, tag) {
  const team = teamOf(nick);
  const errors = [];
  const run = async c => {
    const out = await dk.rcon(cfg.id, c);
    if (/unknown or incomplete|incorrect argument|expected|invalid|could not be/i.test(out) && !/already exists/i.test(out)) errors.push(out.split('\n')[0]);
  };
  await run(`team add ${team}`);
  await run(`team modify ${team} prefix ${JSON.stringify(tag.prefix ? [...M.toComponents(tag.prefix), space] : { text: '' })}`);
  await run(`team modify ${team} suffix ${JSON.stringify(tag.suffix ? [space, ...M.toComponents(tag.suffix)] : { text: '' })}`);
  await run(`team modify ${team} color ${tag.color ? M.COLOR_NAME[tag.color] : 'reset'}`);
  await run(`team join ${team} ${nick}`);
  return errors;
}
export const removeTag = (cfg, nick) => quiet(cfg, async () => {
  await dk.rcon(cfg.id, `team leave ${nick}`);
  await dk.rcon(cfg.id, `team remove ${teamOf(nick)}`);
});
export async function applyTags(cfg) {
  await quiet(cfg, async () => {
    for (const [nick, tag] of Object.entries(cfg.tags || {})) await applyTagRaw(cfg, nick, tag).catch(e => console.error('tag', nick, e.message));
  });
}

async function pollServer(cfg) {
  let L = live.get(cfg.id);
  if (!L) { L = { hist: [], running: false, online: [], count: 0, max: null }; live.set(cfg.id, L); }
  const info = await dk.inspect(cfg.id).catch(() => null);
  if (!info?.State.Running) { L.running = false; L.online = []; L.count = 0; L.cpu = 0; L.cores = 0; L.mem = 0; return; }
  if (!L.running) L.hist = [];
  const st = await dk.stats(cfg.id, true).catch(() => null);
  let online = [], count = 0, max = null;
  if (info.State.Health?.Status !== 'starting') {
    const pg = await dk.ping(dk.cname(cfg.id)).catch(() => null);
    if (pg) {
      if (L.tagStamp !== info.State.StartedAt) { L.tagStamp = info.State.StartedAt; applyTags(cfg).catch(e => console.error('tags', e.message)); }
      count = pg.online; max = pg.max; online = pg.sample;
      // Статус отдаёт лишь часть ников. Полный список запрашиваем, только если игроки есть.
      if (count > online.length) {
        try {
          const t = await dk.rcon(cfg.id, 'list');
          const m = /players online:\s*(.*)/s.exec(t);
          if (m) online = m[1].split(',').map(x => x.trim()).filter(Boolean).map(x => resolveNick(x, cfg.tags, pg.sample) || x);
        } catch {}
      }
    }
  }
  Object.assign(L, { running: true, at: Date.now(), online, count, max, cpu: st?.cpu || 0, cores: st?.cores || 0, cpus: st?.cpus || 0, mem: st?.mem || 0, memLimit: st?.memLimit || 0 });
  L.hist.push({ t: Date.now(), cpu: L.cpu, cores: L.cores, mem: L.mem, players: count });
  if (L.hist.length > HIST) L.hist.shift();
}

let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try {
    sampleHost();
    const ids = new Set(store.get().servers.map(s => s.id));
    for (const id of live.keys()) if (!ids.has(id)) live.delete(id);
    await Promise.allSettled(store.get().servers.map(pollServer));
  } finally { polling = false; }
}

/* ---------- резервные копии ---------- */
export const backupDir = id => path.join(dk.DATA_DIR, 'backups', id);
export const BACKUP_RE = /^[\w.-]+\.tar\.gz$/;

export function listBackups(id) {
  const dir = backupDir(id);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(n => BACKUP_RE.test(n)).map(name => {
    const st = fs.statSync(path.join(dir, name));
    return { name, size: st.size, mtime: st.mtimeMs, auto: name.includes('-auto'), kind: name.replace(/\.tar\.gz$/, '').split('-').slice(2).join('-') };
  }).sort((a, b) => b.mtime - a.mtime);
}

export async function createBackup(cfg, label = 'manual') {
  const dir = backupDir(cfg.id);
  fs.mkdirSync(dir, { recursive: true });
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const name = `${stamp}-${label}.tar.gz`;
  const file = path.join(dir, name);
  const info = await dk.inspect(cfg.id);
  const running = !!info?.State.Running && info.State.Health?.Status !== 'starting';
  if (running) {
    try { await dk.rcon(cfg.id, 'save-off'); await dk.rcon(cfg.id, 'save-all flush'); await sleep(2500); } catch {}
  }
  try {
    const r = await sh('tar', ['-czf', file, '--exclude=./logs', '--exclude=./cache', '--exclude=./.cache', '-C', dk.serverDir(cfg.id), '.']);
    if ((r.code !== 0 && r.code !== 1) || !fs.existsSync(file)) {
      fs.rmSync(file, { force: true });
      throw new Error('Не удалось создать архив: ' + r.err.slice(0, 200));
    }
  } finally {
    if (running) await dk.rcon(cfg.id, 'save-on').catch(() => {});
  }
  return name;
}

export function pruneAuto(id, keep) {
  const autos = listBackups(id).filter(b => b.auto);
  for (const b of autos.slice(keep)) fs.rmSync(path.join(backupDir(id), b.name), { force: true });
}

export async function restoreBackup(cfg, name) {
  const file = path.join(backupDir(cfg.id), name);
  if (!BACKUP_RE.test(name) || !fs.existsSync(file)) throw new Error('Резервная копия не найдена');
  const info = await dk.inspect(cfg.id);
  if (info?.State.Running) throw new Error('Остановите сервер перед восстановлением');
  await createBackup(cfg, 'pre-restore');
  const dir = dk.serverDir(cfg.id);
  for (const e of fs.readdirSync(dir)) fs.rmSync(path.join(dir, e), { recursive: true, force: true });
  const r = await sh('tar', ['-xzf', file, '-C', dir]);
  if (r.code !== 0) throw new Error('Не удалось распаковать архив: ' + r.err.slice(0, 200));
  await sh('chown', ['-R', '1000:1000', dir]);
  duCache.delete(cfg.id);
}

export async function cloneData(fromId, toId) {
  const src = dk.serverDir(fromId), dst = dk.serverDir(toId);
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(src, dst, { recursive: true });
  await sh('chown', ['-R', '1000:1000', dst]);
}

/* ---------- расписание ---------- */
async function runTask(cfg, task) {
  const id = cfg.id;
  try {
    if (task.kind === 'backup') {
      busy.set(id, 'Резервная копия…');
      try { await createBackup(cfg, 'auto'); pruneAuto(id, task.keep || 7); } finally { busy.delete(id); }
    } else {
      const info = await dk.inspect(id);
      if (!info?.State.Running) { task.lastStatus = 'Пропущено: сервер остановлен'; return; }
      if (task.kind === 'command') await dk.rcon(id, task.command);
      else if (task.kind === 'restart') {
        busy.set(id, 'Плановый перезапуск…');
        try {
          await dk.rcon(id, 'say Сервер перезапустится через 30 секунд').catch(() => {});
          await sleep(30000);
          await dk.stop(id);
          await dk.start(cfg);
        } finally { busy.delete(id); }
      }
    }
    task.lastStatus = 'ok';
  } catch (e) {
    task.lastStatus = 'Ошибка: ' + e.message;
    console.error('task', e);
  }
  store.save();
}

async function tick() {
  const now = new Date();
  const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  for (const cfg of store.get().servers) {
    for (const task of cfg.schedule || []) {
      if (!task.enabled) continue;
      let due = false;
      if (task.mode === 'daily') due = task.time === hhmm && task.lastRunDay !== day;
      else due = Date.now() - (task.lastRun || 0) >= (task.hours || 24) * 3600e3;
      if (!due || busy.has(cfg.id)) continue;
      task.lastRun = Date.now();
      task.lastRunDay = day;
      store.save();
      runTask(cfg, task);
    }
  }
}

export function startServices() {
  poll();
  setInterval(poll, 10000);
  setInterval(() => tick().catch(e => console.error('tick', e)), 30000);
}

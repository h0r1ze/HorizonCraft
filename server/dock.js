import Docker from 'dockerode';
import { PassThrough } from 'stream';
import path from 'path';
import fs from 'fs';
import os from 'os';
import net from 'net';
import http from 'http';
import tlsMod from 'tls';
import * as P from './proxy.js';
import crypto from 'crypto';
import * as store from './store.js';
import sharp from 'sharp';
import * as M from '../public/mc.js';

export const docker = new Docker({ socketPath: '/var/run/docker.sock' });
export const NET = 'mcpanel';
export const DATA_DIR = process.env.DATA_DIR || '/data';
export const serverDir = id => path.join(DATA_DIR, 'servers', id);
export const cname = id => 'mc-' + id;
export const IMG = 'itzg/minecraft-server';
const ROUTER = 'mcpanel-router';
const sha = s => crypto.createHash('sha1').update(s).digest('hex');

let gateway = '172.21.0.1';
export const getGateway = () => gateway;

export async function ensureNetwork() {
  const nets = await docker.listNetworks({ filters: { name: [NET] } });
  if (!nets.find(n => n.Name === NET)) await docker.createNetwork({ Name: NET, Driver: 'bridge' });
  try {
    const gw = (await docker.getNetwork(NET).inspect()).IPAM?.Config?.[0]?.Gateway;
    if (gw) gateway = gw;
  } catch {}
}

/* Прокси для скачивания установщиков и файлов (например, если сайт заблокирован в вашей стране).
   Если указан адрес на самом сервере (127.0.0.1:порт), контейнеры его не видят. Для них поднимается
   мост socat, слушающий только внутренний адрес сети Docker. */
const RELAY = `${P.NAME_PREFIX}-proxy-relay`;
const XRAY = P.XRAY_HOST;
export async function syncRelay() {
  const p = P.externalAddr();
  let existing = null;
  try { existing = await docker.getContainer(RELAY).inspect(); } catch {}
  if (!p || !P.isLoopback(p.host)) {
    if (existing) await docker.getContainer(RELAY).remove({ force: true });
    return;
  }
  const spec = `${gateway}:${p.port}`;
  if (existing && existing.Config.Labels['mcpanel.spec'] === spec && existing.State.Running) return;
  if (existing) await docker.getContainer(RELAY).remove({ force: true });
  await ensureImage('alpine/socat:latest');
  const c = await docker.createContainer({
    name: RELAY, Image: 'alpine/socat:latest',
    Cmd: [`TCP-LISTEN:${p.port},bind=${gateway},fork,reuseaddr`, `TCP:127.0.0.1:${p.port}`],
    Labels: { mcpanel: 'relay', 'mcpanel.spec': spec },
    HostConfig: { NetworkMode: 'host', RestartPolicy: { Name: 'unless-stopped' } },
  });
  await c.start();
}

// Панель подключается к сети серверов, чтобы опрашивать их по имени контейнера.
export async function joinNetwork() {
  await ensureNetwork();
  try { await docker.getNetwork(NET).connect({ Container: os.hostname() }); }
  catch (e) { if (!/already exists|already connected/i.test(e.message)) console.error('joinNetwork', e.message); }
}

const vi = n => { const b = []; do { let t = n & 127; n >>>= 7; if (n) t |= 128; b.push(t); } while (n); return Buffer.from(b); };
function readVi(buf, o) {
  let r = 0, s = 0, i = o;
  for (;;) {
    if (i >= buf.length) return null;
    const b = buf[i++];
    r |= (b & 127) << s;
    if (!(b & 128)) return [r, i];
    s += 7;
    if (s > 35) return null;
  }
}
// Minecraft Server List Ping: число игроков без записей в логе сервера.
export function ping(host, port = 25565, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host, port });
    let buf = Buffer.alloc(0), done = false;
    const fin = (e, v) => { if (done) return; done = true; s.destroy(); e ? reject(e) : resolve(v); };
    s.setTimeout(timeout, () => fin(new Error('timeout')));
    s.on('error', fin);
    s.on('connect', () => {
      const h = Buffer.from(host), pb = Buffer.alloc(2);
      pb.writeUInt16BE(port);
      const data = Buffer.concat([vi(0), vi(765), vi(h.length), h, pb, vi(1)]);
      s.write(Buffer.concat([vi(data.length), data, Buffer.from([1, 0])]));
    });
    s.on('data', d => {
      buf = Buffer.concat([buf, d]);
      const l = readVi(buf, 0);
      if (!l || buf.length < l[1] + l[0]) return;
      const id = readVi(buf, l[1]);
      const sl = id && readVi(buf, id[1]);
      if (!sl || buf.length < sl[1] + sl[0]) return;
      try {
        const j = JSON.parse(buf.slice(sl[1], sl[1] + sl[0]).toString('utf8'));
        fin(null, { online: j.players?.online ?? 0, max: j.players?.max ?? 0, sample: (j.players?.sample || []).map(p => p.name) });
      } catch (e) { fin(e); }
    });
  });
}

export async function ensureImage(ref) {
  try { await docker.getImage(ref).inspect(); return; } catch {}
  await new Promise((res, rej) => docker.pull(ref, (err, stream) => {
    if (err) return rej(err);
    docker.modem.followProgress(stream, e => (e ? rej(e) : res()));
  }));
}

export function javaTag(cfg) {
  if (cfg.javaTag && cfg.javaTag !== 'auto') return cfg.javaTag;
  const v = cfg.version;
  if (!v || v === 'LATEST' || v === 'SNAPSHOT' || cfg.type === 'AUTO_CURSEFORGE') return 'latest';
  const m = /^1\.(\d+)(?:\.(\d+))?/.exec(v);
  if (!m) return 'latest';
  const minor = +m[1], patch = +(m[2] || 0);
  if (minor < 17) return 'java8';
  if (minor < 20 || (minor === 20 && patch < 5)) return 'java17';
  return 'latest';
}

export function parseExtra(str = '') {
  return String(str).split(/[\s,]+/).filter(Boolean).map(x => {
    const m = /^(\d{2,5})\/(tcp|udp)$/.exec(x);
    return m ? { port: m[1], proto: m[2] } : null;
  }).filter(Boolean);
}

const list = s => String(s || '').split(/[\s,]+/).filter(Boolean).join(',');

/* Описание сервера в списке игры: первая строка по умолчанию повторяет название, вторая - своя. */
export function motdOf(cfg) {
  const m = cfg.motd;
  const follow = m ? m.follow !== false : true;
  return {
    follow,
    l1: follow ? (cfg.nameFmt || M.escape(cfg.name || '')) : (m?.l1 || ''),
    l2: m ? (m.l2 || '') : (cfg.props?.MOTD || ''),
  };
}

/* Значок сервера в списке игры: server-icon.png 64x64 из логотипа панели. */
export const logoPath = id => path.join(DATA_DIR, 'covers', `${id}-logo.webp`);
export async function syncIcon(cfg) {
  const dst = path.join(serverDir(cfg.id), 'server-icon.png');
  try {
    if (fs.existsSync(logoPath(cfg.id))) {
      const png = await sharp(logoPath(cfg.id)).resize(64, 64, { fit: 'cover' }).png({ compressionLevel: 9 }).toBuffer();
      fs.mkdirSync(serverDir(cfg.id), { recursive: true });
      fs.writeFileSync(dst, png);
      try { fs.chownSync(dst, 1000, 1000); } catch {}
      if (!cfg.iconSynced) { cfg.iconSynced = true; store.save(); }
    } else if (cfg.iconSynced) {
      fs.rmSync(dst, { force: true });
      delete cfg.iconSynced;
      store.save();
    }
  } catch (e) { console.error('icon', e.message); }
}

export function buildEnv(cfg) {
  const s = store.get().settings;
  const e = {
    EULA: 'TRUE', TYPE: cfg.type, MEMORY: cfg.memory,
    ENABLE_RCON: 'true', RCON_PASSWORD: cfg.rconPassword,
    TZ: process.env.TZ || 'UTC', ENABLE_AUTOPAUSE: 'FALSE',
  };
  if (cfg.type === 'AUTO_CURSEFORGE') {
    if (cfg.cfSlug) e.CF_SLUG = cfg.cfSlug;
    if (cfg.cfFileId) e.CF_FILE_ID = cfg.cfFileId;
  } else {
    e.VERSION = cfg.version || 'LATEST';
  }
  if (cfg.loaderVersion) {
    const key = { FORGE: 'FORGE_VERSION', NEOFORGE: 'NEOFORGE_VERSION', FABRIC: 'FABRIC_LOADER_VERSION' }[cfg.type];
    if (key) e[key] = cfg.loaderVersion;
  }
  if (s.cfApiKey) e.CF_API_KEY = s.cfApiKey;
  Object.assign(e, P.proxyEnvFor(cfg, gateway));
  // В сети Docker нет IPv6: без этого Java сначала пробует IPv6-адрес серверов Mojang и входы игроков иногда падают
  // с ошибкой «Серверы аутентификации недоступны» («Network is unreachable» в журнале).
  e.JAVA_TOOL_OPTIONS = ['-Djava.net.preferIPv4Stack=true', e.JAVA_TOOL_OPTIONS].filter(Boolean).join(' ');
  if (list(cfg.cfMods)) e.CURSEFORGE_FILES = list(cfg.cfMods);
  if (list(cfg.modrinthMods)) e.MODRINTH_PROJECTS = list(cfg.modrinthMods);
  Object.assign(e, cfg.props || {});
  const mo = motdOf(cfg);
  const l1 = M.toSection(mo.l1), l2 = M.toSection(mo.l2);
  if (l1 || l2) e.MOTD = l2 ? l1 + '\n' + l2 : l1;
  Object.assign(e, cfg.customEnv || {});
  return Object.entries(e).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}=${v}`);
}

/** Порт на хосте для карты мира (Dynmap). Пустая строка, если карта выключена. */
export const mapPort = cfg => (cfg.map?.on && cfg.map.port ? String(cfg.map.port) : '');

/** Порты хоста, уже опубликованные любыми контейнерами Docker (для выбора свободного порта карты). */
export async function publishedPorts() {
  const list = await docker.listContainers({ all: true });
  return new Set(list.flatMap(c => (c.Ports || []).map(p => p.PublicPort)).filter(Boolean));
}

// Порт карты входит в отпечаток только когда карта включена: у серверов без карты отпечаток остаётся прежним,
// и после обновления панели они не помечаются как «требующие пересоздания».
export const specOf = cfg => sha(JSON.stringify({
  img: `${IMG}:${javaTag(cfg)}`, env: buildEnv(cfg), port: cfg.port, extra: parseExtra(cfg.extraPorts),
  ...(mapPort(cfg) ? { map: mapPort(cfg) } : {}),
}));

export async function inspect(id) {
  try { return await docker.getContainer(cname(id)).inspect(); }
  catch (e) { if (e.statusCode === 404) return null; throw e; }
}

export function stateOf(info) {
  if (!info) return 'missing';
  const s = info.State;
  if (s.Restarting) return 'starting';
  if (s.Running) return s.Health?.Status === 'starting' ? 'starting' : 'running';
  return 'stopped';
}

async function create(cfg) {
  await ensureNetwork();
  const image = `${IMG}:${javaTag(cfg)}`;
  await ensureImage(image);
  const dir = serverDir(cfg.id);
  fs.mkdirSync(dir, { recursive: true });
  try { fs.chownSync(dir, 1000, 1000); } catch {}
  const exposed = { '25565/tcp': {} };
  const bindings = { '25565/tcp': [{ HostPort: String(cfg.port) }] };
  for (const x of parseExtra(cfg.extraPorts)) {
    exposed[`${x.port}/${x.proto}`] = {};
    bindings[`${x.port}/${x.proto}`] = [{ HostPort: x.port }];
  }
  if (mapPort(cfg)) { // карта мира (Dynmap): веб-порт плагина 8123 внутри контейнера
    exposed['8123/tcp'] = {};
    bindings['8123/tcp'] = [{ HostPort: mapPort(cfg) }];
  }
  return docker.createContainer({
    name: cname(cfg.id), Image: image, Env: buildEnv(cfg),
    ExposedPorts: exposed,
    Labels: { mcpanel: 'true', 'mcpanel.id': cfg.id, 'mcpanel.spec': specOf(cfg) },
    StopTimeout: 90,
    HostConfig: {
      Binds: [`${dir}:/data`], PortBindings: bindings,
      RestartPolicy: { Name: 'unless-stopped' }, NetworkMode: NET,
    },
  });
}

export async function start(cfg) {
  await syncIcon(cfg);
  await syncProxy().catch(e => console.error('proxy', e.message));
  let info = await inspect(cfg.id);
  if (info && info.Config.Labels['mcpanel.spec'] !== specOf(cfg)) {
    await docker.getContainer(cname(cfg.id)).remove({ force: true });
    info = null;
  }
  if (!info) await create(cfg);
  const c = docker.getContainer(cname(cfg.id));
  if (!(await c.inspect()).State.Running) await c.start();
}

export async function stop(id) {
  const info = await inspect(id);
  if (info?.State.Running || info?.State.Restarting) await docker.getContainer(cname(id)).stop({ t: 90 });
}
export async function kill(id) {
  const info = await inspect(id);
  if (info?.State.Running) await docker.getContainer(cname(id)).kill();
}
export async function remove(id) {
  if (await inspect(id)) await docker.getContainer(cname(id)).remove({ force: true });
}

export async function exec(id, cmd) {
  const ex = await docker.getContainer(cname(id)).exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true });
  const st = await ex.start({});
  return new Promise(resolve => {
    let buf = '';
    const out = new PassThrough();
    out.on('data', d => (buf += d.toString('utf8')));
    docker.modem.demuxStream(st, out, out);
    const done = () => resolve(buf);
    st.on('end', done); st.on('error', done);
    setTimeout(done, 10000);
  });
}
export async function rcon(id, line) {
  const out = await exec(id, ['rcon-cli', ...String(line).trim().split(/\s+/)]);
  return out.replace(/\x1b\[[0-9;]*m/g, '').replace(/§./g, '').trim();
}

/* Нагрузка на процессор: сколько ядер занято сервером и какая это доля от всех ядер хоста (как на плитке
   «Процессор»). Считаем по приросту счётчика между опросами: так значение сглажено за ~10 секунд,
   а не прыгает по секундному срезу. */
const prevCpu = new Map();
export async function stats(id, track = false) {
  const s = await docker.getContainer(cname(id)).stats({ stream: false });
  const cpus = s.cpu_stats.online_cpus || s.cpu_stats.cpu_usage?.percpu_usage?.length || os.cpus().length || 1;
  const usage = s.cpu_stats.cpu_usage.total_usage;
  const t = Date.parse(s.read) || Date.now();
  const p = prevCpu.get(id);
  if (track) prevCpu.set(id, { usage, t });
  let cores;
  if (p && t - p.t >= 3000 && t - p.t < 120000 && usage >= p.usage) cores = (usage - p.usage) / ((t - p.t) * 1e6);
  else {
    const cpuD = usage - (s.precpu_stats?.cpu_usage?.total_usage || 0);
    const sysD = s.cpu_stats.system_cpu_usage - (s.precpu_stats?.system_cpu_usage || 0);
    cores = sysD > 0 && s.precpu_stats?.cpu_usage?.total_usage ? (cpuD / sysD) * cpus : 0;
  }
  cores = Math.max(0, Math.min(cores, cpus));
  const ms = s.memory_stats || {};
  const mem = (ms.usage || 0) - (ms.stats?.inactive_file ?? ms.stats?.cache ?? 0);
  return { cpu: Math.round((cores / cpus) * 1000) / 10, cores: Math.round(cores * 100) / 100, cpus, mem, memLimit: ms.limit || 0 };
}

/* Встроенный VLESS-клиент: отдельный контейнер xray с HTTP-входом только внутри сети Docker. */
const XRAY_DIR = path.join(DATA_DIR, 'xray');
export async function syncXray() {
  let existing = null;
  try { existing = await docker.getContainer(XRAY).inspect(); } catch {}
  const config = P.buildXrayConfig();
  if (!config) {
    if (existing) await docker.getContainer(XRAY).remove({ force: true });
    return;
  }
  const json = JSON.stringify(config, null, 2);
  const hash = sha(json);
  if (existing && existing.Config.Labels['mcpanel.spec'] === hash && existing.State.Running) return;
  if (existing) await docker.getContainer(XRAY).remove({ force: true });
  fs.mkdirSync(XRAY_DIR, { recursive: true });
  fs.writeFileSync(path.join(XRAY_DIR, 'config.json'), json, { mode: 0o600 });
  await ensureNetwork();
  await ensureImage('teddysun/xray:latest');
  const c = await docker.createContainer({
    name: XRAY, Image: 'teddysun/xray:latest',
    Cmd: ['xray', 'run', '-config', '/etc/xray/config.json'],
    Labels: { mcpanel: 'xray', 'mcpanel.spec': hash },
    HostConfig: { Binds: [`${XRAY_DIR}:/etc/xray:ro`], RestartPolicy: { Name: 'unless-stopped' }, NetworkMode: NET },
  });
  await c.start();
}

export async function syncProxy() {
  await syncRelay();
  await syncXray();
}

/** Проверка: открывается ли адрес через выбранный прокси и без него. */
export async function testProxy(nodeId, target = 'maven.neoforged.net', pathname = '/releases/net/neoforged/neoforge/maven-metadata.xml') {
  const ep = nodeId ? P.endpoints(nodeId, gateway) : null;
  const px = ep ? ep.http : null;
  const out = { via: px, proxy: null, direct: null };
  const t0 = Date.now();
  if (px) {
    const [ph, pp] = px.split(':');
    out.proxy = await new Promise(resolve => {
      const done = v => { clearTimeout(timer); resolve(v); };
      const timer = setTimeout(() => done({ ok: false, error: 'таймаут 15 с' }), 15000);
      const req = http.request({ host: ph, port: +pp, method: 'CONNECT', path: `${target}:443` });
      req.on('error', e => done({ ok: false, error: e.code || e.message }));
      req.on('connect', (res, socket) => {
        if (res.statusCode !== 200) { socket.destroy(); return done({ ok: false, error: `прокси ответил ${res.statusCode}` }); }
        const tls = tlsMod.connect({ socket, servername: target }, () => tls.write(`HEAD ${pathname} HTTP/1.1\r\nHost: ${target}\r\nConnection: close\r\nUser-Agent: horizoncraft\r\n\r\n`));
        let buf = '';
        tls.on('data', d => { buf += d; const m = /^HTTP\/1\.[01] (\d{3})/.exec(buf); if (m) { tls.destroy(); done({ ok: +m[1] < 500, status: +m[1], ms: Date.now() - t0 }); } });
        tls.on('error', e => done({ ok: false, error: e.code || e.message }));
      });
      req.end();
    });
  }
  const t1 = Date.now();
  try {
    const r = await fetch(`https://${target}${pathname}`, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
    out.direct = { ok: r.status < 500, status: r.status, ms: Date.now() - t1 };
  } catch (e) { out.direct = { ok: false, error: e.name === 'TimeoutError' || e.cause?.code === 'UND_ERR_CONNECT_TIMEOUT' ? 'таймаут' : (e.cause?.code || e.message) }; }
  return out;
}

export async function syncRouter() {
  if (process.env.NO_ROUTER) return;
  const withDomain = store.get().servers.filter(s => s.domain?.trim());
  let existing = null;
  try { existing = await docker.getContainer(ROUTER).inspect(); } catch {}
  if (!withDomain.length) {
    if (existing) await docker.getContainer(ROUTER).remove({ force: true });
    return;
  }
  const mapping = withDomain.flatMap(s =>
    s.domain.split(/[\s,]+/).filter(Boolean).map(d => `${d}=${cname(s.id)}:25565`)).join(',');
  const hash = sha(mapping);
  if (existing && existing.Config.Labels['mcpanel.spec'] === hash && existing.State.Running) return;
  if (existing) await docker.getContainer(ROUTER).remove({ force: true });
  await ensureNetwork();
  await ensureImage('itzg/mc-router:latest');
  const c = await docker.createContainer({
    name: ROUTER, Image: 'itzg/mc-router:latest', Env: [`MAPPING=${mapping}`],
    ExposedPorts: { '25565/tcp': {} },
    Labels: { mcpanel: 'router', 'mcpanel.spec': hash },
    HostConfig: {
      PortBindings: { '25565/tcp': [{ HostPort: '25565' }] },
      RestartPolicy: { Name: 'unless-stopped' }, NetworkMode: NET,
    },
  });
  await c.start();
}

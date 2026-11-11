import os from 'os';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as store from './store.js';
import * as dk from './dock.js';
import * as P from './proxy.js';

/* Режим TUN: весь исходящий трафик сервера Minecraft идёт через активный узел VLESS, программам ничего настраивать не нужно.
   Рядом с сервером, в его же сетевом пространстве, работает свой xray (контейнер-спутник), а правила перехвата
   заворачивают в него исходящие TCP-соединения. Локальные сети и сам xray исключены, входящие подключения игроков не меняются.
   UDP (например, DNS) идёт напрямую. После каждого запуска сервера сетевое пространство новое, поэтому панель
   проверяет спутник при каждом опросе и поднимает его заново. */

const XRAY_IMG = 'teddysun/xray:latest';
const TUN_DIR = path.join(dk.DATA_DIR, 'xray', 'tun');
const sideName = id => `${P.NAME_PREFIX}-tun-${id}`;
const sha = s => crypto.createHash('sha1').update(s).digest('hex');

/** Состояние по серверам: { ok, error, at }. */
export const state = new Map();
const known = new Set();     // серверы, у которых есть спутник
const busy = new Set();

const inspectSide = async id => { try { return await dk.docker.getContainer(sideName(id)).inspect(); } catch { return null; } };
const removeSide = async id => { try { await dk.docker.getContainer(sideName(id)).remove({ force: true }); } catch {} known.delete(id); };

/** Одноразовый контейнер из образа панели в сетевом пространстве сервера: ставит или снимает правила перехвата. */
async function firewall(id, on) {
  let self;
  try { self = await dk.docker.getContainer(os.hostname()).inspect(); }
  catch { throw new Error('Режим TUN работает только в установке через Docker: панель не нашла свой контейнер'); }
  const c = await dk.docker.createContainer({
    Image: self.Image, Entrypoint: ['sh', '-c'], Cmd: [P.tunScript(on)], User: '0',
    Labels: { mcpanel: 'tunfw' },
    HostConfig: { NetworkMode: `container:${dk.cname(id)}`, CapAdd: ['NET_ADMIN'] },
  });
  try {
    await c.start();
    const r = await c.wait();
    if (r.StatusCode !== 0) {
      const log = String(await c.logs({ stdout: true, stderr: true }).catch(() => '')).replace(/[^\x20-\x7e\n]/g, '').trim().split('\n').slice(-3).join(' | ');
      throw new Error('Не удалось настроить перехват трафика (нужны nftables или iptables в ядре): ' + log.slice(0, 300));
    }
  } finally { await c.remove({ force: true }).catch(() => {}); }
}

/** Приводит спутник сервера в нужное состояние. info: результат inspect сервера (если уже есть). */
export async function sync(cfg, info) {
  const id = cfg.id;
  const want0 = P.tunWanted(cfg);
  if (!want0 && !known.has(id)) { state.delete(id); return; }
  if (busy.has(id)) return;
  busy.add(id);
  try {
    if (info === undefined) info = await dk.inspect(id);
    const running = !!info?.State.Running;
    const side = await inspectSide(id);
    if (!(running && want0)) {
      if (side) { await removeSide(id); if (running) await firewall(id, false).catch(() => {}); }
      known.delete(id); state.delete(id);
      return;
    }
    const json = JSON.stringify(P.buildTunConfig(dk.getGateway()), null, 2);
    const stamp = sha(info.State.StartedAt + json);
    if (side && side.Config.Labels?.['mcpanel.spec'] === stamp && side.State.Running) {
      known.add(id);
      if (!state.get(id)?.ok) state.set(id, { ok: true, at: Date.now() });
      return;
    }
    if (side) await removeSide(id);
    try {
      fs.mkdirSync(TUN_DIR, { recursive: true });
      const file = path.join(TUN_DIR, 'config.json');
      fs.writeFileSync(file, json, { mode: 0o600 });
      try { fs.chownSync(file, P.TUN_UID, P.TUN_UID); } catch {}
      await dk.ensureImage(XRAY_IMG);
      await firewall(id, true);
      const c = await dk.docker.createContainer({
        name: sideName(id), Image: XRAY_IMG, Cmd: ['xray', 'run', '-config', '/etc/xray/config.json'],
        User: `${P.TUN_UID}:${P.TUN_UID}`,
        Labels: { mcpanel: 'tun', 'mcpanel.id': id, 'mcpanel.spec': stamp },
        HostConfig: { Binds: [`${TUN_DIR}:/etc/xray:ro`], NetworkMode: `container:${dk.cname(id)}` },
      });
      known.add(id);
      await c.start();
      state.set(id, { ok: true, at: Date.now() });
    } catch (e) {
      // без спутника перехваченные соединения некуда отправлять: снимаем правила, сервер продолжит работать напрямую
      await removeSide(id);
      await firewall(id, false).catch(() => {});
      state.set(id, { ok: false, error: e.message, at: Date.now() });
      console.error('tun', id, e.message);
    }
  } finally { busy.delete(id); }
}

/** Проходит по всем серверам и убирает спутники удалённых серверов. Вызывается при запуске панели и смене узла или режима. */
export async function syncAll() {
  const servers = store.get().servers;
  let list = [];
  try { list = await dk.docker.listContainers({ all: true, filters: { label: ['mcpanel=tun'] } }); } catch {}
  for (const c of list) {
    if (!(c.Names || []).some(n => n.startsWith(`/${P.NAME_PREFIX}-tun-`))) continue;   // спутники другой панели на этом хосте не трогаем
    const id = c.Labels?.['mcpanel.id'];
    if (servers.some(s => s.id === id)) known.add(id);
    else await dk.docker.getContainer(c.Id).remove({ force: true }).catch(() => {});
  }
  for (const cfg of servers) await sync(cfg).catch(e => console.error('tun', e.message));
}

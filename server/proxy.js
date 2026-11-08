import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import * as store from './store.js';
import { vlessOutbound } from './vless.js';

/* Узлы прокси: ссылки VLESS из подписки 3x-ui или добавленные вручную, плюс один внешний прокси.
   Здесь только чистая логика без Docker, поэтому модуль безопасно импортируется откуда угодно. */
export const NAME_PREFIX = process.env.NAME_PREFIX || 'mcpanel';
export const XRAY_HOST = `${NAME_PREFIX}-xray`;
export const BASE_PORT = 10810;
export const SOCKS_OFFSET = 1000;
const MAX_NODES = 80;

const st = () => store.get().settings;
export const nodeIdOf = link => crypto.createHash('sha1').update(String(link).trim()).digest('hex').slice(0, 8);
export const nodes = () => st().proxyNodes || [];
export const isLoopback = h => /^(127\.|localhost$|0\.0\.0\.0$)/.test(h);

export function externalAddr() {
  const m = /^([A-Za-z0-9.-]+):(\d{2,5})$/.exec(st().downloadProxy || '');
  return m ? { host: m[1], port: m[2] } : null;
}
export const nodeExists = id => (id === 'external' ? !!externalAddr() : nodes().some(n => n.id === id));

/** Сохраняет список узлов и закрепляет за каждым постоянный порт внутри сети Docker. */
export function setNodes(list) {
  const s = st();
  const seen = new Set();
  s.proxyNodes = list.filter(n => !seen.has(n.id) && seen.add(n.id)).slice(0, MAX_NODES);
  const old = s.proxyPorts || {}, ports = {};
  for (const n of s.proxyNodes) if (old[n.id]) ports[n.id] = old[n.id];
  const used = new Set(Object.values(ports));
  for (const n of s.proxyNodes) {
    if (ports[n.id]) continue;
    let p = BASE_PORT;
    while (used.has(p)) p++;
    ports[n.id] = p; used.add(p);
  }
  s.proxyPorts = ports;
}

/** Адреса, по которым контейнеры достучатся до узла. */
export function endpoints(id, gateway) {
  if (id === 'external') {
    const e = externalAddr();
    if (!e) return null;
    const host = isLoopback(e.host) ? gateway : e.host;
    return { http: `${host}:${e.port}`, socksHost: host, socksPort: +e.port };
  }
  const port = st().proxyPorts?.[id];
  if (!port || !nodes().some(n => n.id === id)) return null;
  return { http: `${XRAY_HOST}:${port}`, socksHost: XRAY_HOST, socksPort: port + SOCKS_OFFSET };
}

/** Установлен ли загрузчик (Forge, NeoForge, Fabric). Готовый серверный jar появляется в самом конце установки. */
export function needsInstall(cfg) {
  const d = path.join(process.env.DATA_DIR || '/data', 'servers', cfg.id);
  const has = p => fs.existsSync(path.join(d, p));
  const serverJarIn = rel => {
    try {
      for (const v of fs.readdirSync(path.join(d, rel))) {
        const vd = path.join(d, rel, v);
        if (fs.statSync(vd).isDirectory() && fs.readdirSync(vd).some(f => /-server\.jar$/.test(f))) return true;
      }
    } catch {}
    return false;
  };
  try {
    if (cfg.type === 'NEOFORGE') return !serverJarIn('libraries/net/neoforged/neoforge');
    if (cfg.type === 'FORGE') return !(serverJarIn('libraries/net/minecraftforge/forge') || fs.readdirSync(d).some(f => /^forge-.*\.jar$/.test(f)));
    if (cfg.type === 'FABRIC') return !(has('fabric-server-launch.jar') || has('.fabric'));
  } catch {}
  return false;
}

/** Переменные окружения контейнера Minecraft для выбранного сервером узла.
    PROXY охватывает загрузки самой оболочки образа. Установщик Forge и NeoForge запускается отдельным
    процессом Java и берёт прокси только из системных свойств, поэтому ему они передаются через JAVA_TOOL_OPTIONS. */
export function proxyEnvFor(cfg, gateway) {
  const p = cfg.proxy;
  if (!p?.on) return {};
  const ep = endpoints(p.node, gateway);
  if (!ep) return {};
  const e = { PROXY: ep.http };
  if (p.scope === 'all') {
    e.JAVA_TOOL_OPTIONS = `-DsocksProxyHost=${ep.socksHost} -DsocksProxyPort=${ep.socksPort}`;
  } else if (needsInstall(cfg)) {
    const [h, port] = ep.http.split(':');
    e.JAVA_TOOL_OPTIONS = `-Dhttp.proxyHost=${h} -Dhttp.proxyPort=${port} -Dhttps.proxyHost=${h} -Dhttps.proxyPort=${port}`;
  }
  return e;
}

/** Конфиг xray: для каждого узла свой HTTP- и SOCKS-вход, привязанный к своему выходу. */
export function buildXrayConfig() {
  const ports = st().proxyPorts || {};
  const inbounds = [], outbounds = [], rules = [];
  for (const n of nodes()) {
    const p = ports[n.id];
    if (!p) continue;
    let ob;
    try { ob = vlessOutbound(n.link, `out-${n.id}`).outbound; } catch { continue; }
    inbounds.push({ tag: `http-${n.id}`, listen: '0.0.0.0', port: p, protocol: 'http', settings: { allowTransparent: false } });
    inbounds.push({ tag: `socks-${n.id}`, listen: '0.0.0.0', port: p + SOCKS_OFFSET, protocol: 'socks', settings: { auth: 'noauth', udp: false } });
    outbounds.push(ob);
    rules.push({ type: 'field', inboundTag: [`http-${n.id}`, `socks-${n.id}`], outboundTag: `out-${n.id}` });
  }
  if (!inbounds.length) return null;
  outbounds.push({ tag: 'direct', protocol: 'freedom' });
  return { log: { loglevel: 'warning' }, inbounds, outbounds, routing: { domainStrategy: 'AsIs', rules } };
}

/* ---------- подписка 3x-ui ---------- */
export async function fetchSubscription(url) {
  let u;
  try { u = new URL(String(url).trim()); } catch { throw new Error('Неверный адрес подписки'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Адрес подписки должен начинаться с http:// или https://');
  let r;
  try {
    r = await fetch(u, { headers: { 'User-Agent': 'v2rayN/6.0', Accept: '*/*' }, signal: AbortSignal.timeout(20000), redirect: 'follow' });
  } catch (e) {
    const why = e.name === 'TimeoutError' ? 'таймаут' : (e.cause?.code || e.message);
    throw new Error(`Не удалось открыть подписку (${why}). Если адрес недоступен с сервера, вставьте содержимое подписки вручную.`);
  }
  if (!r.ok) throw new Error(`Сервер подписки ответил ${r.status}`);
  const text = await r.text();
  if (text.length > 1e6) throw new Error('Ответ подписки слишком большой');
  return text;
}

/** Разбирает содержимое подписки (обычный текст или base64) на узлы VLESS. */
export function parseSubscription(content) {
  let t = String(content || '').trim();
  if (!/:\/\//.test(t.slice(0, 300))) {
    try { t = Buffer.from(t.replace(/\s+/g, ''), 'base64').toString('utf8'); } catch {}
  }
  const lines = t.split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(0, 300);
  const ok = [], skipped = [];
  for (const l of lines) {
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(l)) continue;
    const proto = l.split('://')[0].toLowerCase();
    if (proto !== 'vless') { skipped.push({ name: proto + '://…', reason: 'протокол не поддерживается' }); continue; }
    try {
      const { summary } = vlessOutbound(l);
      ok.push({ id: nodeIdOf(l), name: summary.name || summary.host, link: l, source: 'sub', summary });
    } catch (e) {
      let name = 'vless';
      try { name = decodeURIComponent(l.split('#')[1] || '') || name; } catch {}
      skipped.push({ name: name.slice(0, 60), reason: e.message });
    }
  }
  return { nodes: ok, skipped };
}

export function applySubscription(url, parsed) {
  const s = st();
  const oldSub = nodes().filter(n => n.source === 'sub').map(n => n.id);
  const manual = nodes().filter(n => n.source === 'manual');
  setNodes([...parsed.nodes, ...manual]);
  const now = new Set(nodes().map(n => n.id));
  for (const id of oldSub) if (!now.has(id)) dropFromServers(id);
  s.subscription = { url: url || s.subscription?.url || '', updatedAt: Date.now(), count: parsed.nodes.length, skipped: parsed.skipped.slice(0, 20) };
  store.save();
}

export function addManual(link, name) {
  const { summary } = vlessOutbound(link);
  const id = nodeIdOf(link);
  setNodes([...nodes().filter(n => n.id !== id), { id, name: (name || '').trim().slice(0, 60) || summary.name || summary.host, link: String(link).trim(), source: 'manual', summary }]);
  store.save();
  return id;
}

export function removeNode(id) {
  const n = nodes().find(x => x.id === id);
  if (!n) throw new Error('Узел не найден');
  if (n.source !== 'manual') throw new Error('Узлы подписки удаляются вместе с подпиской');
  setNodes(nodes().filter(x => x.id !== id));
  dropFromServers(id);
  store.save();
}

export function clearSubscription() {
  const s = st();
  const gone = nodes().filter(n => n.source === 'sub').map(n => n.id);
  setNodes(nodes().filter(n => n.source !== 'sub'));
  delete s.subscription;
  for (const id of gone) dropFromServers(id);
  store.save();
}

/** Серверы, которые использовали пропавший узел, отключаются от прокси. */
export function dropFromServers(id) {
  if (st().panelProxy?.node === id) st().panelProxy = { on: false, node: '' };
  for (const cfg of store.get().servers) {
    if (cfg.proxy?.node === id) cfg.proxy = { ...cfg.proxy, on: false, node: '' };
    if (cfg.discord?.proxy?.node === id) cfg.discord.proxy = { on: false, node: '' };
  }
}

/** Публичное описание без секретов. */
export function publicNodes() {
  return nodes().map(n => ({ id: n.id, name: n.name, source: n.source, host: n.summary.host, port: n.summary.port, network: n.summary.network, security: n.summary.security }));
}
export function publicSubscription() {
  const s = st().subscription;
  if (!s) return null;
  let host = '';
  try { host = new URL(s.url).host; } catch {}
  return { host, updatedAt: s.updatedAt, count: s.count, skipped: s.skipped || [] };
}

/** Переносит прежние глобальные настройки прокси на отдельные серверы. */
export function migrate() {
  const s = st();
  let changed = false;
  if (s.vlessLink) {
    try {
      const id = addManual(s.vlessLink, 'Моя ссылка');
      if (s.proxyMode === 'vless') {
        for (const cfg of store.get().servers) if (!cfg.proxy) cfg.proxy = { on: true, node: id, scope: 'install' };
      }
    } catch {}
    delete s.vlessLink; changed = true;
  }
  if (s.proxyMode === 'external' && externalAddr()) {
    for (const cfg of store.get().servers) if (!cfg.proxy) cfg.proxy = { on: true, node: 'external', scope: 'install' };
  }
  if ('proxyMode' in s) { delete s.proxyMode; changed = true; }
  if (changed) store.save();
}

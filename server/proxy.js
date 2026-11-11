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
/* Активный узел: выбирается один раз в настройках. Всё, что включено «через VLESS», ходит через его постоянные входы. */
export const ACTIVE_HTTP = 10809, ACTIVE_SOCKS = 11809;
export const TUN_PORT = 12345, TUN_UID = 23333;
export const MODES = ['proxy', 'tun'];

const st = () => store.get().settings;
export const nodeIdOf = link => crypto.createHash('sha1').update(String(link).trim()).digest('hex').slice(0, 8);
export const nodes = () => st().proxyNodes || [];
export const isLoopback = h => /^(127\.|localhost$|0\.0\.0\.0$)/.test(h);

export function externalAddr() {
  const m = /^([A-Za-z0-9.-]+):(\d{2,5})$/.exec(st().downloadProxy || '');
  return m ? { host: m[1], port: m[2] } : null;
}
export const nodeExists = id => (id === 'external' ? !!externalAddr() : nodes().some(n => n.id === id));

/** Выбранный в настройках узел и режим: proxy (программам выдаётся адрес прокси) или tun (весь исходящий трафик сервера). */
export function active() {
  const v = st().vless || {};
  const node = v.node && nodeExists(v.node) ? v.node : '';
  return { node, mode: v.mode === 'tun' ? 'tun' : 'proxy' };
}
export function activeName() {
  const { node } = active();
  if (!node) return '';
  if (node === 'external') return 'Свой прокси ' + (st().downloadProxy || '');
  return nodes().find(n => n.id === node)?.name || '';
}
export function setActive(node, mode) {
  const s = st(), cur = active();
  const n = node === undefined ? cur.node : String(node || '');
  if (n && !nodeExists(n)) throw new Error('Узел не найден');
  const m = mode === undefined ? cur.mode : String(mode);
  if (!MODES.includes(m)) throw new Error('Режим: proxy или tun');
  s.vless = { node: n, mode: m };
}
/** Адрес постоянных входов активного узла или null, если узел не выбран. Свой прокси используется напрямую, без xray. */
export function activeEndpoint(gateway) {
  const { node } = active();
  if (!node) return null;
  if (node === 'external') return endpoints('external', gateway);
  return { http: `${XRAY_HOST}:${ACTIVE_HTTP}`, socksHost: XRAY_HOST, socksPort: ACTIVE_SOCKS };
}
/** Нужен ли серверу прозрачный перехват всего трафика. */
export const tunWanted = cfg => !!cfg.proxy?.on && modeOf(cfg) === 'tun' && !!active().node;
/** Режим сервера: свой (выбран переключателем на странице сервера) или общий из Настроек. */
export const modeOf = cfg => (MODES.includes(cfg?.proxy?.mode) ? cfg.proxy.mode : active().mode);

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

/** Переменные окружения контейнера Minecraft. Адрес прокси получают оболочка образа и установщики (Forge и NeoForge
    запускаются отдельным процессом Java и берут прокси только из системных свойств). Адрес не зависит от выбранного узла
    и режима, поэтому смена узла или режима не требует пересоздавать сервер. В режиме tun остальной трафик заворачивается прозрачно. */
export function proxyEnvFor(cfg, gateway) {
  if (!cfg.proxy?.on) return {};
  const ep = activeEndpoint(gateway);
  if (!ep) return {};
  const e = { PROXY: ep.http };
  if (needsInstall(cfg)) {
    const [h, port] = ep.http.split(':');
    e.JAVA_TOOL_OPTIONS = `-Dhttp.proxyHost=${h} -Dhttp.proxyPort=${port} -Dhttps.proxyHost=${h} -Dhttps.proxyPort=${port}`;
  }
  return e;
}

/** Исходящее подключение xray для узла: VLESS или свой прокси (SOCKS5). */
export function outboundFor(id, tag, gateway) {
  if (id === 'external') {
    const e = externalAddr();
    if (!e) return null;
    return { tag, protocol: 'socks', settings: { servers: [{ address: isLoopback(e.host) ? gateway : e.host, port: +e.port }] } };
  }
  const n = nodes().find(x => x.id === id);
  if (!n) return null;
  try { return vlessOutbound(n.link, tag).outbound; } catch { return null; }
}

/** Конфиг xray: постоянные входы активного узла и по паре входов на каждый узел (для проверки узлов из панели). */
export function buildXrayConfig(gateway) {
  const ports = st().proxyPorts || {};
  const inbounds = [], outbounds = [], rules = [];
  const add = (key, http, ob) => {
    inbounds.push({ tag: `http-${key}`, listen: '0.0.0.0', port: http, protocol: 'http', settings: { allowTransparent: false } });
    inbounds.push({ tag: `socks-${key}`, listen: '0.0.0.0', port: http + SOCKS_OFFSET, protocol: 'socks', settings: { auth: 'noauth', udp: false } });
    outbounds.push(ob);
    rules.push({ type: 'field', inboundTag: [`http-${key}`, `socks-${key}`], outboundTag: ob.tag });
  };
  // свой прокси панель и серверы используют напрямую, постоянный вход xray нужен только узлам VLESS
  const act = active().node, actOb = act && act !== 'external' && outboundFor(act, 'out-active', gateway);
  if (actOb) add('active', ACTIVE_HTTP, actOb);
  for (const n of nodes()) {
    const p = ports[n.id], ob = p && outboundFor(n.id, `out-${n.id}`, gateway);
    if (ob) add(n.id, p, ob);
  }
  if (!inbounds.length) return null;
  outbounds.push({ tag: 'direct', protocol: 'freedom' });
  return { log: { loglevel: 'warning' }, inbounds, outbounds, routing: { domainStrategy: 'AsIs', rules } };
}

/** Конфиг xray для режима tun: принимает перехваченные соединения сервера и отправляет их через активный узел. */
export function buildTunConfig(gateway) {
  const ob = active().node && outboundFor(active().node, 'out-active', gateway);
  if (!ob) return null;
  return {
    log: { loglevel: 'warning' },
    inbounds: [{ tag: 'tun-in', listen: '127.0.0.1', port: TUN_PORT, protocol: 'dokodemo-door', settings: { network: 'tcp', followRedirect: true },
      sniffing: { enabled: true, destOverride: ['http', 'tls'] } }],
    outbounds: [ob],
  };
}

/** Правила перехвата внутри сетевого пространства сервера: весь исходящий TCP, кроме локальных сетей и самого xray, уходит на вход tun.
    Сначала nftables, при неудаче iptables. Скрипт выполняет одноразовый контейнер с правом NET_ADMIN. */
export function tunScript(on) {
  const nets = ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16', '224.0.0.0/4'];
  const off = 'nft delete table ip hc_tun 2>/dev/null; iptables -t nat -D OUTPUT -j HC_TUN 2>/dev/null; iptables -t nat -F HC_TUN 2>/dev/null; iptables -t nat -X HC_TUN 2>/dev/null; ';
  if (!on) return off + 'exit 0';
  const nft = `table ip hc_tun { chain out { type nat hook output priority -100; meta skuid ${TUN_UID} return; ip daddr { ${nets.join(', ')} } return; meta l4proto tcp redirect to :${TUN_PORT}; }; }`;
  const ipt = [`iptables -t nat -N HC_TUN`, `iptables -t nat -A HC_TUN -m owner --uid-owner ${TUN_UID} -j RETURN`,
    ...nets.map(n => `iptables -t nat -A HC_TUN -d ${n} -j RETURN`), `iptables -t nat -A HC_TUN -p tcp -j REDIRECT --to-ports ${TUN_PORT}`, `iptables -t nat -A OUTPUT -j HC_TUN`].join(' && ');
  return `${off}if echo '${nft}' | nft -f - ; then echo nft-ok; exit 0; fi; ${ipt} && echo ipt-ok`;
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

/** Пропавший узел перестаёт быть активным. Переключатели «через VLESS» остаются и заработают, когда узел выберут снова. */
export function dropFromServers(id) {
  if (st().vless?.node === id) st().vless = { ...st().vless, node: '' };
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
  // Один активный узел вместо выбора узла в каждом месте: берём тот, которым уже пользовались
  if (!s.vless) {
    const srv = store.get().servers;
    const used = [...srv.filter(c => c.proxy?.on).map(c => c.proxy.node), s.panelProxy?.on && s.panelProxy.node,
      ...srv.filter(c => c.discord?.proxy?.on).map(c => c.discord.proxy.node), ...srv.map(c => c.proxy?.node), nodes()[0]?.id];
    s.vless = { node: used.find(id => id && nodeExists(id)) || '', mode: srv.some(c => c.proxy?.on && c.proxy.scope === 'all') ? 'tun' : 'proxy' };
    for (const c of srv) {
      if (c.proxy) c.proxy = { on: !!c.proxy.on };
      if (c.discord?.proxy) c.discord.proxy = { on: !!c.discord.proxy.on };
    }
    if (s.panelProxy) s.panelProxy = { on: !!s.panelProxy.on };
    changed = true;
  }
  if (changed) store.save();
}

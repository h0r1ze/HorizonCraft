import * as store from './store.js';
import * as dk from './dock.js';
import * as sv from './services.js';
import * as P from './proxy.js';
import { proxyFetch, endpointOf } from './net.js';

/* Табло сервера в Discord. Панель один раз отправляет сообщение через вебхук канала и дальше сама его правит:
   статус, игроки, версия, аптайм, память. Бот не нужен. Отдельными сообщениями по желанию приходят события
   (запуск, остановка, вход и выход игроков). Адрес вебхука секретный, наружу из панели не отдаётся. */

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });

const HOOK_RE = /^https:\/\/(?:(?:ptb|canary)\.)?(?:discord|discordapp)\.com\/api(?:\/v\d+)?\/webhooks\/(\d{15,25})\/([\w-]{20,120})\/?(?:\?.*)?$/;
export const INTERVALS = [30, 60, 120, 300];
const MIN_GAP = 15e3;            // не чаще, чем раз в 15 секунд даже при частых изменениях
const TICK = 10e3;

/** Приводит адрес вебхука к каноническому виду или возвращает null. */
export function parseHook(url) {
  const m = HOOK_RE.exec(String(url || '').trim());
  if (!m) return null;
  const path = `/api/webhooks/${m[1]}/${m[2]}`;
  // DISCORD_TEST_BASE нужна только автотестам: подменяет хост запросов, а в настройках остаётся настоящий адрес
  return { id: m[1], token: m[2], url: 'https://discord.com' + path, base: (process.env.DISCORD_TEST_BASE || 'https://discord.com') + path };
}

/* Состояние в памяти: когда и что отправляли, ошибки, прошлый статус для событий. */
const mem = new Map();
const M = id => { let m = mem.get(id); if (!m) { m = { busy: false }; mem.set(id, m); } return m; };

const TYPE_NAME = { VANILLA: 'Vanilla', PAPER: 'Paper', PURPUR: 'Purpur', FABRIC: 'Fabric', FORGE: 'Forge', NEOFORGE: 'NeoForge', AUTO_CURSEFORGE: 'CurseForge' };
/* Тексты сообщений на двух языках. Язык выбирается для каждого сервера (по умолчанию язык панели при подключении). */
const STR = {
  ru: {
    server: 'Сервер', status: 'Статус', players: 'Игроки', version: 'Версия', address: 'Адрес', uptime: 'Аптайм', memory: 'Память', playing: 'Сейчас играют',
    online: '🟢 Онлайн', starting: '🟡 Запускается', offline: '🔴 Выключен', of: 'из', gb: 'ГБ', more: n => ` и ещё ${n}`, dur: ['д', 'ч', 'мин'],
    every: s => (s === 30 ? 'каждые 30 секунд' : s === 60 ? 'каждую минуту' : `каждые ${s / 60} ${s / 60 < 5 ? 'минуты' : 'минут'}`), updates: 'обновляется',
    started: '🟢 **Сервер запущен**', stopped: '🔴 **Сервер остановлен**', crashed: code => `💥 **Сервер остановился с ошибкой** (код ${code})`,
    joined: n => `➕ Зашёл${n > 1 ? 'и' : ''}: `, left: n => `➖ Вышел${n > 1 ? 'и' : ''}: `,
  },
  en: {
    server: 'Server', status: 'Status', players: 'Players', version: 'Version', address: 'Address', uptime: 'Uptime', memory: 'Memory', playing: 'Playing now',
    online: '🟢 Online', starting: '🟡 Starting', offline: '🔴 Offline', of: 'of', gb: 'GB', more: n => ` and ${n} more`, dur: ['d', 'h', 'min'],
    every: s => (s === 30 ? 'every 30 seconds' : s === 60 ? 'every minute' : `every ${s / 60} minutes`), updates: 'updates',
    started: '🟢 **Server started**', stopped: '🔴 **Server stopped**', crashed: code => `💥 **Server stopped with an error** (code ${code})`,
    joined: n => `➕ Joined: `, left: n => `➖ Left: `,
  },
};
export const LANGS = ['ru', 'en'];
/** События по отдельности: запуск, остановка, падение, вход и выход игроков. Прежняя настройка «state» означала остановку и падение, без запуска. */
export function eventsOf(d) {
  const e = d?.events || {}, legacy = 'state' in e && !('started' in e || 'stopped' in e || 'crashed' in e);
  return { started: legacy ? false : !!e.started, stopped: legacy ? !!e.state : !!e.stopped, crashed: legacy ? !!e.state : !!e.crashed, join: !!e.join };
}
const STATE_GAP = 10 * 60e3;   // одно и то же событие состояния не чаще, чем раз в 10 минут (защита от перезапусков по кругу)
const sOf = cfg => STR[cfg.discord?.lang === 'en' ? 'en' : 'ru'];
const fmtDur = (ms, U) => {
  const m = Math.max(0, Math.floor(ms / 60e3)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return d ? `${d} ${U[0]} ${h} ${U[1]}` : h ? `${h} ${U[1]} ${m % 60} ${U[2]}` : `${m} ${U[2]}`;
};
const fmtGb = b => (b / 1024 ** 3).toFixed(1).replace(/\.0$/, '');
const clean = s => String(s ?? '').replace(/[`\r\n]/g, '').slice(0, 40);

/** Что показывать игрокам в поле «Адрес»: заданный вручную, домен сервера или публичный адрес машины с портом. */
export function addressOf(cfg) {
  const d = cfg.discord || {};
  if (d.address) return d.address;
  if (cfg.domain) return cfg.domain;
  const host = store.get().settings.publicHost;
  return host ? `${host}:${cfg.port}` : '';
}

/** Сообщение-табло. state: running | starting | stopped | missing. */
export function boardEmbed(cfg, state, info, L = {}) {
  const d = cfg.discord || {}, X = sOf(cfg);
  const up = state === 'running', booting = state === 'starting';
  const title = (String(cfg.name || X.server).replace(/§./g, '') || X.server).slice(0, 250);
  const fields = [{ name: X.status, value: up ? X.online : booting ? X.starting : X.offline, inline: true }];
  if (up) fields.push({ name: X.players, value: L.max != null ? `**${L.count}** ${X.of} ${L.max}` : '—', inline: true });
  fields.push({ name: X.version, value: `${TYPE_NAME[cfg.type] || cfg.type} ${cfg.version && cfg.version !== 'LATEST' ? cfg.version : ''}`.trim(), inline: true });
  const addr = addressOf(cfg);
  if (addr) fields.push({ name: X.address, value: '`' + clean(addr) + '`', inline: true });
  if (up && info?.State?.StartedAt) fields.push({ name: X.uptime, value: fmtDur(Date.now() - Date.parse(info.State.StartedAt), X.dur), inline: true });
  if (up && L.mem && L.memLimit) fields.push({ name: X.memory, value: `${fmtGb(L.mem)} ${X.of} ${fmtGb(L.memLimit)} ${X.gb}`, inline: true });
  if (up && L.count > 0) {
    const names = (L.online || []).filter(Boolean);
    const shown = names.slice(0, 30).map(n => '`' + clean(n) + '`').join(', ');
    const more = Math.max(L.count, names.length) - Math.min(names.length, 30);
    fields.push({ name: X.playing, value: ((shown || '—') + (more > 0 && shown ? X.more(more) : '')).slice(0, 1000) });
  }
  return {
    title, color: up ? 0x2ecc71 : booting ? 0xf1c40f : 0xe74c3c, fields,
    footer: { text: `HorizonCraft · ${X.updates} ${X.every(d.interval || 60)}` }, timestamp: new Date().toISOString(),
  };
}

/** Короткое событие отдельным сообщением. */
const eventEmbed = (cfg, text, color) => ({ title: String(cfg.name || sOf(cfg).server).slice(0, 250), description: text.slice(0, 2000), color, timestamp: new Date().toISOString() });

/* ---------- обращение к Discord ---------- */
async function call(cfg, hook, method, suffix, body) {
  const r = await proxyFetch(endpointOf(cfg.discord?.proxy), hook.base + suffix, {
    method, signal: AbortSignal.timeout(12000),
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify({ ...body, allowed_mentions: { parse: [] } }) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch {}
  return { status: r.status, json };
}

/** Название выбранного узла прокси для сообщений пользователю. */
export function proxyName(p) {
  if (!p?.on) return '';
  if (p.node === 'external') return P.externalAddr() ? `${P.externalAddr().host}:${P.externalAddr().port}` : '';
  return P.nodes().find(n => n.id === p.node)?.name || '';
}
const NET_ERR = cfg => {
  const p = cfg.discord?.proxy, name = proxyName(p);
  return endpointOf(p)
    ? `Нет связи с Discord даже через прокси «${name}». Проверьте узел в разделе «Прокси» (Настройки) или выберите другой.`
    : 'Нет связи с Discord. Если он заблокирован у вашего провайдера, включите ниже «Отправлять через прокси» и выберите узел.';
};

/** Разбор ответа: запоминает ошибку и паузу перед следующей попыткой. true, если сообщение принято. */
function judge(m, r) {
  if (r.status >= 200 && r.status < 300) { m.error = ''; m.failures = 0; m.retryAt = 0; return true; }
  m.failures = (m.failures || 0) + 1;
  if (r.status === 429) {
    const wait = Math.min(120, Math.max(1, Number(r.json?.retry_after) || 5));
    m.retryAt = Date.now() + wait * 1000; m.error = `Discord просит подождать ${Math.ceil(wait)} с`;
  } else if (r.status === 401 || r.status === 403 || (r.status === 404 && r.json?.code === 10015)) {
    m.retryAt = Date.now() + 5 * 60e3; m.error = 'Discord не принимает этот вебхук: он удалён или адрес неверный. Создайте новый и вставьте его заново.';
  } else {
    m.retryAt = Date.now() + Math.min(300, 30 * m.failures) * 1000; m.error = `Discord ответил ошибкой ${r.status}`;
  }
  return false;
}

async function post(cfg, hook, embed) {
  const m = M(cfg.id);
  let r;
  try { r = await call(cfg, hook, 'POST', '?wait=true', { embeds: [embed] }); }
  catch { m.failures = (m.failures || 0) + 1; m.retryAt = Date.now() + Math.min(300, 30 * m.failures) * 1000; m.error = NET_ERR(cfg); return null; }
  return judge(m, r) ? r.json : null;
}

/** Обновляет табло: правит прежнее сообщение, а если его удалили, отправляет новое. */
async function sendBoard(cfg, hook, embed) {
  const m = M(cfg.id), d = cfg.discord;
  if (d.messageId) {
    let r;
    try { r = await call(cfg, hook, 'PATCH', `/messages/${d.messageId}`, { embeds: [embed] }); }
    catch { m.failures = (m.failures || 0) + 1; m.retryAt = Date.now() + Math.min(300, 30 * m.failures) * 1000; m.error = NET_ERR(cfg); return false; }
    if (r.status === 404 && r.json?.code === 10008) { d.messageId = ''; store.save(); }   // сообщение удалили вручную
    else return judge(m, r);
  }
  const j = await post(cfg, hook, embed);
  if (!j?.id) return false;
  d.messageId = String(j.id);
  store.save();
  return true;
}

/* ---------- один проход по серверу ---------- */
export async function syncOne(cfg, force = false) {
  const d = cfg.discord, m = M(cfg.id);
  const hook = d?.on && parseHook(d.url);
  if (!hook || m.busy) return;
  m.busy = true;
  try {
    const info = await dk.inspect(cfg.id).catch(() => null);
    const state = dk.stateOf(info), L = sv.live.get(cfg.id) || {};
    const online = state === 'running' ? (L.online || []).filter(Boolean) : [];
    const now = Date.now();

    // события: сравниваем с прошлым проходом (после перезапуска панели первый проход ничего не шлёт)
    if (m.prevState !== undefined && !(m.retryAt > now)) {
      const ev = eventsOf(d), X = sOf(cfg);
      const lines = [], due = k => !(m.lastEvent?.[k] > now - STATE_GAP);
      const mark = k => { (m.lastEvent ||= {})[k] = now; };
      if (state !== m.prevState) {
        if (state === 'running') { if (ev.started && due('started')) { lines.push([X.started, 0x2ecc71]); mark('started'); } }
        else if (state === 'stopped' && m.prevState !== 'missing') {
          const code = info?.State?.ExitCode, crashed = !!code && ![0, 137, 143].includes(code);
          const k = crashed ? 'crashed' : 'stopped';
          if (ev[k] && due(k)) { lines.push(crashed ? [X.crashed(code), 0xe74c3c] : [X.stopped, 0xe74c3c]); mark(k); }
        }
      }
      if (ev.join && state === 'running' && m.prevState === 'running' && m.prevOnline && L.at && L.at !== m.prevAt) {
        const was = new Set(m.prevOnline), is = new Set(online);
        const joined = online.filter(n => !was.has(n)), left = m.prevOnline.filter(n => !is.has(n));
        if (joined.length) lines.push([`${X.joined(joined.length)}${joined.slice(0, 10).map(n => '`' + clean(n) + '`').join(', ')}`, 0x3498db]);
        if (left.length) lines.push([`${X.left(left.length)}${left.slice(0, 10).map(n => '`' + clean(n) + '`').join(', ')}`, 0x95a5a6]);
      }
      for (const [text, color] of lines) await post(cfg, hook, eventEmbed(cfg, text, color));
    }
    m.prevState = state;
    m.prevOnline = state === 'running' ? online : null;
    m.prevAt = L.at;

    const sig = JSON.stringify([state, L.count, L.max, online, cfg.name, cfg.version, addressOf(cfg), d.interval]);
    const due = force || !m.sentAt || now - m.sentAt >= (d.interval || 60) * 1000 || (sig !== m.sig && now - m.sentAt >= MIN_GAP);
    if (!due || (m.retryAt > now && !force)) return;
    const ok = await sendBoard(cfg, hook, boardEmbed(cfg, state, info, { ...L, online }));
    if (ok) { m.sig = sig; m.sentAt = m.okAt = Date.now(); }   // после неудачи повтор определяет только пауза retryAt
  } catch (e) { m.error = 'Внутренняя ошибка: ' + e.message; console.error('discord', e); }
  finally { m.busy = false; }
}

async function tick() {
  const live = new Set(store.get().servers.map(s => s.id));
  for (const id of mem.keys()) if (!live.has(id)) mem.delete(id);
  for (const cfg of store.get().servers) if (cfg.discord?.on) await syncOne(cfg).catch(() => {});
}
export function startDiscord() { setInterval(() => tick().catch(() => {}), TICK).unref?.(); }

/* ---------- прокси ---------- */
/** Узлы прокси этой машины (там, где живёт сервер): подписка, ссылки vless:// и свой прокси. */
export function proxyNodes() {
  const list = P.nodes().map(n => ({ id: n.id, name: n.name, host: n.summary?.host || '' }));
  const e = P.externalAddr();
  if (e) list.push({ id: 'external', name: 'Свой прокси', host: `${e.host}:${e.port}` });
  return list;
}
const nextEvents = (b, d) => {
  const cur = eventsOf(d);
  if (!b || typeof b !== 'object') return cur;
  const legacyOnly = 'state' in b && !('started' in b || 'stopped' in b || 'crashed' in b);
  const pick = (k, legacy) => (k in b ? !!b[k] : legacyOnly && legacy != null ? !!legacy : cur[k]);
  return { started: pick('started'), stopped: pick('stopped', b.state), crashed: pick('crashed', b.state), join: pick('join') };
};
const cleanProxy = (b, cur) => {
  if (b === undefined) return cur || { on: false, node: '' };
  const on = !!b?.on, node = String(b?.node || '');
  if (on && !node) throw bad('Выберите узел прокси');
  if (on && !P.nodeExists(node)) throw bad('Выбранный узел прокси не найден');
  return { on, node: on ? node : (cur?.node || '') };
};

/* ---------- публичное описание (без секрета) ---------- */
export function pub(cfg) {
  const d = cfg.discord || {}, hook = parseHook(d.url), m = mem.get(cfg.id) || {};
  return {
    on: !!d.on, connected: !!hook, hook: hook ? `…/webhooks/${hook.id}/••••${hook.token.slice(-4)}` : '',
    interval: d.interval || 60, address: d.address || '', lang: d.lang === 'en' ? 'en' : 'ru', autoAddress: addressOf({ ...cfg, discord: {} }),
    events: eventsOf(d),
    posted: !!d.messageId, sentAt: m.okAt || null, error: m.error || '',
    proxy: { on: !!d.proxy?.on && !!endpointOf(d.proxy), node: d.proxy?.node || '', name: proxyName(d.proxy) },
    proxyNodes: proxyNodes(),
  };
}

/** Убирает вебхук из описания сервера, которое уходит в браузер, клоны и переносы. */
export const strip = cfg => { const { discord, ...rest } = cfg; return rest; };

export function register(r, { h, view }) {
  r.get('/servers/:id/discord', h(async (req, res) => res.json(pub(req.cfg))));

  r.put('/servers/:id/discord', h(async (req, res) => {
    const cfg = req.cfg, b = req.body || {}, d = cfg.discord || {};
    let url = d.url || '';
    if (typeof b.url === 'string' && b.url.trim()) {
      const hook = parseHook(b.url);
      if (!hook) throw bad('Это не похоже на вебхук Discord. Адрес выглядит так: https://discord.com/api/webhooks/…/…');
      if (hook.url !== d.url) { url = hook.url; d.messageId = ''; }   // новый канал: старое сообщение больше не наше
    }
    const interval = b.interval == null ? d.interval || 60 : Number(b.interval);
    if (!INTERVALS.includes(interval)) throw bad('Интервал: 30 секунд, 1, 2 или 5 минут');
    const address = b.address == null ? d.address || '' : String(b.address).replace(/[\r\n`]/g, '').trim().slice(0, 100);
    const on = b.on == null ? !!d.on : !!b.on;
    const lang = b.lang == null ? (d.lang === 'en' ? 'en' : 'ru') : String(b.lang);
    if (!LANGS.includes(lang)) throw bad('Язык сообщений: русский или английский');
    if (on && !parseHook(url)) throw bad('Сначала вставьте адрес вебхука');
    const proxy = cleanProxy(b.proxy, d.proxy);
    cfg.discord = {
      ...d, url, on, interval, address, proxy, lang, messageId: d.messageId || '',
      events: nextEvents(b.events, d),
    };
    store.save();
    const m = M(cfg.id);
    m.error = ''; m.retryAt = 0; m.failures = 0;
    if (on) await syncOne(cfg, true);
    res.json(pub(cfg));
  }));

  // Проверка связи с Discord выбранным способом (по настройке из формы, ещё не сохранённой)
  r.post('/servers/:id/discord/check', h(async (req, res) => {
    const cfg = req.cfg, proxy = cleanProxy(req.body?.proxy, cfg.discord?.proxy);
    const ep = endpointOf(proxy), t0 = Date.now();
    const out = { via: proxy.on ? proxyName(proxy) || 'прокси' : 'напрямую', reach: false, ms: 0, webhook: null, error: '' };
    try {
      const g = await proxyFetch(ep, (process.env.DISCORD_TEST_BASE || 'https://discord.com') + '/api/v10/gateway', { signal: AbortSignal.timeout(12000) });
      out.reach = g.status === 200; out.ms = Date.now() - t0;
      if (!out.reach) out.error = `Discord ответил ошибкой ${g.status}`;
      const hook = parseHook(cfg.discord?.url);
      if (out.reach && hook) { const w = await proxyFetch(ep, hook.base, { signal: AbortSignal.timeout(12000) }); out.webhook = w.status === 200 ? 'ok' : 'bad'; }
    } catch { out.error = proxy.on ? 'Через этот узел Discord не открывается' : 'Напрямую Discord не открывается'; }
    res.json(out);
  }));

  // Отправить табло заново новым сообщением (например, чтобы закрепить его или перенести вниз канала)
  r.post('/servers/:id/discord/resend', h(async (req, res) => {
    const cfg = req.cfg, d = cfg.discord, hook = d && parseHook(d.url);
    if (!hook || !d.on) throw bad('Табло не включено');
    if (d.messageId) { await call(cfg, hook, 'DELETE', `/messages/${d.messageId}`).catch(() => {}); d.messageId = ''; store.save(); }
    const m = M(cfg.id); m.error = ''; m.retryAt = 0;
    await syncOne(cfg, true);
    res.json(pub(cfg));
  }));

  r.delete('/servers/:id/discord', h(async (req, res) => {
    const cfg = req.cfg, d = cfg.discord, hook = d && parseHook(d.url);
    if (hook && d.messageId && req.query.keep !== '1') await call(cfg, hook, 'DELETE', `/messages/${d.messageId}`).catch(() => {});
    delete cfg.discord;
    mem.delete(cfg.id);
    store.save();
    res.json(pub(cfg));
  }));
}

import sharp from 'sharp';
import * as store from './store.js';
import * as dk from './dock.js';
import * as sv from './services.js';
import * as P from './proxy.js';
import * as gw from './dgateway.js';
import { proxyFetch, endpointOf } from './net.js';

/* Табло сервера в Discord. Панель один раз отправляет сообщение в канал и дальше сама его правит:
   статус, игроки, версия, аптайм, память. Отдельными сообщениями по желанию приходят события
   (запуск, остановка, вход и выход игроков). Два способа отправки:
   - вебхук канала: бот не нужен, хватит адреса вебхука;
   - свой бот: панель работает от имени бота по его токену, пишет только в выбранные каналы, держит бота «в сети»
     и показывает статус (например, «Играет в Выживание: 3/20»).
   Адрес вебхука и токен бота секретные, наружу из панели не отдаются. */

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });

const BASE = () => process.env.DISCORD_TEST_BASE || 'https://discord.com';   // DISCORD_TEST_BASE нужна только автотестам
const API = () => BASE() + '/api/v10';
const CDN = () => (process.env.DISCORD_TEST_BASE ? BASE() + '/cdn' : 'https://cdn.discordapp.com');
const HOOK_RE = /^https:\/\/(?:(?:ptb|canary)\.)?(?:discord|discordapp)\.com\/api(?:\/v\d+)?\/webhooks\/(\d{15,25})\/([\w-]{20,120})\/?(?:\?.*)?$/;
const SNOW = /^\d{15,25}$/;
const TOKEN_RE = /^[\w-]{18,}\.[\w-]{4,}\.[\w-]{20,}$/;
export const INTERVALS = [30, 60, 120, 300];
export const ACTIVITY_TYPES = [0, 2, 3, 4, 5];   // играет, слушает, смотрит, свой текст, соревнуется
const BOT_PERMS = 84992;        // просмотр канала, отправка сообщений, встраивание ссылок, чтение истории
const MIN_GAP = 15e3;            // не чаще, чем раз в 15 секунд даже при частых изменениях
const TICK = 10e3;

/** Приводит адрес вебхука к каноническому виду или возвращает null. */
export function parseHook(url) {
  const m = HOOK_RE.exec(String(url || '').trim());
  if (!m) return null;
  const path = `/api/webhooks/${m[1]}/${m[2]}`;
  return { id: m[1], token: m[2], url: 'https://discord.com' + path, base: BASE() + path };
}
export const kindOf = d => (d?.kind === 'bot' ? 'bot' : 'webhook');

/** Способ отправки для сервера или null, если ничего не подключено. */
function transport(cfg) {
  const d = cfg.discord || {};
  if (kindOf(d) === 'bot') {
    const b = d.bot || {};
    if (!b.token || !SNOW.test(b.channelId || '')) return null;
    const ev = SNOW.test(b.eventsChannelId || '') ? b.eventsChannelId : b.channelId;
    return { kind: 'bot', auth: 'Bot ' + b.token, post: `${API()}/channels/${b.channelId}/messages`, postEvent: `${API()}/channels/${ev}/messages`, msg: id => `${API()}/channels/${b.channelId}/messages/${id}` };
  }
  const hook = parseHook(d.url);
  return hook ? { kind: 'webhook', auth: '', post: hook.base + '?wait=true', postEvent: hook.base + '?wait=true', msg: id => `${hook.base}/messages/${id}` } : null;
}

/* Состояние в памяти: когда и что отправляли, ошибки, прошлый статус для событий, профиль бота или вебхука. */
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
    offShort: 'сервер выключен', bootShort: 'сервер запускается',
  },
  en: {
    server: 'Server', status: 'Status', players: 'Players', version: 'Version', address: 'Address', uptime: 'Uptime', memory: 'Memory', playing: 'Playing now',
    online: '🟢 Online', starting: '🟡 Starting', offline: '🔴 Offline', of: 'of', gb: 'GB', more: n => ` and ${n} more`, dur: ['d', 'h', 'min'],
    every: s => (s === 30 ? 'every 30 seconds' : s === 60 ? 'every minute' : `every ${s / 60} minutes`), updates: 'updates',
    started: '🟢 **Server started**', stopped: '🔴 **Server stopped**', crashed: code => `💥 **Server stopped with an error** (code ${code})`,
    joined: n => `➕ Joined: `, left: n => `➖ Left: `,
    offShort: 'server offline', bootShort: 'server starting',
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

/* ---------- вид сообщения: заголовок, текст, какие поля показывать, подпись ---------- */
export const LOOK_FIELDS = ['players', 'version', 'address', 'uptime', 'memory', 'list'];
export function lookOf(d) {
  const l = d?.look || {}, f = l.fields || {};
  return {
    title: String(l.title || ''), text: String(l.text || ''), footer: String(l.footer || ''), footerOn: l.footerOn !== false,
    fields: Object.fromEntries(LOOK_FIELDS.map(k => [k, f[k] !== false])),
  };
}
function cleanLook(b, d) {
  const cur = lookOf(d);
  if (!b || typeof b !== 'object') return cur;
  const line = (v, max, old) => (v == null ? old : String(v).replace(/[\r\0]/g, '').trim().slice(0, max));
  return {
    title: line(b.title, 100, cur.title).replace(/\n/g, ' '), text: line(b.text, 400, cur.text), footer: line(b.footer, 60, cur.footer).replace(/\n/g, ' '),
    footerOn: b.footerOn == null ? cur.footerOn : !!b.footerOn,
    fields: Object.fromEntries(LOOK_FIELDS.map(k => [k, b.fields && k in b.fields ? !!b.fields[k] : cur.fields[k]])),
  };
}

/** Сообщение-табло. state: running | starting | stopped | missing. */
export function boardEmbed(cfg, state, info, L = {}) {
  const d = cfg.discord || {}, X = sOf(cfg), look = lookOf(d), on = look.fields;
  const up = state === 'running', booting = state === 'starting';
  const title = (look.title || String(cfg.name || X.server).replace(/§./g, '') || X.server).slice(0, 250);
  const fields = [{ name: X.status, value: up ? X.online : booting ? X.starting : X.offline, inline: true }];
  if (up && on.players) fields.push({ name: X.players, value: L.max != null ? `**${L.count}** ${X.of} ${L.max}` : '—', inline: true });
  if (on.version) fields.push({ name: X.version, value: `${TYPE_NAME[cfg.type] || cfg.type} ${cfg.version && cfg.version !== 'LATEST' ? cfg.version : ''}`.trim(), inline: true });
  const addr = addressOf(cfg);
  if (addr && on.address) fields.push({ name: X.address, value: '`' + clean(addr) + '`', inline: true });
  if (up && on.uptime && info?.State?.StartedAt) fields.push({ name: X.uptime, value: fmtDur(Date.now() - Date.parse(info.State.StartedAt), X.dur), inline: true });
  if (up && on.memory && L.mem && L.memLimit) fields.push({ name: X.memory, value: `${fmtGb(L.mem)} ${X.of} ${fmtGb(L.memLimit)} ${X.gb}`, inline: true });
  if (up && on.list && L.count > 0) {
    const names = (L.online || []).filter(Boolean);
    const shown = names.slice(0, 30).map(n => '`' + clean(n) + '`').join(', ');
    const more = Math.max(L.count, names.length) - Math.min(names.length, 30);
    fields.push({ name: X.playing, value: ((shown || '—') + (more > 0 && shown ? X.more(more) : '')).slice(0, 1000) });
  }
  return {
    title, ...(look.text ? { description: look.text.slice(0, 2000) } : {}), color: up ? 0x2ecc71 : booting ? 0xf1c40f : 0xe74c3c, fields,
    ...(look.footerOn ? { footer: { text: `${look.footer || 'HorizonCraft'} · ${X.updates} ${X.every(d.interval || 60)}` } } : {}), timestamp: new Date().toISOString(),
  };
}

/** Короткое событие отдельным сообщением. */
const eventEmbed = (cfg, text, color) => ({ title: (lookOf(cfg.discord).title || String(cfg.name || sOf(cfg).server)).slice(0, 250), description: text.slice(0, 2000), color, timestamp: new Date().toISOString() });

/* ---------- статус бота ---------- */
export const DEFAULT_ACTIVITY = { type: 0, text: '{server}: {online}/{max}' };
export function activityOf(d) {
  const a = d?.bot?.activity;
  return a && typeof a === 'object' ? { type: ACTIVITY_TYPES.includes(a.type) ? a.type : 0, text: String(a.text ?? '') } : { ...DEFAULT_ACTIVITY };
}
/** Что бот показывает под своим именем: при работающем сервере шаблон с подстановками, иначе короткое «сервер выключен». */
export function presenceOf(cfg, state, L = {}) {
  const X = sOf(cfg), a = activityOf(cfg.discord), name = String(cfg.name || X.server).replace(/§./g, '');
  if (state !== 'running') return { status: state === 'starting' ? 'idle' : 'dnd', type: a.type === 4 ? 4 : 0, text: a.text ? `${name}: ${state === 'starting' ? X.bootShort : X.offShort}`.slice(0, 120) : '' };
  const text = a.text.replace(/\{server\}/g, name).replace(/\{online\}/g, L.count ?? 0).replace(/\{max\}/g, L.max ?? '?')
    .replace(/\{address\}/g, addressOf(cfg)).replace(/\{version\}/g, cfg.version && cfg.version !== 'LATEST' ? cfg.version : '').trim().slice(0, 120);
  return { status: 'online', type: a.type, text };
}

/* ---------- обращение к Discord ---------- */
async function dcall(cfg, method, url, body, auth, proxy = cfg.discord?.proxy) {
  const r = await proxyFetch(endpointOf(proxy), url, {
    method, signal: AbortSignal.timeout(12000),
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(auth ? { authorization: auth } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
const msgBody = embed => ({ embeds: [embed], allowed_mentions: { parse: [] } });

/** Название активного узла для сообщений пользователю. */
export function proxyName(p) { return p?.on ? P.activeName() : ''; }
const NET_ERR = cfg => (endpointOf(cfg.discord?.proxy)
  ? `Нет связи с Discord даже через VLESS «${P.activeName()}». Проверьте узел в Настройках или выберите другой.`
  : 'Нет связи с Discord. Если он заблокирован у вашего провайдера, включите ниже «Через VLESS».');

/** Разбор ответа: запоминает ошибку и паузу перед следующей попыткой. true, если сообщение принято. */
function judge(m, r, kind) {
  if (r.status >= 200 && r.status < 300) { m.error = ''; m.failures = 0; m.retryAt = 0; return true; }
  m.failures = (m.failures || 0) + 1;
  const code = r.json?.code;
  if (r.status === 429) {
    const wait = Math.min(120, Math.max(1, Number(r.json?.retry_after) || 5));
    m.retryAt = Date.now() + wait * 1000; m.error = `Discord просит подождать ${Math.ceil(wait)} с`;
  } else if (kind === 'bot' && r.status === 401) {
    m.retryAt = Date.now() + 5 * 60e3; m.error = 'Discord не принимает токен бота: он сброшен или введён неверно. Вставьте новый токен.';
  } else if (kind === 'bot' && (r.status === 403 || code === 50001 || code === 50013)) {
    m.retryAt = Date.now() + 60e3; m.error = 'У бота нет прав писать в этот канал. Дайте ему права «Просмотр канала», «Отправлять сообщения» и «Встраивать ссылки».';
  } else if (kind === 'bot' && r.status === 404) {
    m.retryAt = Date.now() + 60e3; m.error = 'Канал не найден: его удалили или бота убрали с сервера Discord. Выберите канал заново.';
  } else if (r.status === 401 || r.status === 403 || (r.status === 404 && code === 10015)) {
    m.retryAt = Date.now() + 5 * 60e3; m.error = 'Discord не принимает этот вебхук: он удалён или адрес неверный. Создайте новый и вставьте его заново.';
  } else {
    m.retryAt = Date.now() + Math.min(300, 30 * m.failures) * 1000; m.error = `Discord ответил ошибкой ${r.status}`;
  }
  return false;
}
const netFail = (m, cfg) => { m.failures = (m.failures || 0) + 1; m.retryAt = Date.now() + Math.min(300, 30 * m.failures) * 1000; m.error = NET_ERR(cfg); };

async function post(cfg, T, embed, event = false) {
  const m = M(cfg.id);
  let r;
  try { r = await dcall(cfg, 'POST', event ? T.postEvent : T.post, msgBody(embed), T.auth); }
  catch { netFail(m, cfg); return null; }
  return judge(m, r, T.kind) ? r.json : null;
}

/** Обновляет табло: правит прежнее сообщение, а если его удалили, отправляет новое. */
async function sendBoard(cfg, T, embed) {
  const m = M(cfg.id), d = cfg.discord;
  if (d.messageId) {
    let r;
    try { r = await dcall(cfg, 'PATCH', T.msg(d.messageId), msgBody(embed), T.auth); }
    catch { netFail(m, cfg); return false; }
    if (r.status === 404 && r.json?.code === 10008) { d.messageId = ''; store.save(); }   // сообщение удалили вручную
    else return judge(m, r, T.kind);
  }
  const j = await post(cfg, T, embed);
  if (!j?.id) return false;
  d.messageId = String(j.id);
  store.save();
  return true;
}
const dropBoard = async cfg => {
  const T = transport(cfg), d = cfg.discord;
  if (T && d?.messageId) await dcall(cfg, 'DELETE', T.msg(d.messageId), null, T.auth).catch(() => {});
  if (d) d.messageId = '';
};

/* ---------- один проход по серверу ---------- */
export async function syncOne(cfg, force = false) {
  const d = cfg.discord, m = M(cfg.id);
  const T = d?.on && transport(cfg);
  if (!T || m.busy) return;
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
      for (const [text, color] of lines) await post(cfg, T, eventEmbed(cfg, text, color), true);
    }
    m.prevState = state;
    m.prevOnline = state === 'running' ? online : null;
    m.prevAt = L.at;

    const sig = JSON.stringify([state, L.count, L.max, online, cfg.name, cfg.version, addressOf(cfg), d.interval, d.look]);
    const due = force || !m.sentAt || now - m.sentAt >= (d.interval || 60) * 1000 || (sig !== m.sig && now - m.sentAt >= MIN_GAP);
    if (!due || (m.retryAt > now && !force)) return;
    const ok = await sendBoard(cfg, T, boardEmbed(cfg, state, info, { ...L, online }));
    if (ok) { m.sig = sig; m.sentAt = m.okAt = Date.now(); }   // после неудачи повтор определяет только пауза retryAt
  } catch (e) { m.error = 'Внутренняя ошибка: ' + e.message; console.error('discord', e); }
  finally { m.busy = false; }
}

/** Подключения ботов к шлюзу: бот «в сети» со статусом, пока табло включено. Один токен, одно подключение. */
export function syncGateways() {
  const want = new Set();
  for (const cfg of store.get().servers) {
    const d = cfg.discord, tok = d?.bot?.token;
    if (kindOf(d) !== 'bot' || !d.on || !tok || d.bot.online === false || want.has(tok)) continue;
    want.add(tok);
    const L = sv.live.get(cfg.id) || {};
    const state = L.running ? (L.max != null ? 'running' : 'starting') : 'stopped';
    gw.ensure(tok, presenceOf(cfg, state, L), endpointOf(d.proxy)?.http || '');
  }
  gw.keep(want);
}

async function tick() {
  const live = new Set(store.get().servers.map(s => s.id));
  for (const id of mem.keys()) if (!live.has(id)) mem.delete(id);
  syncGateways();
  for (const cfg of store.get().servers) if (cfg.discord?.on) await syncOne(cfg).catch(() => {});
}
export function startDiscord() { setInterval(() => tick().catch(() => {}), TICK).unref?.(); }

/* ---------- профиль бота или вебхука: имя, аватар, описание ---------- */
async function loadProfile(cfg) {
  const d = cfg.discord || {}, m = M(cfg.id);
  if (m.profBusy) return m.profile || null;
  m.profBusy = true;
  try {
    if (kindOf(d) === 'bot') {
      if (!d.bot?.token) return (m.profile = null);
      const auth = 'Bot ' + d.bot.token;
      const u = await dcall(cfg, 'GET', `${API()}/users/@me`, null, auth);
      if (u.status !== 200) return m.profile || null;
      const a = await dcall(cfg, 'GET', `${API()}/applications/@me`, null, auth).catch(() => null);
      m.profile = { kind: 'bot', id: String(u.json.id), name: u.json.username || '', avatar: u.json.avatar || '', about: a?.status === 200 ? String(a.json.description || '') : '', at: Date.now() };
    } else {
      const hook = parseHook(d.url);
      if (!hook) return (m.profile = null);
      const w = await dcall(cfg, 'GET', hook.base, null, '');
      if (w.status !== 200) return m.profile || null;
      m.profile = { kind: 'webhook', id: String(w.json.id || hook.id), name: w.json.name || '', avatar: w.json.avatar || '', about: '', at: Date.now() };
    }
    return m.profile;
  } catch { return m.profile || null; }
  finally { m.profBusy = false; }
}
/** Картинка из формы (data:URL) в квадратный PNG 256 на 256 для Discord. */
async function avatarData(src) {
  const m = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(src || ''));
  if (!m) throw bad('Аватар: нужна картинка PNG, JPEG, WebP или GIF');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 3 * 1024 * 1024) throw bad('Аватар: файл больше 3 МБ');
  try { return 'data:image/png;base64,' + (await sharp(buf).resize(256, 256, { fit: 'cover' }).png().toBuffer()).toString('base64'); }
  catch { throw bad('Аватар: не удалось прочитать картинку'); }
}
const discordSays = (r, what) => {
  if (r.status === 429) return bad(`Discord ограничивает частоту смены ${what}. Попробуйте позже.`, 429);
  const errs = r.json?.errors ? JSON.stringify(r.json.errors).match(/"message":"([^"]+)"/)?.[1] : '';
  return bad(`Discord не принял изменение (${what}): ${errs || r.json?.message || 'ошибка ' + r.status}`, 400);
};

const cleanProxy = (b, cur) => {
  if (b === undefined) return { on: !!cur?.on };
  const on = !!b?.on;
  if (on && !P.active().node) throw bad('Сначала выберите узел VLESS в Настройках');
  return { on };
};
const nextEvents = (b, d) => {
  const cur = eventsOf(d);
  if (!b || typeof b !== 'object') return cur;
  const legacyOnly = 'state' in b && !('started' in b || 'stopped' in b || 'crashed' in b);
  const pick = (k, legacy) => (k in b ? !!b[k] : legacyOnly && legacy != null ? !!legacy : cur[k]);
  return { started: pick('started'), stopped: pick('stopped', b.state), crashed: pick('crashed', b.state), join: pick('join') };
};

/* ---------- публичное описание (без секретов) ---------- */
export function pub(cfg) {
  const d = cfg.discord || {}, hook = parseHook(d.url), m = mem.get(cfg.id) || {}, kind = kindOf(d), b = d.bot || {};
  const p = m.profile && m.profile.kind === kind ? m.profile : null;
  const g = kind === 'bot' && b.token ? gw.status(b.token) : { state: 'off', error: '' };
  return {
    kind, on: !!d.on, connected: !!transport(cfg), hook: hook ? `…/webhooks/${hook.id}/••••${hook.token.slice(-4)}` : '',
    bot: {
      tokenSet: !!b.token, hint: b.token ? '••••' + b.token.slice(-4) : '', guildId: b.guildId || '', guildName: b.guildName || '',
      channelId: b.channelId || '', channelName: b.channelName || '', eventsChannelId: b.eventsChannelId || '', eventsChannelName: b.eventsChannelName || '',
      activity: activityOf(d), online: b.online !== false, gateway: g.state, gatewayError: g.error,
      invite: p && kind === 'bot' ? `https://discord.com/oauth2/authorize?client_id=${p.id}&scope=bot&permissions=${BOT_PERMS}` : '',
    },
    profile: p ? { id: p.id, name: p.name, about: p.about, avatar: !!p.avatar, ver: p.avatar || '' } : null,
    look: lookOf(d),
    interval: d.interval || 60, address: d.address || '', lang: d.lang === 'en' ? 'en' : 'ru', autoAddress: addressOf({ ...cfg, discord: {} }),
    events: eventsOf(d),
    posted: !!d.messageId, sentAt: m.okAt || null, error: m.error || '',
    proxy: { on: !!d.proxy?.on, name: P.activeName(), available: !!P.active().node },
  };
}

/** Убирает вебхук и токен из описания сервера, которое уходит в браузер, клоны и переносы. */
export const strip = cfg => { const { discord, ...rest } = cfg; return rest; };

export function register(r, { h }) {
  r.get('/servers/:id/discord', h(async (req, res) => {
    const m = M(req.cfg.id), d = req.cfg.discord;
    if (d && (parseHook(d.url) || d.bot?.token) && !(Date.now() - (m.profile?.at || 0) < 5 * 60e3) && !(Date.now() - (m.profTry || 0) < 30e3)) { m.profTry = Date.now(); loadProfile(req.cfg).catch(() => {}); }
    res.json(pub(req.cfg));
  }));

  r.put('/servers/:id/discord', h(async (req, res) => {
    const cfg = req.cfg, b = req.body || {}, d = cfg.discord || {};
    const kind = b.kind == null ? kindOf(d) : b.kind === 'bot' ? 'bot' : 'webhook';
    const proxy = cleanProxy(b.proxy, d.proxy);
    let url = d.url || '', bot = { ...(d.bot || {}) }, moved = kind !== kindOf(d);
    if (kind === 'webhook' && typeof b.url === 'string' && b.url.trim()) {
      const hook = parseHook(b.url);
      if (!hook) throw bad('Это не похоже на вебхук Discord. Адрес выглядит так: https://discord.com/api/webhooks/…/…');
      if (hook.url !== d.url) { url = hook.url; moved = true; }   // новый канал: старое сообщение больше не наше
    }
    if (kind === 'bot' && b.bot && typeof b.bot === 'object') {
      const nb = b.bot;
      if (!bot.token) throw bad('Сначала подключите бота: вставьте его токен');
      const chan = async (id, label) => {
        if (!SNOW.test(String(id))) throw bad(`${label}: выберите канал из списка`);
        let c;
        try { c = await dcall({ ...cfg, discord: { ...d, proxy } }, 'GET', `${API()}/channels/${id}`, null, 'Bot ' + bot.token); }
        catch { throw bad(proxy.on ? 'Нет связи с Discord через VLESS' : 'Нет связи с Discord. Если он заблокирован, включите «Через VLESS».', 502); }
        if (c.status === 401) throw bad('Discord не принимает токен бота. Вставьте новый токен.');
        if (c.status !== 200) throw bad(`${label}: бот не видит этот канал. Пригласите бота на сервер Discord и дайте ему доступ к каналу.`);
        return { id: String(id), name: String(c.json.name || ''), guild: String(c.json.guild_id || '') };
      };
      if ('channelId' in nb && String(nb.channelId) !== (bot.channelId || '')) {
        const c = await chan(nb.channelId, 'Канал табло');
        Object.assign(bot, { channelId: c.id, channelName: c.name, guildId: c.guild, guildName: String(nb.guildName || '').slice(0, 100) });
        moved = true;
      }
      if ('eventsChannelId' in nb && String(nb.eventsChannelId || '') !== (bot.eventsChannelId || '')) {
        if (!nb.eventsChannelId) { bot.eventsChannelId = ''; bot.eventsChannelName = ''; }
        else { const c = await chan(nb.eventsChannelId, 'Канал событий'); bot.eventsChannelId = c.id; bot.eventsChannelName = c.name; }
      }
      if (nb.activity && typeof nb.activity === 'object') {
        const type = Number(nb.activity.type);
        if (!ACTIVITY_TYPES.includes(type)) throw bad('Неизвестный вид статуса бота');
        bot.activity = { type, text: String(nb.activity.text ?? '').replace(/[\r\n]/g, ' ').trim().slice(0, 100) };
      }
      if ('online' in nb) bot.online = !!nb.online;
    }
    const interval = b.interval == null ? d.interval || 60 : Number(b.interval);
    if (!INTERVALS.includes(interval)) throw bad('Интервал: 30 секунд, 1, 2 или 5 минут');
    const address = b.address == null ? d.address || '' : String(b.address).replace(/[\r\n`]/g, '').trim().slice(0, 100);
    const on = b.on == null ? !!d.on : !!b.on;
    const lang = b.lang == null ? (d.lang === 'en' ? 'en' : 'ru') : String(b.lang);
    if (!LANGS.includes(lang)) throw bad('Язык сообщений: русский или английский');
    const look = cleanLook(b.look, d);
    if (moved && d.messageId) await dropBoard(cfg);   // прежнее табло остаётся в старом канале: убираем его
    const next = { ...d, kind, url, bot, on, interval, address, proxy, lang, look, messageId: moved ? '' : d.messageId || '', events: nextEvents(b.events, d) };
    if (on && !transport({ ...cfg, discord: next })) throw bad(kind === 'bot' ? 'Сначала подключите бота и выберите канал' : 'Сначала вставьте адрес вебхука');
    cfg.discord = next;
    store.save();
    const m = M(cfg.id);
    m.error = ''; m.retryAt = 0; m.failures = 0;
    if (moved) { m.profile = null; await loadProfile(cfg); }
    if (on) await syncOne(cfg, true);
    syncGateways();
    res.json(pub(cfg));
  }));

  /* ----- бот: подключение по токену, серверы и каналы, где он есть ----- */
  const botCall = async (cfg, token, path, proxy) => {
    let r;
    try { r = await dcall(cfg, 'GET', API() + path, null, 'Bot ' + token, proxy); }
    catch { throw bad((proxy ?? cfg.discord?.proxy)?.on ? 'Нет связи с Discord через VLESS. Проверьте узел в Настройках.' : 'Нет связи с Discord. Если он заблокирован у вашего провайдера, включите «Через VLESS».', 502); }
    if (r.status === 401) throw bad('Discord не принял токен. Скопируйте его заново: Developer Portal → ваше приложение → Bot → Reset Token.');
    if (r.status === 429) throw bad('Discord просит подождать. Повторите через несколько секунд.', 429);
    return r;
  };
  r.post('/servers/:id/discord/bot', h(async (req, res) => {
    const cfg = req.cfg, d = cfg.discord || {}, token = String(req.body?.token || '').trim().replace(/^Bot\s+/i, '');
    if (!TOKEN_RE.test(token)) throw bad('Это не похоже на токен бота. Он выглядит как три части через точку и берётся в Developer Portal → Bot → Reset Token.');
    const proxy = cleanProxy(req.body?.proxy, d.proxy);
    const u = await botCall(cfg, token, '/users/@me', proxy);
    if (u.status !== 200 || !u.json?.id) throw bad(`Discord ответил ошибкой ${u.status}`, 502);
    if (d.messageId) await dropBoard(cfg);
    const same = d.bot?.token === token;
    cfg.discord = {
      ...d, kind: 'bot', proxy, messageId: '', on: same ? !!d.on : false, interval: d.interval || 60, lang: req.body?.lang === 'en' || (!req.body?.lang && d.lang === 'en') ? 'en' : 'ru',
      bot: same ? d.bot : { token, activity: { ...DEFAULT_ACTIVITY }, online: true },
    };
    store.save();
    const m = M(cfg.id); m.error = ''; m.retryAt = 0; m.profile = null;
    await loadProfile(cfg);
    res.json(pub(cfg));
  }));
  r.get('/servers/:id/discord/guilds', h(async (req, res) => {
    const tok = req.cfg.discord?.bot?.token;
    if (!tok) throw bad('Бот не подключён');
    const g = await botCall(req.cfg, tok, '/users/@me/guilds');
    res.json((Array.isArray(g.json) ? g.json : []).map(x => ({ id: String(x.id), name: String(x.name || '') })));
  }));
  r.get('/servers/:id/discord/channels', h(async (req, res) => {
    const tok = req.cfg.discord?.bot?.token, guild = String(req.query.guild || '');
    if (!tok) throw bad('Бот не подключён');
    if (!SNOW.test(guild)) throw bad('Выберите сервер Discord');
    const c = await botCall(req.cfg, tok, `/guilds/${guild}/channels`);
    if (c.status !== 200 || !Array.isArray(c.json)) throw bad('Бот не видит каналы этого сервера Discord');
    const cats = new Map(c.json.filter(x => x.type === 4).map(x => [String(x.id), x]));
    const pos = x => (cats.get(String(x.parent_id))?.position ?? -1) * 1000 + (x.position || 0);
    res.json(c.json.filter(x => x.type === 0 || x.type === 5).sort((a, b) => pos(a) - pos(b))
      .map(x => ({ id: String(x.id), name: String(x.name || ''), category: cats.get(String(x.parent_id))?.name || '' })));
  }));

  /* ----- как выглядит отправитель: имя, аватар, описание бота или вебхука ----- */
  r.put('/servers/:id/discord/profile', h(async (req, res) => {
    const cfg = req.cfg, d = cfg.discord || {}, b = req.body || {}, kind = kindOf(d);
    const hook = parseHook(d.url), tok = d.bot?.token;
    if (kind === 'bot' ? !tok : !hook) throw bad('Сначала подключите Discord');
    const body = {};
    if (typeof b.name === 'string') {
      const n = b.name.trim();
      if (n.length < (kind === 'bot' ? 2 : 1) || n.length > (kind === 'bot' ? 32 : 80)) throw bad(kind === 'bot' ? 'Имя бота: от 2 до 32 символов' : 'Имя вебхука: от 1 до 80 символов');
      body[kind === 'bot' ? 'username' : 'name'] = n;
    }
    if (b.avatarClear) body.avatar = null;
    else if (b.avatar) body.avatar = await avatarData(b.avatar);
    const fail = () => bad(d.proxy?.on ? 'Нет связи с Discord через VLESS' : 'Нет связи с Discord', 502);
    if (Object.keys(body).length) {
      const r1 = await dcall(cfg, 'PATCH', kind === 'bot' ? `${API()}/users/@me` : hook.base, body, kind === 'bot' ? 'Bot ' + tok : '').catch(() => { throw fail(); });
      if (!(r1.status >= 200 && r1.status < 300)) throw discordSays(r1, 'name' in b && !('avatar' in body) ? 'имени' : 'профиля');
    }
    if (kind === 'bot' && typeof b.about === 'string') {
      const r2 = await dcall(cfg, 'PATCH', `${API()}/applications/@me`, { description: b.about.trim().slice(0, 400) }, 'Bot ' + tok).catch(() => { throw fail(); });
      if (!(r2.status >= 200 && r2.status < 300)) throw discordSays(r2, 'описания');
    }
    const m = M(cfg.id); m.profile = null;
    await loadProfile(cfg);
    res.json(pub(cfg));
  }));
  // Аватар для макета в панели: браузеру не нужен доступ к Discord, картинку забирает панель (если надо, через VLESS)
  r.get('/servers/:id/discord/avatar', h(async (req, res) => {
    const p = mem.get(req.cfg.id)?.profile;
    if (!p?.avatar) return res.status(404).end();
    const a = await proxyFetch(endpointOf(req.cfg.discord?.proxy), `${CDN()}/avatars/${p.id}/${p.avatar}.png?size=128`, { signal: AbortSignal.timeout(12000) }).catch(() => null);
    if (!a || a.status !== 200) return res.status(404).end();
    res.set('content-type', 'image/png').set('cache-control', 'private, max-age=600').send(Buffer.from(await a.arrayBuffer()));
  }));

  // Проверка связи с Discord выбранным способом (по настройке из формы, ещё не сохранённой)
  r.post('/servers/:id/discord/check', h(async (req, res) => {
    const cfg = req.cfg, d = cfg.discord || {}, proxy = cleanProxy(req.body?.proxy, d.proxy);
    const ep = endpointOf(proxy), t0 = Date.now();
    const out = { via: proxy.on ? P.activeName() || 'VLESS' : 'напрямую', reach: false, ms: 0, webhook: null, bot: null, error: '' };
    try {
      const g = await proxyFetch(ep, API() + '/gateway', { signal: AbortSignal.timeout(12000) });
      out.reach = g.status === 200; out.ms = Date.now() - t0;
      if (!out.reach) out.error = `Discord ответил ошибкой ${g.status}`;
      const hook = parseHook(d.url);
      if (out.reach && kindOf(d) === 'webhook' && hook) { const w = await proxyFetch(ep, hook.base, { signal: AbortSignal.timeout(12000) }); out.webhook = w.status === 200 ? 'ok' : 'bad'; }
      if (out.reach && kindOf(d) === 'bot' && d.bot?.token) { const u = await proxyFetch(ep, API() + '/users/@me', { headers: { authorization: 'Bot ' + d.bot.token }, signal: AbortSignal.timeout(12000) }); out.bot = u.status === 200 ? 'ok' : 'bad'; }
    } catch { out.error = proxy.on ? 'Через VLESS Discord не открывается' : 'Напрямую Discord не открывается'; }
    res.json(out);
  }));

  // Отправить табло заново новым сообщением (например, чтобы закрепить его или перенести вниз канала)
  r.post('/servers/:id/discord/resend', h(async (req, res) => {
    const cfg = req.cfg, d = cfg.discord;
    if (!d?.on || !transport(cfg)) throw bad('Табло не включено');
    await dropBoard(cfg); store.save();
    const m = M(cfg.id); m.error = ''; m.retryAt = 0;
    await syncOne(cfg, true);
    res.json(pub(cfg));
  }));

  r.delete('/servers/:id/discord', h(async (req, res) => {
    const cfg = req.cfg;
    if (cfg.discord && req.query.keep !== '1') await dropBoard(cfg);
    delete cfg.discord;
    mem.delete(cfg.id);
    store.save();
    syncGateways();
    res.json(pub(cfg));
  }));
}

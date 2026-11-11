import http from 'http';
import https from 'https';
import tls from 'tls';
import WebSocket from 'ws';

/* Подключение бота к шлюзу Discord. Нужно только для того, чтобы бот был «в сети» и показывал статус
   (например, «Играет в Minecraft: 3/20»). Сообщения бот отправляет обычными запросами, шлюз для них не нужен.
   На один токен держится одно подключение, даже если бота используют несколько серверов панели. */

const GATEWAY = () => process.env.DISCORD_TEST_GATEWAY || 'wss://gateway.discord.gg';
const conns = new Map();   // токен -> подключение

/** Агент для wss через HTTP-прокси (метод CONNECT): Discord закрыт у ряда провайдеров. */
class ConnectAgent extends https.Agent {
  constructor(proxy) { super({ keepAlive: false }); this.proxy = proxy; }
  createConnection(opts, cb) {
    const [host, port] = this.proxy.split(':');
    const req = http.request({ host, port: +port, method: 'CONNECT', path: `${opts.host}:${opts.port}`, timeout: 15000 });
    req.on('timeout', () => req.destroy(new Error('прокси не отвечает')));
    req.on('error', cb);
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); return cb(new Error('прокси ответил ' + res.statusCode)); }
      cb(null, tls.connect({ socket, servername: opts.servername || opts.host, rejectUnauthorized: opts.rejectUnauthorized }));
    });
    req.end();
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const payload = p => ({ since: null, afk: false, status: p.status || 'online', activities: p.text ? [p.type === 4 ? { name: 'Custom Status', type: 4, state: p.text } : { name: p.text, type: p.type || 0 }] : [] });

function open(c) {
  clearTimeout(c.timer);
  if (c.closed) return;
  c.state = 'connecting';
  const isWss = GATEWAY().startsWith('wss:');
  let ws;
  try { ws = new WebSocket(`${c.resume?.url || GATEWAY()}/?v=10&encoding=json`, { handshakeTimeout: 20000, ...(c.proxy && isWss ? { agent: new ConnectAgent(c.proxy) } : {}) }); }
  catch (e) { c.error = e.message; return retry(c); }
  c.ws = ws;
  const send = o => { try { ws.readyState === 1 && ws.send(JSON.stringify(o)); } catch {} };
  c.send = send;
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.s != null) c.seq = m.s;
    if (m.op === 10) {            // hello: пульс и представление
      clearInterval(c.hb);
      c.hb = setInterval(() => send({ op: 1, d: c.seq ?? null }), m.d.heartbeat_interval);
      c.hb.unref?.();
      if (c.resume?.session) send({ op: 6, d: { token: c.token, session_id: c.resume.session, seq: c.seq ?? null } });
      else send({ op: 2, d: { token: c.token, intents: 0, properties: { os: 'linux', browser: 'horizoncraft', device: 'horizoncraft' }, presence: payload(c.presence) } });
    } else if (m.op === 0 && m.t === 'READY') {
      c.resume = { session: m.d.session_id, url: m.d.resume_gateway_url };
      c.state = 'online'; c.error = ''; c.fails = 0; c.sent = c.presence;
    } else if (m.op === 0 && m.t === 'RESUMED') { c.state = 'online'; c.error = ''; c.fails = 0; }
    else if (m.op === 1) send({ op: 1, d: c.seq ?? null });
    else if (m.op === 7) ws.close(4000);
    else if (m.op === 9) { if (!m.d) c.resume = null; ws.close(4000); }
  });
  ws.on('error', e => { c.error = c.proxy ? 'Нет связи со шлюзом Discord через VLESS' : 'Нет связи со шлюзом Discord'; c.detail = e.message; });
  ws.on('close', code => {
    clearInterval(c.hb);
    if (c.ws !== ws) return;
    c.state = 'off';
    if (code === 4004) { c.error = 'Discord не принял токен бота'; c.fatal = true; c.fatalAt = Date.now(); return; }
    if ([4010, 4011, 4012, 4013, 4014].includes(code)) { c.error = 'Discord отклонил подключение бота (код ' + code + ')'; c.fatal = true; c.fatalAt = Date.now(); return; }
    if ([4007, 4009].includes(code)) c.resume = null;
    retry(c);
  });
}
function retry(c) {
  if (c.closed) return;
  c.fails = (c.fails || 0) + 1;
  c.timer = setTimeout(() => open(c), Math.min(60000, 3000 * c.fails));
  c.timer.unref?.();
}

/** Держит подключение для токена и обновляет статус. presence: { status, type, text }, proxy: 'хост:порт' или ''. */
export function ensure(token, presence, proxy = '') {
  let c = conns.get(token);
  if (c && (c.proxy !== proxy || (c.fatal && Date.now() - c.fatalAt > 600e3))) { drop(token); c = null; }
  if (c?.fatal) return;   // токен отклонён: повторяем не чаще раза в 10 минут
  if (!c) {
    c = { token, presence, proxy, state: 'connecting', error: '' };
    conns.set(token, c);
    open(c);
    return;
  }
  c.presence = presence;
  if (c.state === 'online' && !same(c.sent, presence) && !(Date.now() - (c.sentAt || 0) < 15000)) {
    c.send({ op: 3, d: payload(presence) });
    c.sent = presence; c.sentAt = Date.now();
  }
}
export function drop(token) {
  const c = conns.get(token);
  if (!c) return;
  c.closed = true;
  clearTimeout(c.timer); clearInterval(c.hb);
  try { c.ws?.close(1000); } catch {}
  conns.delete(token);
}
/** Оставляет только подключения для перечисленных токенов. */
export function keep(tokens) { for (const t of [...conns.keys()]) if (!tokens.has(t)) drop(t); }
export function status(token) {
  const c = conns.get(token);
  return c ? { state: c.state, error: c.state === 'online' ? '' : c.error || '' } : { state: 'off', error: '' };
}

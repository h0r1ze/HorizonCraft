import express from 'express';
import cookieParser from 'cookie-parser';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { PassThrough } from 'stream';
import { WebSocketServer } from 'ws';
import bcrypt from 'bcryptjs';
import * as store from './store.js';
import * as dk from './dock.js';
import { createRouter, verify } from './routes.js';
import { startServices } from './services.js';
import { cleanupOld } from './importer.js';
import { migrate as migrateProxy } from './proxy.js';
import { probeCurseForge, searchState } from './net.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

store.load();
migrateProxy();
if (!store.get().user && process.env.ADMIN_PASSWORD) {
  store.get().user = { hash: bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10) };
  store.save();
  console.log('Создан администратор');
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));
app.use(cookieParser());
app.get('/vendor/htm-preact.js', (req, res) =>
  res.sendFile(path.join(root, 'node_modules/htm/preact/standalone.module.js')));
app.use('/api', createRouter());
app.use(express.static(path.join(root, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const m = /^\/ws\/servers\/([a-f0-9]{8})\/console$/.exec((req.url || '').split('?')[0]);
  const tok = /(?:^|;\s*)mcp_token=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  try {
    if (!m || !tok) throw new Error('no');
    verify(tok);
    if (!store.get().servers.some(s => s.id === m[1])) throw new Error('no');
  } catch { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
  wss.handleUpgrade(req, socket, head, ws => consoleSession(ws, m[1]));
});

async function consoleSession(ws, id) {
  const send = o => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
  let stream;
  try {
    stream = await dk.docker.getContainer(dk.cname(id)).logs({ follow: true, stdout: true, stderr: true, tail: 300 });
  } catch (e) {
    send({ type: 'info', data: 'Контейнер ещё не создан. Запустите сервер.' });
    return ws.close();
  }
  const out = new PassThrough();
  dk.docker.modem.demuxStream(stream, out, out);
  out.on('data', d => send({ type: 'log', data: d.toString('utf8') }));
  stream.on('end', () => { send({ type: 'end' }); ws.close(); });
  stream.on('error', () => ws.close());
  ws.on('close', () => { try { stream.destroy(); } catch {} });
  ws.on('message', async raw => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.type !== 'cmd' || typeof m.data !== 'string') return;
    const cmd = m.data.replace(/[\r\n]/g, ' ').trim();
    if (!cmd) return;
    try { send({ type: 'resp', data: (await dk.rcon(id, cmd)) || '(нет ответа)' }); }
    catch (e) { send({ type: 'resp', data: 'Ошибка: ' + e.message }); }
  });
}

const port = process.env.PORT || 8088;
server.listen(port, () => console.log('HorizonCraft слушает порт ' + port));

dk.joinNetwork().then(() => dk.syncProxy()).catch(e => console.error('network', e.message));
dk.ensureImage(`${dk.IMG}:latest`).catch(e => console.error('pull', e.message));
dk.syncRouter().catch(e => console.error('router', e.message));
// значки серверов для списка в игре готовы заранее, к следующему запуску
for (const c of store.get().servers) dk.syncIcon(c);
startServices();
cleanupOld();

// Для уже сохранённого ключа выясняем, доступен ли поиск CurseForge.
(async () => {
  const s = store.get().settings;
  if (!s.cfApiKey) return;
  try {
    s.cfSearchOk = searchState(await probeCurseForge(s.cfApiKey));
    s.cfCheckedAt = Date.now();
    store.save();
  } catch {}
})();

import http from 'http';
import os from 'os';

/* Способы ответить на проверку http-01.
   - inProcess: отвечает сама панель (для тестов и для случая, когда панель слушает нужный порт).
   - container: временный контейнер из образа панели с публикацией порта хоста (80 по умолчанию). */

const sleep = ms => new Promise(r => setTimeout(r, ms));
const bad = m => Object.assign(new Error(m), { status: 400 });

export function inProcess({ port = 80, host } = {}) {
  const tokens = new Map();
  let srv = null;
  const ensure = () => new Promise((resolve, reject) => {
    if (srv) return resolve();
    srv = http.createServer((req, res) => {
      const m = /^\/\.well-known\/acme-challenge\/([A-Za-z0-9_-]+)$/.exec((req.url || '').split('?')[0]);
      if (m && tokens.has(m[1])) { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(tokens.get(m[1])); }
      res.writeHead(404); res.end();
    });
    srv.once('error', e => { srv = null; reject(bad(e.code === 'EADDRINUSE' ? `Порт ${port} занят другой программой, Let's Encrypt не сможет подтвердить адрес.` : e.message)); });
    (host ? srv.listen(port, host, resolve) : srv.listen(port, resolve));
  });
  return {
    type: 'http-01',
    async present({ token, keyAuth }) {
      await ensure(); tokens.set(token, keyAuth);
      return async () => { tokens.delete(token); if (!tokens.size && srv) { const s = srv; srv = null; await new Promise(r => s.close(r)); } };
    },
  };
}

/** Образ, из которого запущена сама панель (в нём есть responder.js). */
export async function ownImage(docker) {
  try { return (await docker.getContainer(os.hostname()).inspect()).Config.Image; } catch { return 'horizoncraft:latest'; }
}

export function container(docker, { hostPort = 80, image } = {}) {
  return {
    type: 'http-01',
    async present({ token, keyAuth }) {
      const img = image || await ownImage(docker);
      const name = `hc-acme-${Math.random().toString(16).slice(2, 10)}`;
      const c = await docker.createContainer({
        name, Image: img, Cmd: ['node', 'server/tls/responder.js'], Labels: { 'horizoncraft.role': 'acme-responder' },
        Env: [`CHALLENGES=${JSON.stringify({ [token]: keyAuth })}`, 'PORT=8080', 'TTL=300'],
        ExposedPorts: { '8080/tcp': {} },
        HostConfig: { PortBindings: { '8080/tcp': [{ HostPort: String(hostPort) }] }, AutoRemove: false, RestartPolicy: { Name: 'no' }, Memory: 64 * 1024 * 1024 },
      });
      const cleanup = async () => { try { await c.remove({ force: true }); } catch {} };
      try { await c.start(); }
      catch (e) {
        await cleanup();
        if (/port is already allocated|address already in use|bind/i.test(e.message || '')) throw bad(`Порт ${hostPort} на этом компьютере занят другой программой, Let's Encrypt не сможет подтвердить адрес. Освободите порт ${hostPort} или выберите самоподписанный сертификат.`);
        throw e;
      }
      // ждём, пока ответчик запустится
      let ready = false;
      for (let i = 0; i < 40 && !ready; i++) {
        await sleep(250);
        const st = await c.inspect().catch(() => null);
        if (!st?.State?.Running) break;
        const logs = await c.logs({ stdout: true, stderr: true, tail: 5 }).catch(() => Buffer.alloc(0));
        ready = /READY/.test(Buffer.isBuffer(logs) ? logs.toString('utf8') : String(logs));
      }
      if (!ready) { await cleanup(); throw bad('Временный ответчик для проверки адреса не запустился'); }
      return cleanup;
    },
  };
}

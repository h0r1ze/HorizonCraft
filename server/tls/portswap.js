/* Вспомогательный контейнер для смены порта панели. Запускается панелью из её же образа:
     node server/tls/portswap.js
   Панель не может поменять проброс порта у самой себя, поэтому этот процесс: останавливает контейнер панели, создаёт его копию
   с новым портом, запускает и ждёт ответа. Если что-то пошло не так (порт занят, панель не поднялась), возвращает старый
   контейнер и старый порт. Итог записывается в DATA_DIR/tls/portchange.json, его читает панель.
   Переменные: SELF (id контейнера панели), NEW_PORT, DATA_DIR. */
import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { pathToFileURL } from 'url';
import { recreateSpec, envWithPort, INNER_PORT } from './portspec.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function probe(host, port) {
  return new Promise(res => {
    const done = v => { clearTimeout(t); res(v); };
    const t = setTimeout(() => done(false), 3000);
    const tryOne = mod => new Promise(r => {
      const q = mod.request({ host, port, path: '/api/me', method: 'GET', agent: false, rejectUnauthorized: false, timeout: 2500 }, s => { s.resume(); r(true); });
      q.on('error', () => r(false)); q.on('timeout', () => { q.destroy(); r(false); }); q.end();
    });
    tryOne(https).then(ok => ok ? done(true) : tryOne(http).then(done));
  });
}

export async function run({ docker, self, newPort, dataDir, log = console.log, readyTries = 60, resultFile = '' }) {
  const result = { ok: false, port: newPort, at: Date.now(), error: '' };
  const file = resultFile || path.join(dataDir, 'tls', 'portchange.json');
  const write = () => { try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(result)); } catch (e) { log('не удалось записать итог: ' + e.message); } };
  const old = docker.getContainer(self);
  let info;
  try { info = await old.inspect(); } catch (e) { result.error = 'Не удалось найти контейнер панели: ' + e.message; write(); return result; }
  const name = info.Name.replace(/^\//, '');
  const oldPort = Number((info.HostConfig?.PortBindings?.[`${INNER_PORT}/tcp`] || [])[0]?.HostPort) || 0;
  result.oldPort = oldPort;
  const spec = recreateSpec(info, newPort);
  const extra = spec.extraNetworks; delete spec.extraNetworks;
  const tmp = `${name}-old-${Date.now().toString(36)}`;
  let fresh = null, stopped = false, renamed = false;
  const rollback = async why => {
    result.error = why;
    log('откат: ' + why);
    try { if (fresh) await fresh.remove({ force: true }); } catch (e) { log('не удалось убрать новый контейнер: ' + e.message); }
    try { if (renamed) await old.rename({ name }); } catch (e) { log('не удалось вернуть имя: ' + e.message); }
    try { if (stopped) await old.start(); } catch (e) { log('не удалось запустить старый контейнер: ' + e.message); result.error += ' Старый контейнер не запустился, запустите его командой: docker start ' + name; }
    write(); return result;
  };
  try {
    log(`остановка ${name}`);
    await old.stop({ t: 15 }); stopped = true;
    await old.rename({ name: tmp }); renamed = true;
    log(`создание ${name} с портом ${newPort}`);
    fresh = await docker.createContainer({ ...spec, name });
    for (const n of extra) { try { await docker.getNetwork(n.name).connect({ Container: fresh.id, EndpointConfig: { Aliases: n.Aliases } }); } catch (e) { log('сеть ' + n.name + ': ' + e.message); } }
    try { await fresh.start(); }
    catch (e) { return await rollback(/already allocated|address already in use|bind/i.test(e.message || '') ? `Порт ${newPort} на этом компьютере занят другой программой.` : 'Новый контейнер не запустился: ' + e.message); }
    // ждём настоящего ответа панели по адресу контейнера внутри сети Docker
    let ready = false;
    for (let i = 0; i < readyTries && !ready; i++) {
      await sleep(1000);
      const st = await fresh.inspect().catch(() => null);
      if (!st?.State?.Running) return await rollback('Панель на новом порту не запустилась.');
      const net = Object.values(st.NetworkSettings?.Networks || {}).find(n => n.IPAddress);
      ready = net ? await probe(net.IPAddress, INNER_PORT) : i >= 4;
    }
    if (!ready) return await rollback('Панель на новом порту не ответила вовремя.');
  } catch (e) { return await rollback('Не удалось пересоздать контейнер панели: ' + e.message); }
  // успех: убираем старый контейнер и записываем порт в .env рядом с docker-compose.yml, чтобы ./set-port.sh и compose знали о нём
  try { await old.remove({ force: true }); } catch (e) { log('старый контейнер не удалён: ' + e.message); }
  const dir = info.Config?.Labels?.['com.docker.compose.project.working_dir'];
  if (dir) {
    try { const f = path.join(dir, '.env'); if (fs.existsSync(f)) { fs.writeFileSync(f, envWithPort(fs.readFileSync(f, 'utf8'), newPort)); log('.env обновлён'); } }
    catch (e) { log('.env не обновлён: ' + e.message); result.envError = e.message; }
  }
  result.ok = true; result.error = ''; write();
  log(`готово: порт панели ${newPort}`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { default: Docker } = await import('dockerode');
  const docker = new Docker({ socketPath: '/var/run/docker.sock' });
  const { SELF, NEW_PORT, DATA_DIR } = process.env;
  await sleep(1500);                                     // даём панели доотправить ответ браузеру
  const r = await run({ docker, self: SELF, newPort: Number(NEW_PORT), dataDir: DATA_DIR });
  process.exit(r.ok ? 0 : 1);
}

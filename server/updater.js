/* Вспомогательный контейнер обновления панели. Запускается панелью из её же образа:
     node server/updater.js
   Скачивает код с GitHub, собирает новый образ под тем же именем, пересоздаёт контейнер панели (как при смене порта)
   и ждёт, пока новая версия ответит. Если сборка или запуск не удались, возвращает прежний образ и прежний контейнер.
   Ход и итог записываются в DATA_DIR/update/status.json, установленная версия — в DATA_DIR/update/installed.json.
   Переменные: SELF (id контейнера панели), DATA_DIR, SHA, TARBALL (адрес архива), FROM_VERSION, DL_PROXY (необязательно). */
import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { pathToFileURL } from 'url';
import { run as swap } from './tls/portswap.js';
import { INNER_PORT } from './tls/portspec.js';

const FILES = ['Dockerfile', 'package.json', 'server', 'public'];

/** Имя образа без тега и тег: «horizoncraft:latest» → ['horizoncraft', 'latest']. */
export function splitRef(ref) {
  const s = String(ref || ''), i = s.lastIndexOf(':');
  return i > s.lastIndexOf('/') ? [s.slice(0, i), s.slice(i + 1)] : [s, 'latest'];
}

async function download(url, proxy) {
  let dispatcher;
  if (proxy) { const { ProxyAgent } = await import('undici'); dispatcher = new ProxyAgent({ uri: `http://${proxy}` }); }
  const { fetch: f } = await import('undici');
  const r = await f(url, { redirect: 'follow', signal: AbortSignal.timeout(120e3), headers: { 'User-Agent': 'HorizonCraft-updater' }, ...(dispatcher ? { dispatcher } : {}) });
  if (!r.ok) throw new Error(`GitHub ответил ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

export async function update({ docker, self, dataDir, tarball, sha, from = '', proxy = '', log = console.log, readyTries = 90, fetchCode = download }) {
  const dir = path.join(dataDir, 'update');
  fs.mkdirSync(dir, { recursive: true });
  const st = { state: 'running', step: '', at: Date.now(), sha, from, version: '', error: '' };
  const save = o => { Object.assign(st, o, { at: Date.now() }); try { fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(st)); } catch (e) { log('статус не записан: ' + e.message); } };
  const fail = e => { log('ошибка: ' + e); save({ state: 'error', step: '', error: e }); return st; };
  const work = path.join(dir, 'src'), tgz = path.join(dir, 'src.tgz');
  const clean = () => { fs.rmSync(work, { recursive: true, force: true }); fs.rmSync(tgz, { force: true }); };

  const info = await docker.getContainer(self).inspect().catch(() => null);
  if (!info) return fail('Не удалось найти контейнер панели');
  const image = info.Config.Image, oldImage = info.Image;
  const port = Number((info.HostConfig?.PortBindings?.[`${INNER_PORT}/tcp`] || [])[0]?.HostPort) || 0;
  if (!port) return fail('У контейнера панели нет проброса порта, обновите её командой ./update.sh');

  // 1. код с GitHub
  save({ step: 'Скачивание с GitHub…' });
  try {
    clean(); fs.mkdirSync(work, { recursive: true });
    fs.writeFileSync(tgz, await fetchCode(tarball, proxy));
  } catch (e) { clean(); return fail('Не удалось скачать обновление: ' + (e.cause?.code || e.message)); }
  const x = spawnSync('tar', ['-xzf', tgz, '-C', work, '--strip-components=1']);
  if (x.status !== 0) { clean(); return fail('Архив обновления повреждён'); }
  for (const f of FILES) if (!fs.existsSync(path.join(work, f))) { clean(); return fail('В архиве обновления нет ' + f); }
  let version = '';
  try { version = JSON.parse(fs.readFileSync(path.join(work, 'package.json'), 'utf8')).version || ''; } catch {}
  save({ version });

  // 2. новый образ под тем же именем; прежний остаётся по id для отката
  save({ step: 'Сборка новой версии…' });
  try {
    const ctx = spawn('tar', ['-c', '-C', work, ...FILES]);
    const stream = await docker.buildImage(ctx.stdout, { t: image, rm: true, forcerm: true });
    const out = await new Promise((res, rej) => docker.modem.followProgress(stream, (e, o) => (e ? rej(e) : res(o))));
    const err = out.find(o => o.error || o.errorDetail);
    if (err) throw new Error(String(err.error || err.errorDetail?.message).slice(0, 400));
  } catch (e) {
    const [repo, tag] = splitRef(image);
    await docker.getImage(oldImage).tag({ repo, tag }).catch(() => {});
    clean(); return fail('Сборка новой версии не удалась: ' + e.message);
  }

  // 3. пересоздание контейнера панели с новым образом; при неудаче портswap сам вернёт прежний контейнер
  save({ step: 'Перезапуск панели…' });
  const r = await swap({ docker, self, newPort: port, dataDir, log, readyTries, resultFile: path.join(dir, 'swap.json') });
  if (!r.ok) {
    const [repo, tag] = splitRef(image);
    await docker.getImage(oldImage).tag({ repo, tag }).catch(e => log('прежний образ не возвращён: ' + e.message));
    // сообщения смены порта про «новый порт» здесь только запутают: порт тот же, не поднялась сама версия
    const why = /на новом порту/.test(r.error || '') ? '' : ' ' + r.error;
    clean(); return fail('Новая версия не запустилась, панель возвращена к прежней.' + why);
  }

  // 4. код рядом с docker-compose.yml: чтобы ./update.sh и docker compose собирали ту же версию
  const cdir = info.Config?.Labels?.['com.docker.compose.project.working_dir'];
  if (cdir && fs.existsSync(path.join(cdir, 'docker-compose.yml'))) {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      spawnSync('tar', ['-czf', path.join(dir, `code-before-${stamp}.tgz`), '-C', cdir, ...FILES.filter(f => fs.existsSync(path.join(cdir, f)))]);
      for (const f of FILES) { fs.rmSync(path.join(cdir, f), { recursive: true, force: true }); fs.cpSync(path.join(work, f), path.join(cdir, f), { recursive: true }); }
      log('код обновлён в ' + cdir);
    } catch (e) { log('код рядом с docker-compose.yml не обновлён: ' + e.message); st.codeError = e.message; }
  }
  if (oldImage) await docker.getImage(oldImage).remove().catch(() => {});   // прежний образ больше не нужен
  fs.writeFileSync(path.join(dir, 'installed.json'), JSON.stringify({ sha, version, at: Date.now() }));
  clean();
  save({ state: 'ok', step: '' });
  log(`готово: версия ${version}`);
  return st;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { default: Docker } = await import('dockerode');
  const docker = new Docker({ socketPath: '/var/run/docker.sock' });
  const { SELF, DATA_DIR, SHA, TARBALL, FROM_VERSION, DL_PROXY } = process.env;
  await new Promise(r => setTimeout(r, 1500));   // даём панели доотправить ответ браузеру
  const r = await update({ docker, self: SELF, dataDir: DATA_DIR, tarball: TARBALL, sha: SHA, from: FROM_VERSION, proxy: DL_PROXY });
  process.exit(r.state === 'ok' ? 0 : 1);
}

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import * as dk from './dock.js';
import * as imp from './importer.js';

/* Передача серверов между машинами и шаблоны: упаковка папки сервера в поток tar.gz и приём такого потока.
   Принятые данные распаковываются в служебную папку (как при импорте архива) и становятся сервером
   только после «finish», поэтому оборванная передача ничего не оставляет в списке серверов. */

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });

export const TOKEN_RE = /^[a-f0-9]{16}$/;
export const DIR_RE = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_BYTES = 30 * 1024 ** 3;
const SKIP = ['./logs', './cache', './.cache'];

/** Поток tar.gz папки сервера. dirs: упаковать только эти папки верхнего уровня. null, если упаковывать нечего. */
export function exportStream(id, { dirs, exclude = [] } = {}) {
  const base = dk.serverDir(id);
  let items = ['.'];
  if (dirs) {
    items = dirs.filter(d => DIR_RE.test(d) && fs.existsSync(path.join(base, d))).map(d => './' + d);
    if (!items.length) return null;
  } else if (!fs.existsSync(base)) return null;
  const args = ['-czf', '-', ...[...SKIP, ...exclude].map(e => '--exclude=' + e), '-C', base, ...items];
  const p = spawn('tar', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  p.stderr.on('data', d => { if (err.length < 2000) err += d; });
  p.on('error', e => p.stdout.destroy(e));
  // Код 1 у tar означает «файл менялся во время чтения»: для живого мира это допустимо.
  const done = new Promise(ok => p.on('close', code => ok({ ok: code === 0 || code === 1, code, err })));
  return { stream: p.stdout, kill: () => { try { p.kill(); } catch {} }, done };
}

/** Считает байты, проходящие через поток. */
export function counter(onBytes) {
  return new Transform({ transform(chunk, _, cb) { onBytes(chunk.length); cb(null, chunk); } });
}

const stageDir = token => {
  if (!TOKEN_RE.test(String(token))) throw bad('Недопустимый идентификатор');
  return path.join(imp.IMPORT_DIR, token);
};

/** Создаёт служебную папку приёма и сохраняет в ней описание сервера. Возвращает токен. */
export function begin(config) {
  imp.cleanupOld();
  const token = crypto.randomBytes(8).toString('hex');
  const dir = path.join(imp.IMPORT_DIR, token);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
  return token;
}

/** Принимает поток tar.gz, проверяет архив и распаковывает его. */
export async function receive(token, readable) {
  const dir = stageDir(token);
  if (!fs.existsSync(path.join(dir, 'config.json'))) throw bad('Передача не найдена или устарела', 404);
  const file = path.join(dir, 'upload.bin');
  let n = 0;
  const cap = counter(len => { n += len; if (n > MAX_BYTES) cap.destroy(new Error('Данные больше 30 ГБ')); });
  try {
    await pipeline(readable, cap, fs.createWriteStream(file));
    const info = await imp.inspect(file);
    imp.checkSpace(info.total, dir);
    await imp.extract(file, info.kind, path.join(dir, 'root'));
    fs.rmSync(file, { force: true });
    return { files: info.count, bytes: n };
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e.status ? e : bad(e.message || 'Не удалось принять данные');
  }
}

/** Читает описание и каталог с данными для создания сервера. */
export function staged(token) {
  const dir = stageDir(token);
  const cf = path.join(dir, 'config.json');
  if (!fs.existsSync(cf)) throw bad('Передача не найдена или устарела. Начните заново.', 404);
  const root = path.join(dir, 'root');
  return { dir, root: fs.existsSync(root) ? root : null, config: JSON.parse(fs.readFileSync(cf, 'utf8')) };
}

export function discard(token) {
  try { fs.rmSync(stageDir(token), { recursive: true, force: true }); } catch {}
}

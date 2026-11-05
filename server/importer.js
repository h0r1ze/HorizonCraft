import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import * as dk from './dock.js';
import { detect } from './detect.js';

export const IMPORT_DIR = path.join(dk.DATA_DIR, 'imports');
const MAX_BYTES = 30 * 1024 ** 3;
const GB = 1024 ** 3;

function exec(cmd, args, { collect = false, cap = 64e6 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', collect ? 'pipe' : 'ignore', 'pipe'] });
    let out = '', err = '', over = false;
    if (collect) p.stdout.on('data', d => { if (out.length < cap) out += d; else over = true; });
    p.stderr.on('data', d => { if (err.length < 4000) err += d; });
    p.on('error', reject);
    p.on('close', code => resolve({ code, out, err, over }));
  });
}

export function kindOf(file) {
  const fd = fs.openSync(file, 'r');
  const b = Buffer.alloc(264);
  const n = fs.readSync(fd, b, 0, 264, 0);
  fs.closeSync(fd);
  if (n >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5)) return 'zip';
  if (n >= 2 && b[0] === 0x1f && b[1] === 0x8b) return 'tgz';
  if (n >= 262 && b.toString('latin1', 257, 262) === 'ustar') return 'tar';
  return null;
}

const unsafe = n => /^([\\/]|[A-Za-z]:)/.test(n) || n.split(/[\\/]/).includes('..');
export const PLAIN_DIRS = ['mods', 'config', 'world', 'plugins', 'libraries', 'logs', 'defaultconfigs', 'versions', 'datapacks', 'resourcepacks'];

/** Проверяет архив и возвращает сведения о нём. Бросает ошибку, если архив небезопасен. */
export async function inspect(file) {
  const kind = kindOf(file);
  if (!kind) throw new Error('Поддерживаются архивы .zip, .tar.gz и .tgz. Форматы 7z и rar распакуйте на ПК.');
  const list = kind === 'zip'
    ? await exec('unzip', ['-Z1', file], { collect: true })
    : await exec('tar', [kind === 'tgz' ? '-tzf' : '-tf', file], { collect: true });
  if (list.code !== 0 && !(kind === 'zip' && list.code === 1)) {
    if (/End-of-central-directory|unexpected end|premature end/i.test(list.err + list.out)) {
      throw new Error('Архив обрезан: файл загружен или скачан не полностью. Загрузите его заново.');
    }
    throw new Error('Архив повреждён или не читается.');
  }
  if (list.over) throw new Error('В архиве слишком много файлов.');
  const names = list.out.split('\n').map(s => s.replace(/\r$/, '')).filter(Boolean);
  const bad = names.find(unsafe);
  if (bad) throw new Error(`Архив содержит небезопасный путь «${bad.slice(0, 80)}».`);

  // Ссылки в архиве могут вывести запись за пределы папки, поэтому такие архивы не принимаем.
  const verbose = kind === 'zip'
    ? await exec('unzip', ['-Z', file], { collect: true })
    : await exec('tar', [kind === 'tgz' ? '-tvzf' : '-tvf', file], { collect: true });
  if (verbose.out.split('\n').some(l => /^[lh]/.test(l))) {
    throw new Error('Архив содержит символические ссылки. Из соображений безопасности такие архивы не принимаются.');
  }

  let total = null;
  if (kind === 'zip') {
    const z = await exec('unzip', ['-Zt', file], { collect: true });
    const m = /(\d+) files?, (\d+) bytes uncompressed/.exec(z.out);
    if (m) total = +m[2];
  } else total = fs.statSync(file).size * 4;

  const top = [...new Set(names.map(n => n.split(/[\\/]/)[0]))].filter(n => n && n !== '__MACOSX');
  const singleRoot = top.length === 1 && names.some(n => n.startsWith(top[0] + '/')) ? top[0] : null;
  return { kind, count: names.length, total, top, singleRoot };
}

export function checkSpace(total, where) {
  if (total && total > MAX_BYTES) throw new Error('Содержимое архива больше 30 ГБ.');
  try {
    const s = fs.statfsSync(where);
    const free = s.bavail * s.bsize;
    if (total && free < total + GB) {
      throw new Error(`Не хватает места на диске: нужно около ${(total / GB).toFixed(1)} ГБ, свободно ${(free / GB).toFixed(1)} ГБ.`);
    }
  } catch (e) { if (/места/.test(e.message)) throw e; }
}

export async function chown(dir) { await exec('chown', ['-R', '1000:1000', dir]); }

export async function extract(file, kind, target) {
  fs.mkdirSync(target, { recursive: true });
  const r = kind === 'zip'
    ? await exec('unzip', ['-q', '-o', file, '-d', target])
    : await exec('tar', [kind === 'tgz' ? '-xzf' : '-xf', file, '-C', target]);
  if (r.code !== 0 && !(kind === 'zip' && r.code === 1)) throw new Error('Не удалось распаковать архив: ' + r.err.slice(0, 200));
  await exec('find', [target, '-type', 'l', '-delete']);
  fs.rmSync(path.join(target, '__MACOSX'), { recursive: true, force: true });
}

/* ---------- загрузка готового сервера ---------- */
function descend(dir) {
  for (let i = 0; i < 3; i++) {
    const e = fs.readdirSync(dir).filter(n => n !== '__MACOSX');
    if (e.length === 1 && !PLAIN_DIRS.includes(e[0]) && fs.statSync(path.join(dir, e[0])).isDirectory()) dir = path.join(dir, e[0]);
    else break;
  }
  return dir;
}

async function dirBytes(dir) {
  const r = await exec('du', ['-sk', dir], { collect: true });
  return (parseInt(r.out) || 0) * 1024;
}

export function cleanupOld() {
  try {
    for (const n of fs.readdirSync(IMPORT_DIR)) {
      const p = path.join(IMPORT_DIR, n);
      if (Date.now() - fs.statSync(p).mtimeMs > 24 * 3600e3) fs.rmSync(p, { recursive: true, force: true });
    }
  } catch {}
}

export async function analyzeUpload(dir) {
  const file = path.join(dir, 'upload.bin');
  const info = await inspect(file);
  checkSpace(info.total, dir);
  const target = path.join(dir, 'root');
  await extract(file, info.kind, target);
  fs.rmSync(file, { force: true });
  const root = descend(target);
  const det = detect(root);
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ root: path.relative(dir, root) }));
  return { ...det, sizeBytes: await dirBytes(root), files: info.count };
}

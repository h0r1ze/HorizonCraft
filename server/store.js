import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DATA_DIR = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA_DIR, 'panel.json');
let db;

export function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { db = {}; }
  db.servers ??= [];
  db.settings ??= {};
  db.secret ??= crypto.randomBytes(32).toString('hex');
  db.user ??= null;
  save();
  return db;
}
export const get = () => db;
export function save() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE);
}

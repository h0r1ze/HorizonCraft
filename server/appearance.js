import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import express from 'express';
import sharp from 'sharp';
import * as store from './store.js';
import { DATA_DIR } from './dock.js';

/* Оформление панели: последняя выбранная тема, картинки для фона и привязка картинок к темам. Всё хранится на сервере,
   поэтому выбор сохраняется между браузерами и устройствами. Картинки уменьшаются до 2560x1440 и сохраняются в WebP,
   рядом лежит миниатюра для выбора. Для каждой картинки считается краткое описание цвета (преобладающие оттенки,
   насыщенность, светлота): по нему браузер подбирает картинки темам, пока администратор не выбрал свои.
   Доступ только после входа, ссылки на файлы содержат случайный id и не меняются. */

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
const DIR = path.join(DATA_DIR, 'backgrounds');
export const LIMITS = { images: 12, mb: 16, dim: [0, 90], blur: [0, 24] };
export const DEFAULTS = { dim: 35, blur: 6 };
const ID = /^[0-9a-f]{12}$/;
const THEME = /^[a-z0-9-]{1,24}$/;
const file = (id, thumb) => path.join(DIR, `${id}${thumb ? '.thumb' : ''}.webp`);

function state() {
  const db = store.get();
  const a = (db.appearance ??= {});
  a.theme ??= '';
  a.images ??= [];
  a.auto ??= true;
  a.bindings ??= {};
  // старый формат: один общий фон. Он становится привязкой к теме, которая была выбрана
  if (a.bg) {
    if (a.bg.id && a.images.some(i => i.id === a.bg.id) && THEME.test(a.theme)) a.bindings[a.theme] ??= { id: a.bg.id, dim: a.bg.dim ?? DEFAULTS.dim, blur: a.bg.blur ?? DEFAULTS.blur };
    delete a.bg;
    store.save();
  }
  return a;
}
const pub = a => ({
  theme: a.theme, auto: a.auto, bindings: a.bindings, limits: LIMITS, defaults: DEFAULTS,
  images: a.images.map(({ id, name, bytes, w, h, at, hues, vivid, lum }) => ({ id, name, bytes, w, h, at, hues, vivid, lum })),
});
const cleanName = s => String(s || '').replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[\u0000-\u001f\u007f<>"'`\\/]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);

/** Краткое описание цвета картинки: до двух преобладающих оттенков, насыщенность и светлота. */
export async function describe(buf) {
  const { data, info } = await sharp(buf).resize(48, 27, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const bins = new Array(36).fill(0), n = info.width * info.height;
  let vivid = 0, lum = 0;
  for (let i = 0; i < n; i++) {
    const r = data[i * 3] / 255, g = data[i * 3 + 1] / 255, b = data[i * 3 + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = ((h * 60) + 360) % 360;
    const w = (mx ? d / mx : 0) * mx;
    lum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    vivid += w; bins[Math.floor(h / 10) % 36] += w * w;
  }
  vivid /= n; lum /= n;
  const sm = bins.map((_, i) => bins[(i + 35) % 36] * 0.5 + bins[i] + bins[(i + 1) % 36] * 0.5);
  let bi = 0; sm.forEach((v, i) => { if (v > sm[bi]) bi = i; });
  const hues = [];
  if (vivid >= 0.06) {
    hues.push(bi * 10 + 5);
    let b2 = -1;
    sm.forEach((v, i) => { const d = Math.min(Math.abs(i - bi), 36 - Math.abs(i - bi)); if (d >= 6 && v >= sm[bi] * 0.35 && (b2 < 0 || v > sm[b2])) b2 = i; });
    if (b2 >= 0) hues.push(b2 * 10 + 5);
  }
  return { hues, vivid: +vivid.toFixed(3), lum: +lum.toFixed(3) };
}
/** Картинки, загруженные до появления описания цвета, описываются по миниатюре при первом обращении. */
async function ensureStats(a) {
  let changed = false;
  for (const i of a.images) {
    if (i.lum !== undefined) continue;
    try { Object.assign(i, await describe(fs.readFileSync(file(i.id, true)))); changed = true; } catch {}
  }
  if (changed) store.save();
}

const setting = (x, base = {}) => {
  const out = { id: 'id' in x ? String(x.id || '') : base.id ?? '', dim: base.dim ?? DEFAULTS.dim, blur: base.blur ?? DEFAULTS.blur };
  for (const [k, label] of [['dim', 'Затемнение'], ['blur', 'Размытие']]) {
    if (!(k in x)) continue;
    const n = Number(x[k]), [lo, hi] = LIMITS[k];
    if (!Number.isInteger(n) || n < lo || n > hi) throw bad(`${label}: от ${lo} до ${hi}`);
    out[k] = n;
  }
  return out;
};

export function register(r, { h }) {
  r.get('/appearance', h(async (req, res) => { const a = state(); await ensureStats(a); res.json(pub(a)); }));

  r.put('/appearance', h(async (req, res) => {
    const a = state(), b = req.body && typeof req.body === 'object' ? req.body : {};
    const known = id => !id || a.images.some(i => i.id === id);
    if ('theme' in b) {
      if (typeof b.theme !== 'string' || !THEME.test(b.theme) && b.theme !== '') throw bad('Недопустимая тема');
      a.theme = b.theme;
    }
    if ('auto' in b) a.auto = !!b.auto;
    // привязка картинки к одной теме: {theme, id ('' = без фона), dim, blur}
    if (b.bind && typeof b.bind === 'object') {
      const t = b.bind.theme;
      if (typeof t !== 'string' || !THEME.test(t)) throw bad('Недопустимая тема');
      const s = setting(b.bind, a.bindings[t]);
      if (!known(s.id)) throw bad('Картинка не найдена', 404);
      a.bindings[t] = s;
    }
    // одна и та же картинка для списка тем
    if (b.bindAll && typeof b.bindAll === 'object') {
      const list = Array.isArray(b.bindAll.themes) ? b.bindAll.themes : [];
      if (!list.length || list.length > 64 || !list.every(t => typeof t === 'string' && THEME.test(t))) throw bad('Недопустимый список тем');
      const s = setting(b.bindAll);
      if (!known(s.id)) throw bad('Картинка не найдена', 404);
      for (const t of list) a.bindings[t] = { ...s };
    }
    // вернуть автоподбор: для одной темы или для всех ('*')
    if ('unbind' in b) {
      if (b.unbind === '*') a.bindings = {};
      else if (typeof b.unbind === 'string' && THEME.test(b.unbind)) delete a.bindings[b.unbind];
      else throw bad('Недопустимая тема');
    }
    store.save();
    await ensureStats(a);
    res.json(pub(a));
  }));

  const rawBody = (req, res, next) => express.raw({ type: () => true, limit: LIMITS.mb + 'mb' })(req, res, err => (err
    ? res.status(err.status || 400).json({ error: err.status === 413 ? `Файл больше ${LIMITS.mb} МБ` : 'Не удалось принять файл' })
    : next()));

  r.post('/backgrounds', rawBody, h(async (req, res) => {
    const a = state(), buf = req.body;
    if (!Buffer.isBuffer(buf) || !buf.length) throw bad('Файл не получен');
    if (a.images.length >= LIMITS.images) throw bad(`Не больше ${LIMITS.images} картинок. Удалите ненужные.`);
    const opts = { limitInputPixels: 80e6, failOn: 'error' };
    let meta;
    try { meta = await sharp(buf, opts).metadata(); } catch { throw bad('Не удалось прочитать изображение'); }
    if (!['jpeg', 'png', 'webp', 'gif', 'avif'].includes(meta.format)) throw bad('Поддерживаются JPEG, PNG, WebP, GIF и AVIF');
    const id = crypto.randomBytes(6).toString('hex');
    fs.mkdirSync(DIR, { recursive: true });
    let info, stats;
    try {
      const base = sharp(buf, opts).rotate();
      info = await base.clone().resize(2560, 1440, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82, effort: 4 }).toFile(file(id));
      await base.clone().resize(480, 270, { fit: 'cover' }).webp({ quality: 72, effort: 4 }).toFile(file(id, true));
      stats = await describe(fs.readFileSync(file(id, true)));
    } catch { fs.rmSync(file(id), { force: true }); fs.rmSync(file(id, true), { force: true }); throw bad('Не удалось обработать изображение'); }
    a.images.push({ id, name: cleanName(req.query.name) || `Картинка ${a.images.length + 1}`, bytes: info.size, w: info.width, h: info.height, at: Date.now(), ...stats });
    store.save();
    res.json({ ...pub(a), id });
  }));

  const send = thumb => (req, res) => {
    const id = req.params.bg;
    if (!ID.test(id) || !state().images.some(i => i.id === id)) return res.status(404).json({ error: 'Картинка не найдена' });
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    res.type('image/webp');
    res.sendFile(file(id, thumb), err => { if (err && !res.headersSent) res.status(404).json({ error: 'Картинка не найдена' }); });
  };
  r.get('/backgrounds/:bg/image', send(false));
  r.get('/backgrounds/:bg/thumb', send(true));

  r.delete('/backgrounds/:bg', h(async (req, res) => {
    const a = state(), id = req.params.bg;
    if (!ID.test(id) || !a.images.some(i => i.id === id)) throw bad('Картинка не найдена', 404);
    a.images = a.images.filter(i => i.id !== id);
    for (const [t, s] of Object.entries(a.bindings)) if (s.id === id) delete a.bindings[t];   // у этих тем снова автоподбор
    fs.rmSync(file(id), { force: true });
    fs.rmSync(file(id, true), { force: true });
    store.save();
    res.json(pub(a));
  }));
}

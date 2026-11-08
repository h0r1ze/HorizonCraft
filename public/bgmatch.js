/* Автоподбор картинки под тему. Сервер описывает каждую картинку числами (hues: до двух преобладающих оттенков 0..360, пусто
   для серых; vivid: насыщенность 0..1; lum: светлота 0..1), клиент сопоставляет их с палитрой темы.
   Чистые функции без зависимостей: работают и в браузере, и в тестах Node. */

export const hexToRgb = h => { const n = parseInt(String(h).replace('#', ''), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
export function rgbToHsv([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h * 60) + 360) % 360, mx ? d / mx : 0, mx];
}
const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** Описание темы для подбора: оттенок акцента, насыщенность и режим. */
export function themeTone(t) {
  const [h, s] = rgbToHsv(hexToRgb(t.sw.accent));
  return { hue: s < 0.18 ? null : h, mode: t.mode };
}

/**
 * Оценка пары «тема — картинка»: чем меньше, тем лучше подходит.
 * Хромные темы сравниваются по оттенку, серые (Графит) тянутся к тёмным малонасыщенным картинкам.
 */
export function score(tone, img) {
  const wantLum = tone.mode === 'dark' ? 0.28 : 0.55, hues = img.hues || (img.hue == null ? [] : [img.hue]);
  let s = 1.2 * Math.abs((img.lum ?? 0.4) - wantLum);
  if (tone.hue === null) s += (hues.length ? 0.35 * Math.min(1, img.vivid * 3) : 0) + 0.2 * Math.abs((img.lum ?? 0.4) - 0.2);
  else if (!hues.length) s += 0.5;
  else s += Math.min(...hues.map(h => hueDist(tone.hue, h))) / 180 * (0.55 + 0.45 * Math.min(1, img.vivid * 3)) + 0.25 * (1 - Math.min(1, img.vivid * 4));
  return s;
}

const REI = /(^|[^a-z])(rei|ayanami)([^a-z]|$)|рей|аянами/i;

/**
 * Подбирает картинку каждой теме. Тёмные темы идут первыми и берут лучшее, занятые картинки получают штраф,
 * поэтому одна фотография не достаётся всем темам. Файлы с «Rei / Рей / Аянами» в названии тянутся к темам Аянами Рей.
 * themes: [{id, mode, sw:{bg, accent}}], images: [{id, name, hue, vivid, lum}]. Возвращает {темаId: картинкаId}.
 */
export function suggest(themes, images) {
  const out = {};
  const usable = images.filter(i => i.lum !== undefined);
  if (!usable.length) return out;
  const used = new Map(usable.map(i => [i.id, 0]));
  // сначала темы Аянами Рей (у них самое сильное предпочтение), затем остальные тёмные, затем светлые
  const rank = t => (/^rei/.test(t.id) ? (t.mode === 'dark' ? 0 : 1) : t.mode === 'dark' ? 2 : 3);
  const order = [...themes].sort((a, b) => rank(a) - rank(b));
  for (const t of order) {
    const tone = themeTone(t), reiTheme = /^rei/.test(t.id);
    let best = null, bs = Infinity;
    for (const img of usable) {
      let s = score(tone, img) + used.get(img.id) * 0.4;
      if (REI.test(img.name || '')) s += reiTheme ? -0.3 : 0.25;
      if (s < bs) { bs = s; best = img; }
    }
    out[t.id] = best.id; used.set(best.id, used.get(best.id) + 1);
  }
  return out;
}

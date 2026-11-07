/* Язык интерфейса: русский (по умолчанию в исходниках) и английский.
   Все тексты в коде написаны по-русски. В английском режиме русский текст переводится по словарю на лету:
   статичные куски шаблонов html`…` переводятся один раз на каждое место в коде, динамические строки (ответы сервера,
   подписи) переводятся при отрисовке. Нет перевода в словаре — остаётся русский текст (его видно в window.__i18nMissing). */

const CYR = /[А-Яа-яЁё]/;
const KEY = 'hc-lang';

export const LANGS = [['ru', 'Русский', 'RU'], ['en', 'English', 'EN']];
export function detectLang() {
  try { const s = localStorage.getItem(KEY); if (s === 'ru' || s === 'en') return s; } catch {}
  return /^ru\b/i.test(navigator.language || '') ? 'ru' : 'en';
}
export const lang = detectLang();
export const isEn = lang === 'en';
export const locale = isEn ? 'en-GB' : 'ru-RU';
document.documentElement.lang = lang;

export function setLang(l) {
  try { localStorage.setItem(KEY, l); } catch {}
  location.reload();
}

const mod = isEn ? await import('./i18n/en.js') : null;
const EN = mod?.EN || {};
const PATTERNS = mod?.PATTERNS || [];
export const missing = new Set();
if (typeof window !== 'undefined') window.__i18nMissing = missing;

const edge = s => [s.match(/^\s*/)[0], s.match(/\s*$/)[0]];

/** Перевод строки целиком: точное совпадение, затем шаблоны с параметрами. Без перевода возвращает исходную строку. */
function find(k, depth = 0) {
  const hit = EN[k];
  if (hit !== undefined) return hit;
  for (const [re, fn] of PATTERNS) {
    const m = re.exec(k);
    if (m) return fn(t, ...m.slice(1));
  }
  // «Название: подробности» (ошибки, статусы, пояснения): переводим обе части отдельно
  const i = k.indexOf(': ');
  if (depth < 2 && i > 0) {
    const left = EN[k.slice(0, i + 1)] ?? EN[k.slice(0, i)] ?? find(k.slice(0, i), depth + 1);
    if (left !== undefined) {
      const rest = k.slice(i + 2);
      // правая часть без перевода (чужой текст, например ответ другой программы) остаётся как есть
      const right = CYR.test(rest) ? (find(rest, depth + 1) ?? (missing.add(rest), rest)) : rest;
      return `${left.replace(/:$/, '')}: ${right}`;
    }
  }
  // «ID проекта…», «LATEST - последняя…», «🟢 Онлайн»: латинский или символьный префикс, дальше русский текст
  const pm = depth < 2 && /^([^А-Яа-яЁё]+)([А-Яа-яЁё].*)$/.exec(k);
  if (pm && pm[1].trim()) {
    const r = find(pm[2], depth + 1);
    if (r !== undefined) return pm[1] + r;
  }
  return undefined;
}

function tr(s) {
  const k = s.trim().replace(/\s+/g, ' ');   // переносы строк и отступы внутри шаблонов не важны
  if (!k) return s;
  const [a, z] = edge(s);
  const out = find(k);
  if (out !== undefined) return a + out + z;
  missing.add(k);
  return s;
}

export function t(s) {
  if (!isEn || typeof s !== 'string' || !CYR.test(s)) return s;
  return tr(s);
}
/** Перевод вложенного фрагмента внутри шаблона (для параметров шаблонов перевода). */
export const tt = t;

/** Переводит статичный кусок шаблона: значения атрибутов и текстовые узлы. */
function trChunk(c) {
  if (!CYR.test(c)) return c;
  c = c.replace(/(=\s*")([^"]*[А-Яа-яЁё][^"]*)(")/g, (m, a, v, z) => a + tr(v) + z);
  return c.replace(/[А-Яа-яЁё][^<>]*/g, run => {
    const k = run.replace(/\s+$/, '');
    return tr(k) + run.slice(k.length);
  });
}

const cache = new WeakMap();
export function trStrings(strings) {
  if (!isEn) return strings;
  let out = cache.get(strings);
  if (!out) {
    out = strings.map(trChunk);
    out.raw = strings.raw;
    cache.set(strings, out);
  }
  return out;
}
export const trVal = v => (isEn && typeof v === 'string' && CYR.test(v) ? tr(v) : v);

/* Склонение: в английском только единственное и множественное число. */
export function pluralOf(n, one, few, many) {
  if (isEn) return Math.abs(n) === 1 ? t(one) : t(many);
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
}

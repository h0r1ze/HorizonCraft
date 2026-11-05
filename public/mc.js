/* Форматирование текста как в Minecraft. Хранится в виде строки с кодами &: «&6&lЗаголовок &r&7текст».
   «&&» означает обычный знак &. Модуль без зависимостей: его используют и браузер, и сервер. */

export const COLORS = [
  ['0', 'black', '#000000', 'Чёрный'], ['1', 'dark_blue', '#0000AA', 'Тёмно-синий'],
  ['2', 'dark_green', '#00AA00', 'Тёмно-зелёный'], ['3', 'dark_aqua', '#00AAAA', 'Тёмно-бирюзовый'],
  ['4', 'dark_red', '#AA0000', 'Тёмно-красный'], ['5', 'dark_purple', '#AA00AA', 'Фиолетовый'],
  ['6', 'gold', '#FFAA00', 'Золотой'], ['7', 'gray', '#AAAAAA', 'Серый'],
  ['8', 'dark_gray', '#555555', 'Тёмно-серый'], ['9', 'blue', '#5555FF', 'Синий'],
  ['a', 'green', '#55FF55', 'Зелёный'], ['b', 'aqua', '#55FFFF', 'Бирюзовый'],
  ['c', 'red', '#FF5555', 'Красный'], ['d', 'light_purple', '#FF55FF', 'Розовый'],
  ['e', 'yellow', '#FFFF55', 'Жёлтый'], ['f', 'white', '#FFFFFF', 'Белый'],
];
export const COLOR_NAME = Object.fromEntries(COLORS.map(c => [c[0], c[1]]));
export const COLOR_CODE = Object.fromEntries(COLORS.map(c => [c[1], c[0]]));
// код формата -> ключ в тексте JSON Minecraft
export const FORMATS = { l: 'bold', o: 'italic', n: 'underlined', m: 'strikethrough', k: 'obfuscated' };
const FMT_KEYS = Object.keys(FORMATS);

const isCode = ch => /^[0-9a-fk-or]$/i.test(ch || '');
const blank = () => ({ c: null, l: false, o: false, n: false, m: false, k: false });

/** Разбор строки в список кусков: { t, c, l, o, n, m, k }. */
export function parse(src) {
  const s = String(src ?? '').replace(/§/g, '&');
  const out = [];
  let st = blank(), buf = '';
  const flush = () => { if (buf) { out.push({ t: buf, ...st }); buf = ''; } };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch !== '&') { buf += ch; continue; }
    const nx = s[i + 1];
    if (nx === '&') { buf += '&'; i++; continue; }
    if (!isCode(nx)) { buf += '&'; continue; }
    flush();
    const k = nx.toLowerCase();
    if (k === 'r') st = blank();
    else if (FMT_KEYS.includes(k)) st = { ...st, [k]: true };
    else st = { ...blank(), c: k };   // цвет сбрасывает форматирование, как в игре
    i++;
  }
  flush();
  return out;
}

export const strip = src => parse(src).map(p => p.t).join('');

/** Состояние форматирования после первых n символов строки. */
export function stateAt(src, n) {
  const s = String(src ?? '').slice(0, n);
  let st = blank();
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '&') continue;
    const nx = s[i + 1];
    if (nx === '&') { i++; continue; }
    if (!isCode(nx)) continue;
    const k = nx.toLowerCase();
    if (k === 'r') st = blank();
    else if (FMT_KEYS.includes(k)) st = { ...st, [k]: true };
    else st = { ...blank(), c: k };
    i++;
  }
  return st;
}
export const codesOf = st => (st.c ? '&' + st.c : '') + FMT_KEYS.filter(k => st[k]).map(k => '&' + k).join('');

/** Вставляет код форматирования. Для выделенного фрагмента после него возвращается прежнее оформление. */
export function applyCode(src, code, a, b) {
  const s = String(src ?? '');
  if (a === b) return { text: s.slice(0, a) + '&' + code + s.slice(a), caret: a + 2 };
  const after = '&r' + codesOf(stateAt(s, b));
  const text = s.slice(0, a) + '&' + code + s.slice(a, b) + after + s.slice(b);
  return { text, caret: b + 2 + after.length };
}

/** Строка для server.properties: коды § вместо &. */
export function toSection(src) {
  const parts = parse(src);
  let out = '';
  for (const p of parts) {
    const codes = (p.c ? '§' + p.c : '') + FMT_KEYS.filter(k => p[k]).map(k => '§' + k).join('');
    // цветной код сам сбрасывает стиль, поэтому §r нужен только перед куском без цвета
    out += (out && !p.c ? '§r' : '') + codes + p.t.replace(/§/g, '');
  }
  return out;
}

/** Текстовые компоненты JSON для команд team: [{text, color, bold, ...}]. */
export function toComponents(src) {
  return parse(src).map(p => {
    const o = { text: p.t, color: p.c ? COLOR_NAME[p.c] : 'white' };
    for (const k of FMT_KEYS) if (p[k]) o[FORMATS[k]] = true;
    return o;
  });
}

/** Обычный текст -> строка с кодами: знак & удваивается. */
export const escape = t => String(t ?? "").replace(/&/g, "&&");

/** Применяет код ко всему тексту (когда ничего не выделено): цвет заменяется, стиль включается или снимается, сброс убирает всё оформление. */
export function applyAll(src, code) {
  const segs = parse(src);
  if (!segs.length) return { text: String(src ?? ''), caret: String(src ?? '').length };
  if (code === 'r') { const t = escape(strip(src)); return { text: t, caret: t.length }; }
  if (FMT_KEYS.includes(code)) { const all = segs.every(p => p[code]); for (const p of segs) p[code] = !all; }
  else for (const p of segs) p.c = code;
  const out = [];
  for (const p of segs) {
    const prev = out[out.length - 1];
    if (prev && codesOf(prev) === codesOf(p)) prev.t += p.t; else out.push({ ...p });
  }
  const text = out.map((p, i) => (i ? '&r' : '') + codesOf(p) + escape(p.t)).join('');
  return { text, caret: text.length };
}

import { html, useState, useEffect, useRef } from '/vendor/htm-preact.js';
import { parse, strip, applyCode, applyAll, COLORS } from './mc.js';
import { logoUrl } from './ui.js';

/* Текст с форматированием Minecraft: цвета, жирный, курсив, подчёркивание, зачёркивание, «магические» символы. */

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#$%&@!?';
function Obf({ t }) {
  const [x, setX] = useState(t);
  useEffect(() => {
    const id = setInterval(() => setX([...t].map(ch => (ch === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join('')), 90);
    return () => clearInterval(id);
  }, [t]);
  return x;
}
const styleOf = p => {
  const deco = [p.n && 'underline', p.m && 'line-through'].filter(Boolean).join(' ');
  return (p.c ? `color:var(--mc${p.c});` : '') + (p.l ? 'font-weight:800;' : '') + (p.o ? 'font-style:italic;' : '') + (deco ? `text-decoration:${deco};` : '');
};

/** Цвета подстраиваются под тему панели; с real=true показываются настоящие цвета игры. */
export const FmtText = ({ src, real }) => html`<span class=${'fmt' + (real ? ' mcreal' : '')}>${parse(src).map((p, i) =>
  html`<span key=${i} style=${styleOf(p)}>${p.k ? html`<${Obf} t=${p.t} />` : p.t}</span>`)}</span>`;

/** Название сервера в панели: с форматированием, если оно задано. */
export const ServerName = ({ s }) => (s.nameFmt ? html`<${FmtText} src=${s.nameFmt} />` : s.name);

const FORMAT_BTNS = [
  ['l', 'Жирный (&l)', html`<b>B</b>`], ['o', 'Курсив (&o)', html`<i style="font-family:serif">I</i>`],
  ['n', 'Подчёркнутый (&n)', html`<u>U</u>`], ['m', 'Зачёркнутый (&m)', html`<s>S</s>`],
  ['k', 'Магические символы (&k)', html`<span style="letter-spacing:-1px">▒▓</span>`],
];

/** Выбор цвета из 16 цветов игры. */
export const ColorRow = ({ value, onPick, none }) => html`<div class="mce-cols">
  ${none && html`<button type="button" class=${'none' + (!value ? ' on' : '')} title="Без цвета" onClick=${() => onPick('')}>×</button>`}
  ${COLORS.map(([code, , hex, name]) => html`<button type="button" key=${code} class=${value === code ? 'on' : ''} style=${`background:${hex}`}
    title=${`${name} (&${code})`} onClick=${() => onPick(code)}></button>`)}</div>`;

/** Поле с кнопками цвета и стиля. Кнопки вставляют коды &, для выделенного текста оформление возвращается к прежнему. */
export function McEditor({ value, onChange, placeholder, max = 40, preview, compact }) {
  const ref = useRef(null);
  const v = value ?? '';
  const push = code => {
    const el = ref.current;
    if (!el) return;
    const a = el.selectionStart ?? v.length, b = el.selectionEnd ?? v.length;
    // без выделения оформление применяется ко всему тексту, а в пустое поле просто вставляется код
    const r = a === b && v.length ? applyAll(v, code) : applyCode(v, code, a, b);
    onChange(r.text);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(r.caret, r.caret); });
  };
  const keep = e => e.preventDefault();   // не уводим фокус из поля, иначе пропадёт выделение
  const len = strip(v).length;
  return html`<div class="mce">
    <div class="mce-bar" onMouseDown=${keep}>
      <div class="mce-cols">${COLORS.map(([code, , hex, name]) => html`<button type="button" key=${code} style=${`background:${hex}`}
        title=${`${name} (&${code})`} onClick=${() => push(code)}></button>`)}</div>
      <div class="mce-fmts">
        ${FORMAT_BTNS.map(([code, title, label]) => html`<button type="button" key=${code} title=${title} onClick=${() => push(code)}>${label}</button>`)}
        <button type="button" class="wide" title="Сбросить цвет и стиль (&r)" onClick=${() => push('r')}>Сброс</button>
      </div>
    </div>
    <input ref=${ref} class="mono" value=${v} placeholder=${placeholder} spellcheck=${false} onInput=${e => onChange(e.target.value)} />
    <div class="mce-meta"><span>Выделите часть текста, чтобы оформить только её. Без выделения оформление применится ко всему тексту. Знак & пишется как <code>&&</code>.</span>
      <span class=${len > max ? 'over' : ''}>${len} / ${max}</span></div>
    ${!compact && (preview ? preview(v) : html`<div class="mc-box"><${FmtText} real src=${v || ' '} /></div>`)}
  </div>`;
}

/** Строка сервера в списке игры: так её увидят игроки. */
export function MotdPreview({ s, l1, l2 }) {
  const icon = logoUrl(s);
  return html`<div class="mc-list">
    <div class="mc-ico" style=${icon ? `background-image:url(${icon})` : ''}>${!icon && html`<span>?</span>`}</div>
    <div class="mc-mid">
      <div class="mc-nm">Сервер Minecraft</div>
      <div class="mc-motd mcreal"><div><${FmtText} real src=${l1 || ' '} /></div><div><${FmtText} real src=${l2 || ' '} /></div></div>
    </div>
    <div class="mc-cnt">0/${s.maxPlayers || s.props?.MAX_PLAYERS || 20}</div>
  </div>`;
}

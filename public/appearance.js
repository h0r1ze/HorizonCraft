import { html, useState, useEffect, Icon, Btn, Toggle, toast, askConfirm, fmtBytes, THEMES } from './ui.js';
import { api } from './api.js';
import { suggest } from './bgmatch.js';

/* Оформление: последняя выбранная тема и фоновые картинки хранятся на сервере (выбор общий для всех браузеров),
   а тема ещё и в localStorage, чтобы страница не мигала до загрузки настроек.
   У каждой темы может быть своя картинка. Пока администратор её не выбрал, картинка подбирается под цвета темы сама. */

let state = { theme: '', auto: true, bindings: {}, images: [], limits: { images: 12, mb: 16, dim: [0, 90], blur: [0, 24] }, defaults: { dim: 35, blur: 6 }, loaded: false };
const subs = new Set();
const emit = () => subs.forEach(f => f(state));
export function useAppearance() {
  const [s, set] = useState(state);
  useEffect(() => { subs.add(set); set(state); return () => subs.delete(set); }, []);
  return s;
}

/** Показывает фон: картинка, затемнение (цветом темы) и размытие. Без картинки фон убирается. */
export function applyBackground(bg) {
  const el = document.documentElement;
  if (bg?.id) {
    el.dataset.bg = 'on';
    el.style.setProperty('--bg-img', `url(/api/backgrounds/${bg.id}/image)`);
    el.style.setProperty('--bg-dim', String((bg.dim ?? 35) / 100));
    el.style.setProperty('--bg-blur', (bg.blur || 0) + 'px');
  } else {
    delete el.dataset.bg;
    for (const p of ['--bg-img', '--bg-dim', '--bg-blur']) el.style.removeProperty(p);
  }
}

/* ---------- какая картинка у темы ---------- */
let sugKey = '', sugVal = {};
/** Подбор по цвету: {темаId: картинкаId}. Пересчитывается только при изменении набора картинок. */
export function suggested() {
  const key = state.images.map(i => i.id + ':' + i.lum).join();
  if (key !== sugKey) { sugKey = key; sugVal = suggest(THEMES, state.images); }
  return sugVal;
}
/** Картинка и параметры для темы: выбранная вручную, иначе подобранная, иначе null. auto: true у подобранной. */
export function effective(themeId, s = state) {
  const b = s.bindings[themeId];
  if (b) return b.id ? b : null;
  if (!s.auto) return null;
  const id = suggested()[themeId];
  // у светлых тем затемнение сильнее: тёмная картинка под светлым цветом темы иначе съедает контраст текста
  const light = THEMES.find(t => t.id === themeId)?.mode === 'light';
  return id ? { id, dim: light ? 55 : s.defaults.dim, blur: s.defaults.blur, auto: true } : null;
}
export const curTheme = () => document.documentElement.dataset.theme || 'dark';
export const applyForTheme = (t = curTheme()) => applyBackground(effective(t));

const take = r => { state = { ...state, ...r, loaded: true }; applyForTheme(curTheme()); emit(); return state; };
export const loadAppearance = async () => take(await api('/appearance'));
export const saveAppearance = async patch => take(await api('/appearance', { method: 'PUT', body: patch }));

async function upload(file) {
  const r = await fetch('/api/backgrounds?name=' + encodeURIComponent(file.name), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
  let data = {};
  try { data = await r.json(); } catch {}
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

const Slider = ({ label, value, min, max, unit, onInput, onDone }) => html`<label class="rng">
  <span class="row"><b class="grow">${label}</b><span class="muted mono">${value}${unit}</span></span>
  <input type="range" min=${min} max=${max} value=${value} onInput=${e => onInput(+e.target.value)} onChange=${e => onDone(+e.target.value)} /></label>`;

const ThemeChip = ({ t, e, on, onPick }) => html`<button type="button" class=${'bgth' + (on ? ' on' : '')} onClick=${onPick}
  title=${t.name + (e ? (e.auto ? ': подобрана автоматически' : ': выбрана вручную') : ': без картинки')}
  style=${e ? `background-image:url(/api/backgrounds/${e.id}/thumb)` : `background:${t.sw.bg}`}>
  <span class="dot" style=${`background:${t.sw.accent}`}></span><span class="nm">${t.name}</span>
  ${e && html`<span class=${'tag ' + (e.auto ? 'auto' : 'own')}>${e.auto ? 'авто' : 'своя'}</span>`}</button>`;

let timer = 0;
/** Настройки: фоновые картинки и их привязка к темам. theme: тема панели, которая выбрана сейчас. */
export function BackgroundCard({ theme }) {
  const a = useAppearance();
  const [tgt, setTgt] = useState(theme);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  useEffect(() => { setTgt(theme); setDraft(null); }, [theme]);
  const full = a.images.length >= a.limits.images;
  const tt = THEMES.find(t => t.id === tgt) || THEMES[0];
  const base = effective(tgt, a);
  const cur = base && draft?.theme === tgt ? { ...base, ...draft.v } : base;
  const explicit = !!a.bindings[tgt];
  const isCur = tgt === theme;
  const anyOwn = Object.keys(a.bindings).length > 0;

  const bind = async (patch) => {
    const next = { id: cur?.id || '', dim: cur?.dim ?? a.defaults.dim, blur: cur?.blur ?? a.defaults.blur, ...patch };
    if (isCur) applyBackground(next.id ? next : null);
    try { await saveAppearance({ bind: { theme: tgt, id: next.id, dim: next.dim, blur: next.blur } }); setDraft(null); } catch (x) { toast(x.message, 'err'); }
  };
  const pick = id => { if (id === (cur?.id || '') && explicit) return; bind({ id }); };
  const add = async files => {
    const list = [...files].filter(f => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif)$/i.test(f.name));
    if (!list.length) return toast('Выберите картинку: JPEG, PNG, WebP, GIF или AVIF', 'err');
    setBusy(true);
    let last = '';
    for (const f of list) {
      if (state.images.length >= state.limits.images) { toast(`Не больше ${state.limits.images} картинок. Удалите ненужные.`, 'err'); break; }
      try { const r = await upload(f); take(r); last = r.id; }
      catch (x) { toast(x.message, 'err'); }
    }
    if (last) { await bind({ id: last }); toast('Картинка загружена и выбрана для темы'); }
    setBusy(false);
  };
  const remove = async (e, img) => {
    e.stopPropagation();
    if (!(await askConfirm(`Удалить картинку «${img.name}»?`))) return;
    try { take(await api(`/backgrounds/${img.id}`, { method: 'DELETE' })); toast('Картинка удалена'); } catch (x) { toast(x.message, 'err'); }
  };
  const slide = key => ({
    onInput: v => { setDraft(d => ({ theme: tgt, v: { ...(d?.theme === tgt ? d.v : {}), [key]: v } })); if (isCur) applyBackground({ ...cur, [key]: v }); clearTimeout(timer); },
    onDone: v => { clearTimeout(timer); timer = setTimeout(() => bind({ [key]: v }), 150); },
  });
  const setAuto = async on => { try { await saveAppearance({ auto: on }); } catch (x) { toast(x.message, 'err'); } };
  const toAll = async () => {
    if (!cur?.id && !(await askConfirm(`Убрать картинку у всех тем? У темы «${tt.name}» картинки нет.`))) return;
    try { await saveAppearance({ bindAll: { themes: THEMES.map(t => t.id), id: cur?.id || '', dim: cur?.dim ?? a.defaults.dim, blur: cur?.blur ?? a.defaults.blur } }); toast('Применено ко всем темам'); } catch (x) { toast(x.message, 'err'); }
  };
  const reset = async id => { try { await saveAppearance({ unbind: id }); toast(id === '*' ? 'Автоподбор для всех тем' : 'Для темы снова автоподбор'); } catch (x) { toast(x.message, 'err'); } };
  const onDrop = e => { e.preventDefault(); setDrag(false); if (e.dataTransfer?.files?.length) add(e.dataTransfer.files); };
  const group = mode => html`<div class="bgths">${THEMES.filter(t => t.mode === mode).map(t => html`<${ThemeChip} key=${t.id} t=${t} e=${effective(t.id, a)} on=${tgt === t.id} onPick=${() => { setTgt(t.id); setDraft(null); }} />`)}</div>`;

  return html`<div class=${'card col' + (drag ? ' dropping' : '')} id="bg-card" onDragOver=${e => { e.preventDefault(); setDrag(true); }} onDragLeave=${() => setDrag(false)} onDrop=${onDrop}>
    <div class="row wrap"><h2 class="grow" style="margin:0">Фон панели</h2>
      <span class="chip">${a.images.length} / ${a.limits.images}</span></div>
    <p class="muted" style="margin:0">У каждой темы может быть своя картинка за интерфейсом: выберите тему ниже, затем картинку. Пока вы ничего не выбрали, панель сама подбирает картинки под цвета тем.
      Картинки уменьшаются и хранятся на сервере, поэтому фон одинаков на всех устройствах. Файл можно перетащить прямо в эту карточку.</p>
    <${Toggle} on=${a.auto} onChange=${setAuto} label="Подбирать картинки под темы автоматически" />

    <div class="col" style="gap:10px"><b>Тёмные темы</b>${group('dark')}<b>Светлые темы</b>${group('light')}</div>

    <div class="row wrap"><h3 class="grow" style="margin:0">Картинка для темы «${tt.name}»</h3>
      ${isCur ? html`<span class="chip ok">сейчас включена</span>` : html`<span class="chip">не выбрана сейчас</span>`}
      ${cur?.auto && html`<span class="chip">подобрана автоматически</span>`}</div>
    <div class="bgs">
      <button type="button" class=${'bgt none' + (!cur?.id ? ' on' : '')} onClick=${() => pick('')}><span>Без фона</span></button>
      ${a.images.map(img => html`<div key=${img.id} role="button" tabindex="0" class=${'bgt' + (cur?.id === img.id ? ' on' : '')} title=${`${img.name}, ${img.w}×${img.h}, ${fmtBytes(img.bytes)}`}
        style=${`background-image:url(/api/backgrounds/${img.id}/thumb)`} onClick=${() => pick(img.id)} onKeyDown=${e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pick(img.id))}>
        ${cur?.id === img.id && html`<span class="ck"><${Icon} n="check" size=${14} /></span>`}
        <button type="button" class="rm" title="Удалить картинку" onClick=${e => remove(e, img)}><${Icon} n="trash" size=${14} /></button>
        <span class="nm">${img.name}</span></div>`)}
      <label class=${'bgt add' + (full || busy ? ' off' : '')} title=${full ? 'Достигнут предел картинок' : ''}>
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" multiple disabled=${full || busy} onChange=${e => { add(e.target.files); e.target.value = ''; }} />
        <${Icon} n="upload" size=${20} /><span>${busy ? 'Загружаем…' : 'Загрузить'}</span></label>
    </div>
    ${cur?.id && html`<div class="bgset">
      <${Slider} label="Затемнение" value=${cur.dim} min=${a.limits.dim[0]} max=${a.limits.dim[1]} unit="%" ...${slide('dim')} />
      <${Slider} label="Размытие" value=${cur.blur} min=${a.limits.blur[0]} max=${a.limits.blur[1]} unit=" px" ...${slide('blur')} />
    </div>`}
    <div class="row wrap">
      <${Btn} kind="sm" icon="layers" onClick=${toAll}>Применить ко всем темам</${Btn}>
      ${explicit && html`<${Btn} kind="sm" icon="refresh" onClick=${() => reset(tgt)}>Для этой темы: автоподбор</${Btn}>`}
      ${anyOwn && html`<${Btn} kind="sm" icon="refresh" onClick=${() => reset('*')}>Автоподбор для всех тем</${Btn}>`}
    </div>
    <small class="muted">Форматы JPEG, PNG, WebP, GIF или AVIF, до ${a.limits.mb} МБ. Лучше всего подходят широкие картинки от 1920×1080. Затемнение берёт цвет темы, так что светлые темы остаются светлыми. Выбор «Без фона» тоже запоминается для темы.</small>
  </div>`;
}

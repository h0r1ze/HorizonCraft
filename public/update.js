import { html, useState, useEffect, Icon, Btn, toast, askConfirm, ago, locale } from './ui.js';
import { api } from './api.js';

/* Обновление панели с GitHub: метка версии в боковом меню, плашка на обзоре и карточка в «Настройках → Безопасность».
   Состояние одно на всю страницу: его опрашивает один таймер, компоненты подписываются. */

let state = null;
const subs = new Set();
const set = s => { state = s; subs.forEach(f => f(s)); };
let timer = null, fast = false;
async function poll() {
  try { set(await api('/panel/update')); } catch {}
}
function schedule() {
  clearInterval(timer);
  timer = setInterval(poll, fast ? 3000 : 60e3);
}
export function useUpdate() {
  const [s, setS] = useState(state);
  useEffect(() => {
    subs.add(setS);
    if (!timer) { poll(); schedule(); }
    return () => subs.delete(setS);
  }, []);
  return s;
}
const goCard = () => { location.hash = '#/settings/security'; setTimeout(() => document.getElementById('update-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400); };

/** Метка под названием панели в боковом меню: версия, а при новой версии — заметная кнопка «Обновление». */
export function UpdateBadge() {
  const s = useUpdate();
  if (!s) return null;
  if (s.running) return html`<button class="verbadge busy" title=${s.step || 'Обновление…'} onClick=${goCard}><span class="spin"></span><span class="nl">Обновление…</span></button>`;
  if (s.available) return html`<button class="verbadge new" title=${'Доступна версия ' + (s.latest?.version || '')} onClick=${goCard}><${Icon} n="arrowup" size=${13} /><span class="nl">Обновление · v${s.latest?.version}</span></button>`;
  return html`<button class="verbadge" title="Версия панели" onClick=${goCard}><span class="nl">v${s.version}</span></button>`;
}

/** Точка на кнопке «Настройки» в нижней панели телефона: там нет бокового меню с меткой версии. */
export function UpdateDot() {
  const s = useUpdate();
  return s?.available && !s.running ? html`<span class="navdot" title="Есть обновление панели"></span>` : null;
}

/** Плашка на обзоре, когда вышла новая версия. */
export function UpdateBanner() {
  const s = useUpdate();
  if (!s?.available || s.running) return null;
  return html`<div class="banner info upbanner"><${Icon} n="arrowup" size=${18} />
    <span class="grow">Вышла новая версия панели <b>v${s.latest.version}</b>. Сейчас установлена v${s.version}.</span>
    <${Btn} kind="sm primary" icon="arrowup" onClick=${goCard}>Обновить</${Btn}></div>`;
}

const fmtDate = d => (d ? new Date(d).toLocaleString(locale, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

/** Карточка «Обновление панели». */
export function PanelUpdateCard() {
  const s = useUpdate();
  const [busy, setBusy] = useState('');
  const [restart, setRestart] = useState(false);
  useEffect(() => { poll(); }, []);   // при открытии карточки — свежие данные, а не с прошлого опроса
  // во время обновления опрашиваем чаще; когда новая версия ответит, перезагружаем страницу
  useEffect(() => { fast = !!(s?.running || restart); schedule(); }, [s?.running, restart]);
  useEffect(() => {
    if (!restart) return;
    let alive = true;
    const t = setInterval(async () => {
      try {
        const x = await api('/panel/update');
        if (!alive) return;
        set(x);
        if (!x.running) { clearInterval(t); if (x.last?.state === 'ok') { toast('Панель обновлена до v' + x.version); setTimeout(() => location.reload(), 900); } else { setRestart(false); if (x.last?.error) toast(x.last.error, 'err'); } }
      } catch { /* панель перезапускается */ }
    }, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [restart]);
  if (!s) return html`<div class="skeleton" style="height:140px"></div>`;
  const check = async () => {
    setBusy('check');
    try { const x = await api('/panel/update/check', { method: 'POST' }); set(x); toast(x.error ? x.error : x.available ? 'Доступна версия v' + x.latest.version : 'У вас последняя версия', x.error ? 'err' : 'ok'); }
    catch (e) { toast(e.message, 'err'); }
    setBusy('');
  };
  const run = async () => {
    const to = s.latest?.version || '';
    if (!(await askConfirm(`Обновить панель${to ? ' до v' + to : ''}? Код скачается с GitHub, панель соберётся и перезапустится. Minecraft-серверы продолжат работать. Если новая версия не запустится, панель вернётся к прежней.`))) return;
    setBusy('run');
    try { set(await api('/panel/update', { method: 'POST' })); setRestart(true); toast('Обновление запущено'); }
    catch (e) { toast(e.message, 'err'); }
    setBusy('');
  };
  const L = s.latest;
  const last = s.last && Date.now() - s.last.at < 7 * 86400e3 ? s.last : null;
  return html`<div class=${'card col upcard ' + (s.available ? 'hot' : '')} id="update-card">
    <div class="row wrap"><h2 class="grow" style="margin:0">Обновление панели</h2>
      ${s.running ? html`<span class="chip">идёт обновление</span>` : s.available ? html`<span class="chip warn">есть обновление</span>` : L ? html`<span class="chip ok">последняя версия</span>` : ''}</div>
    <div class="upgrid">
      <div><span class="muted">Установлена</span><b class="upver">v${s.version}</b>${s.sha && html`<span class="mono muted" style="font-size:12px">${s.sha.slice(0, 7)}</span>`}</div>
      <div><span class="muted">На GitHub</span>${L ? html`<b class=${'upver ' + (s.available ? 'new' : '')}>v${L.version}</b><span class="muted" style="font-size:12.5px">${fmtDate(L.date)}</span>` : html`<b class="upver">—</b>`}</div>
    </div>
    ${L?.message && html`<div class="upmsg"><span class="muted">Последнее изменение:</span> <a href=${L.url} target="_blank" rel="noopener noreferrer">${L.message}</a></div>`}
    ${s.error && html`<div class="banner warn" style="margin:0">${s.error}</div>`}
    ${(s.running || restart) && html`<div class="banner info flex" style="margin:0"><span class="spin"></span><span class="grow">${s.running ? (s.step || 'Обновление…') : 'Панель перезапускается…'} Страница обновится сама.</span></div>`}
    ${!s.running && !restart && last?.state === 'error' && html`<div class="banner err" style="margin:0">Последнее обновление не удалось: ${last.error}</div>`}
    ${!s.running && !restart && last?.state === 'ok' && Date.now() - last.at < 86400e3 && html`<div class="banner info" style="margin:0">Панель обновлена ${ago(last.at)}${last.from ? ` с v${last.from}` : ''} до v${last.version || s.version}.</div>`}
    <div class="row wrap" style="gap:10px">
      ${s.available
        ? html`<${Btn} kind="primary" icon="arrowup" disabled=${!!busy || s.running || restart} onClick=${run}>Обновить до v${L.version}</${Btn}>`
        : html`<${Btn} icon="download" disabled=${!!busy || s.running || restart || !L} onClick=${run} title="Скачать и установить последнюю версию с GitHub заново">Переустановить с GitHub</${Btn}>`}
      <${Btn} kind="ghost" icon="refresh" disabled=${!!busy || s.running} onClick=${check}>${busy === 'check' ? 'Проверка…' : 'Проверить сейчас'}</${Btn}>
      <span class="grow"></span>
      <a class="muted" href=${s.repo + '/commits/main'} target="_blank" rel="noopener noreferrer" style="font-size:13px">История изменений</a>
    </div>
    <small class="muted">Панель проверяет GitHub раз в 6 часов.${s.checkedAt ? html` Последняя проверка: ${ago(s.checkedAt)}.` : ''} Обновление собирает панель заново из исходников и занимает пару минут, Minecraft-серверы при этом продолжают работать.</small>
  </div>`;
}

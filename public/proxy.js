import { askConfirm, html, useState, useEffect, Icon, Btn, Field, Toggle, toast, ago } from './ui.js';
import { api } from './api.js';

function TestResult({ r }) {
  if (!r) return null;
  if (r.busy) return html`<span class="muted">проверяю…</span>`;
  const p = r.proxy;
  return html`<span>${p && p.ok ? html`<b class="stat-ok">работает</b> <span class="muted">${(p.ms / 1000).toFixed(1)} с</span>`
    : html`<b class="stat-err">не работает</b> <span class="muted">${p ? p.error : ''}</span>`}
    <span class="faint"> · напрямую: ${r.direct.ok ? 'открывается' : 'заблокировано'}</span></span>`;
}

const MODES = [
  ['proxy', 'Прокси', 'Через узел идут установка ядра, скачивание модов и сборок: программы получают адрес прокси. Сам сервер работает напрямую.'],
  ['tun', 'TUN', 'Через узел идёт весь исходящий трафик сервера: загрузки, проверка лицензий в Mojang, запросы модов и плагинов. Программам ничего настраивать не нужно. Если узел перестанет работать, у сервера пропадёт выход в интернет.'],
];
const modeName = m => (m === 'tun' ? 'TUN' : 'Прокси');

/** Блок в «Настройках»: один раз выбирается узел VLESS и режим. Дальше в панели везде только переключатель «напрямую / через VLESS». */
export function ProxySettings() {
  const [st, setSt] = useState(null);
  const [url, setUrl] = useState('');
  const [paste, setPaste] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const [ext, setExt] = useState('');
  const [busy, setBusy] = useState('');
  const [tests, setTests] = useState({});
  const load = async () => { const x = await api('/proxy'); setSt(x); setExt(x.external); };
  useEffect(() => { load().catch(() => {}); }, []);
  const call = async (label, fn, ok) => {
    setBusy(label);
    try { const x = await fn(); if (x && x.nodes) { setSt(x); setExt(x.external); } if (ok) toast(ok); return true; }
    catch (e) { toast(e.message, 'err'); return false; }
    finally { setBusy(''); }
  };
  const test = async id => {
    setTests(t => ({ ...t, [id]: { busy: true } }));
    try { const r = await api('/proxy/test', { method: 'POST', body: { node: id } }); setTests(t => ({ ...t, [id]: r })); }
    catch (e) { setTests(t => ({ ...t, [id]: null })); toast(e.message, 'err'); }
  };
  if (!st) return html`<div class="skeleton" style="height:160px"></div>`;
  const sub = st.subscription, act = st.active;
  const pick = (id, nm) => call('act', () => api('/proxy/active', { method: 'PUT', body: { node: id } }), id ? 'Активный узел: ' + nm : 'VLESS отключён: всё идёт напрямую');
  const all = [...st.nodes, ...(st.external ? [{ id: 'external', name: 'Свой прокси ' + st.external, source: 'external' }] : [])];
  const row = (n, extra) => html`<div class=${'task vnode ' + (act.node === n.id ? 'on' : '')} key=${n.id} style="grid-template-columns:auto 1fr auto">
    <button class=${'vradio ' + (act.node === n.id ? 'on' : '')} title=${act.node === n.id ? 'Активный узел' : 'Сделать активным'} disabled=${!!busy} onClick=${() => act.node !== n.id && pick(n.id, n.name)}></button>
    <div style="min-width:0"><b class="trunc" style="display:block">${n.name}</b>
      <div class="row wrap" style="gap:6px;margin-top:3px">
        ${act.node === n.id && html`<span class="chip ok">активный</span>`}
        ${n.host && html`<span class="chip mono">${n.host}:${n.port}</span><span class="chip">${n.network}/${n.security}</span>`}
        <span class="chip">${n.source === 'sub' ? 'подписка' : n.source === 'manual' ? 'ссылка' : 'свой прокси'}</span></div>
      <div style="font-size:13px;margin-top:6px"><${TestResult} r=${tests[n.id]} /></div></div>
    <div class="row">${extra}<${Btn} kind="sm" icon="refresh" disabled=${!!tests[n.id]?.busy} onClick=${() => test(n.id)}>Проверить</${Btn}></div></div>`;

  return html`<div class="card col" id="vless-card">
    <div class="row wrap"><h2 class="grow" style="margin:0">VLESS и прокси</h2>
      <span class=${'badge ' + (act.node ? 'running' : '')}>${act.node ? html`включён · ${modeName(act.mode)}` : 'не используется'}</span></div>
    <p class="muted" style="margin:0">Нужен, когда сайты установщиков, CurseForge или Discord закрыты в вашей стране. Здесь один раз выбираются узел и режим по умолчанию.
      Дальше у каждого сервера над консолью и во вкладке «Сеть и домен» есть переключатель «Напрямую / VLESS / TUN», а в настройках CurseForge и в Discord — «напрямую или через VLESS».
      Подключения игроков к серверу всегда идут напрямую.</p>

    <div class="col" style="gap:10px">
      <h3>Режим по умолчанию</h3>
      <div class="vmodes">${MODES.map(([id, n, text]) => html`<button key=${id} class=${'vmode ' + (act.mode === id ? 'on' : '')} disabled=${!!busy}
        onClick=${() => act.mode !== id && call('mode', () => api('/proxy/active', { method: 'PUT', body: { mode: id } }), 'Режим: ' + n)}>
        <b>${n}</b><span>${text}</span></button>`)}</div>
      <small class="muted">Для каждого сервера режим можно сменить переключателем «Напрямую / VLESS / TUN» над консолью или во вкладке «Сеть и домен». Режим и узел меняются на ходу. В режиме TUN перехватываются TCP-соединения, UDP (например, DNS) идёт напрямую.</small>
    </div>

    <div class="col" style="gap:10px">
      <div class="row wrap"><h3 class="grow">Узел</h3>
        ${act.node && html`<${Btn} kind="sm ghost" icon="x" disabled=${!!busy} onClick=${() => pick('', '')}>Не использовать VLESS</${Btn}>`}</div>
      ${all.length === 0 ? html`<span class="muted">Узлов пока нет. Загрузите подписку, добавьте ссылку ниже или укажите свой прокси.</span>`
        : !act.node && html`<div class="banner info" style="margin:0">Отметьте узел, через который пойдёт трафик. Кнопка «Проверить» покажет, какие узлы отвечают.</div>`}
      ${st.nodes.map(n => row(n, n.source === 'manual' ? html`<${Btn} kind="sm ghost icon" icon="trash" title="Удалить" onClick=${async () => (await askConfirm('Удалить узел?')) && call('del', () => api('/proxy/nodes/' + n.id, { method: 'DELETE' }))} />` : null))}
      ${st.external && row(all[all.length - 1], null)}
    </div>

    <div class="col" style="gap:10px">
      <h3>Подписка 3x-ui</h3>
      ${sub && html`<div class="banner info" style="margin:0">Подписка с ${sub.host || 'вставленного текста'}: узлов ${sub.count}, обновлена ${ago(sub.updatedAt)}.
        ${sub.skipped.length > 0 && html`<div class="muted" style="font-size:12px;margin-top:4px">Пропущено: ${sub.skipped.map(x => `${x.name} (${x.reason})`).join('; ')}</div>`}</div>`}
      <${Field} label=${sub ? 'Заменить адрес подписки' : 'Адрес подписки'} hint="В 3x-ui это ссылка из раздела подписки клиента, вида https://домен:порт/sub/идентификатор. Ссылка хранится на сервере панели и не показывается.">
        <input class="mono" placeholder="https://…/sub/…" value=${url} onInput=${e => setUrl(e.target.value)} /></${Field}>
      <div class="row wrap">
        <${Btn} kind="primary" icon="download" disabled=${!!busy || !url.trim()} onClick=${() => call('sub', () => api('/proxy/subscription', { method: 'POST', body: { url: url.trim() } }), 'Подписка загружена').then(ok => ok && setUrl(''))}>${busy === 'sub' ? 'Загрузка…' : 'Загрузить подписку'}</${Btn}>
        ${sub && sub.host && html`<${Btn} icon="refresh" disabled=${!!busy} onClick=${() => call('sub', () => api('/proxy/subscription', { method: 'POST', body: { refresh: true } }), 'Подписка обновлена')}>Обновить список</${Btn}>`}
        <${Btn} kind="ghost" onClick=${() => setShowPaste(!showPaste)}>${showPaste ? 'Скрыть' : 'Вставить содержимое вручную'}</${Btn}>
        ${sub && html`<${Btn} kind="danger" icon="trash" disabled=${!!busy} onClick=${async () => (await askConfirm('Удалить подписку и все её узлы?')) && call('del', () => api('/proxy/subscription', { method: 'DELETE' }), 'Подписка удалена')}>Удалить</${Btn}>`}
      </div>
      ${showPaste && html`<div class="col" style="gap:10px">
        <${Field} label="Содержимое подписки" hint="Если адрес подписки недоступен с сервера, откройте его в браузере и вставьте сюда текст ответа или список ссылок vless://, по одной на строку.">
          <textarea class="mono" style="min-height:90px" value=${paste} onInput=${e => setPaste(e.target.value)} placeholder="vless://…"></textarea></${Field}>
        <div><${Btn} icon="check" disabled=${!!busy || !paste.trim()} onClick=${() => call('paste', () => api('/proxy/subscription', { method: 'POST', body: { content: paste, url: url.trim() } }), 'Узлы добавлены').then(ok => ok && setPaste(''))}>Применить</${Btn}></div></div>`}
    </div>

    <div class="col" style="gap:10px">
      <h3>Добавить отдельную ссылку VLESS</h3>
      <div class="fields">
        <${Field} label="Ссылка" hint="vless://UUID@адрес:порт?параметры#название. Поддерживаются TCP, WebSocket, gRPC, TLS и Reality.">
          <input class="mono" placeholder="vless://…" value=${link} onInput=${e => setLink(e.target.value)} /></${Field}>
        <${Field} label="Название (необязательно)"><input value=${name} onInput=${e => setName(e.target.value)} /></${Field}>
      </div>
      <div><${Btn} icon="plus" disabled=${!!busy || !link.trim()} onClick=${() => call('add', () => api('/proxy/manual', { method: 'POST', body: { link: link.trim(), name } }), 'Узел добавлен').then(ok => ok && (setLink(''), setName('')))}>Добавить</${Btn}></div>
    </div>

    <div class="col" style="gap:10px">
      <h3>Свой прокси на сервере</h3>
      <${Field} label="Адрес прокси (HTTP и SOCKS5 на одном порту)" hint="Например 127.0.0.1:10808, если на самом сервере уже работает xray или другой клиент. Панель сама откроет к нему доступ контейнерам, наружу порт не публикуется.">
        <input class="mono" placeholder="127.0.0.1:10808" value=${ext} onInput=${e => setExt(e.target.value)} /></${Field}>
      <div><${Btn} icon="save" disabled=${!!busy || ext.trim() === st.external} onClick=${() => call('ext', () => api('/proxy/external', { method: 'PUT', body: { address: ext.trim() } }), ext.trim() ? 'Прокси сохранён' : 'Прокси удалён')}>Сохранить</${Btn}></div>
    </div>
  </div>`;
}

/** Переключатель из двух положений: напрямую или через VLESS. */
export function ViaSwitch({ on, onChange, disabled }) {
  return html`<div class="seg via" style="width:fit-content;white-space:nowrap">
    <button type="button" class=${!on ? 'on' : ''} onClick=${() => on && onChange(false)}><${Icon} n="globe" size=${14} /> Напрямую</button>
    <button type="button" class=${on ? 'on' : ''} disabled=${disabled && !on} onClick=${() => !on && onChange(true)}><${Icon} n="shield" size=${14} /> Через VLESS</button></div>`;
}
/** Строка «Узел: … · режим …» со ссылкой на настройки. */
export function ActiveLine({ active }) {
  return active?.node
    ? html`<small class="muted">Узел: <b style="color:var(--text)">${active.name}</b> · режим: <b style="color:var(--text)">${modeName(active.mode)}</b> · <a href="#/settings/network">изменить в Настройках</a></small>`
    : html`<div class="banner warn" style="margin:0">Узел VLESS ещё не выбран. Выберите его один раз в <a href="#/settings/network">Настройках → VLESS и прокси</a>.</div>`;
}

/* Трафик сервера: одно общее состояние для переключателя у консоли и блока в «Сети и домене».
   Оба места читают и меняют одно и то же, поэтому переключение в одном сразу видно в другом. */
const trafficSubs = new Map();   // id сервера → { st, fns:Set, timer }
function useTraffic(id) {
  const [st, setSt] = useState(trafficSubs.get(id)?.st || null);
  useEffect(() => {
    let e = trafficSubs.get(id);
    if (!e) {
      e = { st: null, fns: new Set(), timer: 0 };
      e.load = () => api(`/servers/${id}/proxy`).then(x => { e.st = x; e.fns.forEach(f => f(x)); }).catch(() => {});
      trafficSubs.set(id, e);
    }
    e.fns.add(setSt);
    if (e.fns.size === 1) { e.load(); e.timer = setInterval(e.load, 4000); }
    else if (e.st) setSt(e.st);
    return () => { e.fns.delete(setSt); if (!e.fns.size) { clearInterval(e.timer); trafficSubs.delete(id); } };
  }, [id]);
  const put = x => { const e = trafficSubs.get(id); if (e) { e.st = x; e.fns.forEach(f => f(x)); } };
  return [st, put];
}

const TRAFFIC = [
  ['direct', 'Напрямую', 'globe', 'Сервер выходит в интернет сам'],
  ['proxy', 'VLESS', 'shield', 'Через узел идут установка ядра, скачивание модов и сборок'],
  ['tun', 'TUN', 'layers', 'Через узел идёт весь исходящий трафик сервера'],
];
const trafficOf = st => (!st?.on ? 'direct' : st.mode === 'tun' ? 'tun' : 'proxy');

/** Переключатель «Напрямую / VLESS / TUN» с сохранением сразу. */
function TrafficSeg({ s, st, put, busy, setBusy }) {
  const cur = trafficOf(st), noNode = st && !st.active.node;
  const pick = async k => {
    if (k === cur || busy) return;
    setBusy(true);
    try {
      const x = await api(`/servers/${s.id}/proxy`, { method: 'PUT', body: k === 'direct' ? { on: false } : { on: true, mode: k } });
      put(x);
      toast(k === 'direct' ? 'Трафик сервера: напрямую' : k === 'tun' ? 'Трафик сервера: TUN' : 'Трафик сервера: через VLESS');
    } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  return html`<div class="seg via traffic" style="width:fit-content;white-space:nowrap">
    ${TRAFFIC.map(([k, n, ic, tip]) => html`<button type="button" key=${k} class=${cur === k ? 'on' : ''} title=${tip}
      disabled=${busy || (k !== 'direct' && noNode && cur !== k)} onClick=${() => pick(k)}><${Icon} n=${ic} size=${14} /> ${n}</button>`)}</div>`;
}

async function restartServer(s) {
  if (!(await askConfirm('Перезапустить сервер, чтобы применить выбор трафика? Игроки будут отключены.'))) return;
  try { await api(`/servers/${s.id}/action`, { method: 'POST', body: { action: 'restart' } }); toast('Перезапуск…'); }
  catch (e) { toast(e.message, 'err'); }
}

/** Состояние под переключателем: нужен ли перезапуск, работает ли TUN. */
function TrafficState({ s, st }) {
  if (!st) return null;
  const tun = st.tun;
  return html`
    ${st.restart && html`<div class="banner warn trafficwarn" style="margin:0"><span class="grow">${st.on ? 'Сервер ещё работает напрямую. Перезапустите его, чтобы применить.' : 'Сервер ещё работает через VLESS. Перезапустите его, чтобы применить.'}</span>
      <${Btn} kind="sm" icon="refresh" onClick=${() => restartServer(s)}>Перезапустить</${Btn}></div>`}
    ${st.on && st.mode === 'tun' && s.state === 'running' && tun && html`<div class=${'banner ' + (tun.error ? 'err' : 'info')} style="margin:0">
      ${tun.ok ? 'TUN работает: трафик сервера идёт через узел.' : tun.error ? html`TUN не включился, сервер работает напрямую. ${tun.error}` : 'TUN включается…'}</div>`}`;
}

/** Строка над консолью: переключатель трафика и узел, чтобы при ошибках скачивания не искать настройку. */
export function TrafficBar({ s }) {
  const [st, put] = useTraffic(s.id);
  const [busy, setBusy] = useState(false);
  if (!st) return null;
  return html`<div class="card trafficbar col" id="traffic-bar">
    <div class="row wrap" style="gap:10px">
      <span class="tlabel"><${Icon} n="globe" size=${14} /> Трафик</span>
      <${TrafficSeg} s=${s} st=${st} put=${put} busy=${busy} setBusy=${setBusy} />
      <small class="muted grow trunc">${st.active.node
        ? html`Узел: <b style="color:var(--text)">${st.active.name}</b>`
        : html`Узел VLESS не выбран · <a href="#/settings/network">выбрать</a>`}</small>
      <a class="small" href=${`#/s/${s.id}/network`}>Подробнее</a>
    </div>
    <${TrafficState} s=${s} st=${st} />
  </div>`;
}

/** Блок на вкладке «Сеть и домен»: тот же переключатель с пояснениями. Узел общий, из Настроек. */
export function ServerProxy({ s }) {
  const [st, put] = useTraffic(s.id);
  const [busy, setBusy] = useState(false);
  const act = st?.active, cur = trafficOf(st);
  return html`<div class="card col" id="traffic-card">
    <div class="row wrap"><h2 class="grow" style="margin:0">Трафик сервера</h2>
      ${st && html`<${TrafficSeg} s=${s} st=${st} put=${put} busy=${busy} setBusy=${setBusy} />`}</div>
    <p class="muted" style="margin:0">Как сервер выходит в интернет: напрямую, через узел VLESS или целиком через TUN. Подключения игроков идут напрямую и не меняются.
      Этот же переключатель есть над консолью сервера.</p>
    ${st && !act.node && html`<${ActiveLine} active=${act} />`}
    ${st && act.node && cur !== 'direct' && html`<small class="muted">Узел: <b style="color:var(--text)">${act.name}</b> · <a href="#/settings/network">изменить в Настройках</a></small>`}
    ${cur !== 'direct' && html`<small class="muted">${cur === 'tun'
      ? 'Режим TUN: через узел идёт весь исходящий трафик сервера (загрузки, проверка лицензий в Mojang, запросы модов и плагинов). Если узел перестанет работать, у сервера пропадёт выход в интернет, а игроки с лицензией не смогут зайти.'
      : 'Режим VLESS: через узел идут установка ядра и скачивание модов и сборок. Сам сервер работает напрямую.'}</small>`}
    <${TrafficState} s=${s} st=${st} />
    <small class="muted">Выбор сохраняется сразу. VLESS ↔ TUN применяется на ходу, а переход с «Напрямую» на VLESS или TUN и обратно — после перезапуска сервера.</small>
  </div>`;
}

/** Переключатель в «Настройках»: запросы самой панели к CurseForge идут напрямую или через VLESS. */
export function PanelProxy({ s, onChanged }) {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  useEffect(() => { api('/proxy').then(setSt).catch(() => {}); }, []);
  const on = !!s.panelProxy?.on;
  const apply = async nextOn => {
    setBusy(true); setRes(null);
    try {
      const r = await api('/settings', { method: 'PUT', body: { panelProxy: { on: nextOn } } });
      setRes(r.probe || null);
      if (nextOn && !r.probe) toast('Включено. Добавьте ключ CurseForge, чтобы проверить соединение.');
      else if (nextOn && r.probe) toast(r.probe.search === 200 ? 'Через VLESS поиск CurseForge работает' : 'VLESS включён, но поиск CurseForge по-прежнему закрыт', r.probe.search === 200 ? 'ok' : 'err');
      else toast('Панель обращается к CurseForge напрямую');
      await onChanged();
    } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  const code = c => (c === 200 ? 'ответ получен' : c ? 'ошибка ' + c : 'нет связи');
  return html`<div class="col" style="gap:12px;border-top:1px solid var(--line);padding-top:14px">
    <div class="row wrap"><h3 class="grow">Запросы панели к CurseForge</h3>
      <${ViaSwitch} on=${on} disabled=${busy || (st && !st.active.node)} onChange=${v => !busy && apply(v)} /></div>
    <small class="muted">Поиск и проверку ключа CurseForge выполняет сама панель. Если они закрыты для вашего адреса, пустите эти запросы через VLESS. Установку сборок выполняют контейнеры серверов, для них переключатель есть на странице сервера.</small>
    ${st && (on || !st.active.node) && html`<${ActiveLine} active=${st.active} />`}
    ${on && html`<div><${Btn} icon="refresh" disabled=${busy} onClick=${() => apply(true)}>Проверить сейчас</${Btn}></div>`}
    ${res && html`<div style="font-size:13px">Ключ: <b>${code(res.games)}</b> · Поиск: <b class=${res.search === 200 ? 'stat-ok' : 'stat-err'}>${code(res.search)}</b>${res.viaProxy ? ' · запросы шли через VLESS' : ''}</div>`}
  </div>`;
}

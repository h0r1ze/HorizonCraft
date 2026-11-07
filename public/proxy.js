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

/** Блок в «Настройках»: подписка 3x-ui, отдельные ссылки и свой прокси. */
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
  const sub = st.subscription;
  const row = (n, extra) => html`<div class="task" key=${n.id} style="grid-template-columns:1fr auto">
    <div style="min-width:0"><b class="trunc" style="display:block">${n.name}</b>
      <div class="row wrap" style="gap:6px;margin-top:3px">
        ${n.host && html`<span class="chip mono">${n.host}:${n.port}</span><span class="chip">${n.network}/${n.security}</span>`}
        <span class="chip">${n.source === 'sub' ? 'подписка' : n.source === 'manual' ? 'ссылка' : 'свой прокси'}</span></div>
      <div style="font-size:13px;margin-top:6px"><${TestResult} r=${tests[n.id]} /></div></div>
    <div class="row">${extra}<${Btn} kind="sm" icon="refresh" disabled=${!!tests[n.id]?.busy} onClick=${() => test(n.id)}>Проверить</${Btn}></div></div>`;

  return html`<div class="card col">
    <div class="row wrap"><h2 class="grow" style="margin:0">Прокси для серверов</h2>
      <span class=${'badge ' + (st.nodes.length || st.external ? 'running' : '')}>${st.nodes.length + (st.external ? 1 : 0)} узлов</span></div>
    <p class="muted" style="margin:0">Прокси нужен, когда установщик или сайт блокируются в вашей стране. Здесь добавляются узлы, а включается прокси отдельно для каждого сервера на вкладке «Сеть и домен».
      Подключения игроков к серверу идут напрямую. Ваш компьютер в схеме не участвует: прокси работает на сервере и ходит к вашему VLESS-серверу.</p>

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
      <h3>Узлы</h3>
      ${st.nodes.length === 0 && !st.external ? html`<span class="muted">Пока нет. Загрузите подписку, добавьте ссылку ниже или укажите свой прокси.</span>` : ''}
      ${st.nodes.map(n => row(n, n.source === 'manual' ? html`<${Btn} kind="sm ghost icon" icon="trash" title="Удалить" onClick=${async () => (await askConfirm('Удалить узел?')) && call('del', () => api('/proxy/nodes/' + n.id, { method: 'DELETE' }))} />` : null))}
      ${st.external && row({ id: 'external', name: 'Свой прокси ' + st.external, source: 'external' }, null)}
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

/** Блок на вкладке сервера: переключатель, узел и охват. */
export function ServerProxy({ value, onChange }) {
  const [st, setSt] = useState(null);
  const [res, setRes] = useState(null);
  const v = value || { on: false, node: '', scope: 'install' };
  useEffect(() => { api('/proxy').then(setSt).catch(() => {}); }, []);
  const set = o => onChange({ ...v, ...o });
  const test = async () => {
    setRes({ busy: true });
    try { setRes(await api('/proxy/test', { method: 'POST', body: { node: v.node } })); }
    catch (e) { setRes(null); toast(e.message, 'err'); }
  };
  const subs = st ? st.nodes.filter(n => n.source === 'sub') : [];
  const manual = st ? st.nodes.filter(n => n.source === 'manual') : [];
  const empty = st && !st.nodes.length && !st.external;
  const missing = v.on && st && v.node && !st.nodes.some(n => n.id === v.node) && !(v.node === 'external' && st.external);
  return html`<div class="card col">
    <div class="row wrap"><h2 class="grow" style="margin:0">Прокси сервера</h2>
      <${Toggle} on=${v.on} onChange=${on => set({ on })} label=${v.on ? 'Включён' : 'Выключен'} /></div>
    <p class="muted" style="margin:0">Направляет трафик этого сервера через выбранный узел VLESS. Подключения игроков идут напрямую и не меняются.</p>
    ${empty && html`<div class="banner warn" style="margin:0">Узлов пока нет. Добавьте подписку 3x-ui или ссылку в <a href="#/settings">настройках</a>.</div>`}
    ${missing && html`<div class="banner err" style="margin:0">Выбранный узел больше не существует. Выберите другой.</div>`}
    ${v.on && st && html`<div class="col" style="gap:14px">
      <div class="fields">
        <${Field} label="Узел">
          <select value=${v.node} onChange=${e => { set({ node: e.target.value }); setRes(null); }}>
            <option value="">— выберите —</option>
            ${subs.length > 0 && html`<optgroup label="Подписка">${subs.map(n => html`<option value=${n.id}>${n.name} · ${n.host}</option>`)}</optgroup>`}
            ${manual.length > 0 && html`<optgroup label="Ссылки">${manual.map(n => html`<option value=${n.id}>${n.name} · ${n.host}</option>`)}</optgroup>`}
            ${st.external && html`<optgroup label="Свой прокси"><option value="external">${st.external}</option></optgroup>`}
          </select></${Field}>
        <${Field} label="Что пускать через прокси">
          <select value=${v.scope} onChange=${e => set({ scope: e.target.value })}>
            <option value="install">Только установку и скачивание файлов</option>
            <option value="all">Весь исходящий трафик сервера</option></select></${Field}>
      </div>
      ${v.scope === 'all'
        ? html`<small class="muted">Через узел пойдёт всё, что сервер сам отправляет в интернет: загрузки, проверка игроков в Mojang, запросы модов и плагинов (Java-подключения). Если узел перестанет работать, у сервера пропадёт выход в интернет, а игроки с лицензией не смогут зайти.</small>`
        : html`<small class="muted">Узел используется только установщиками ядра и скачиванием модов. Сам сервер работает напрямую.</small>`}
      <div class="row wrap"><${Btn} icon="refresh" disabled=${!v.node || !!res?.busy} onClick=${test}>Проверить узел</${Btn}>
        <span style="font-size:13px"><${TestResult} r=${res} /></span></div>
      <small class="muted">Изменения применятся после сохранения и перезапуска сервера.</small>
    </div>`}
  </div>`;
}

/** Переключатель в «Настройках»: запросы самой панели к CurseForge идут через узел прокси. */
export function PanelProxy({ s, onChanged }) {
  const [st, setSt] = useState(null);
  const [node, setNode] = useState(s.panelProxy?.node || '');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  useEffect(() => { api('/proxy').then(setSt).catch(() => {}); }, []);
  const on = !!s.panelProxy?.on;
  const apply = async (nextOn, nextNode) => {
    if (nextOn && !nextNode) return toast('Сначала выберите узел', 'err');
    setBusy(true); setRes(null);
    try {
      const r = await api('/settings', { method: 'PUT', body: { panelProxy: { on: nextOn, node: nextNode } } });
      setRes(r.probe || null);
      if (nextOn && !r.probe) toast('Включено. Добавьте ключ CurseForge, чтобы проверить соединение.');
      else if (nextOn && r.probe) toast(r.probe.search === 200 ? 'Через прокси поиск CurseForge работает' : 'Прокси включён, но поиск CurseForge по-прежнему закрыт', r.probe.search === 200 ? 'ok' : 'err');
      else toast('Панель обращается к CurseForge напрямую');
      await onChanged();
    } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  const subs = st ? st.nodes.filter(n => n.source === 'sub') : [];
  const manual = st ? st.nodes.filter(n => n.source === 'manual') : [];
  const none = st && !st.nodes.length && !st.external;
  const code = c => (c === 200 ? 'ответ получен' : c ? 'ошибка ' + c : 'нет связи');
  return html`<div class="col" style="gap:12px;border-top:1px solid var(--line);padding-top:14px">
    <div class="row wrap"><h3 class="grow">Запросы панели через прокси</h3>
      <${Toggle} on=${on} onChange=${v => !busy && apply(v, node)} label=${on ? 'Включено' : 'Выключено'} /></div>
    <small class="muted">Поиск и проверка ключа CurseForge выполняет сама панель. Если они закрыты для вашего адреса, можно пустить эти запросы через узел VLESS. Тем же путём идут запросы панели к Discord (табло сервера). Установку сборок выполняют контейнеры серверов, для них прокси включается отдельно на странице сервера.</small>
    ${none ? html`<div class="banner warn" style="margin:0">Узлов пока нет. Добавьте подписку или ссылку в блоке «Прокси для серверов» ниже.</div>`
      : html`<div class="row wrap"><select style="max-width:360px" value=${node} disabled=${busy} onChange=${e => { setNode(e.target.value); if (on) apply(true, e.target.value); }}>
          <option value="">— выберите узел —</option>
          ${subs.length > 0 && html`<optgroup label="Подписка">${subs.map(n => html`<option value=${n.id}>${n.name} · ${n.host}</option>`)}</optgroup>`}
          ${manual.length > 0 && html`<optgroup label="Ссылки">${manual.map(n => html`<option value=${n.id}>${n.name} · ${n.host}</option>`)}</optgroup>`}
          ${st && st.external && html`<optgroup label="Свой прокси"><option value="external">${st.external}</option></optgroup>`}</select>
        <${Btn} icon="refresh" disabled=${busy || !on} onClick=${() => apply(true, node)}>Проверить сейчас</${Btn}></div>`}
    ${res && html`<div style="font-size:13px">Ключ: <b>${code(res.games)}</b> · Поиск: <b class=${res.search === 200 ? 'stat-ok' : 'stat-err'}>${code(res.search)}</b>${res.viaProxy ? ' · запросы шли через прокси' : ''}</div>`}
  </div>`;
}

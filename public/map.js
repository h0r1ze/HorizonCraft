import { html, useState, useEffect, Icon, Btn, Field, toast, copyText, appState, isRemote } from './ui.js';
import { api } from './api.js';

/* Карта мира: плагин Dynmap. Включается одной кнопкой, открывается по адресу машины и порту карты. */

export function MapTab({ s, reload, act }) {
  const [m, setM] = useState(null);
  const [world, setWorld] = useState('world');
  const [busy, setBusy] = useState(false);
  const [frame, setFrame] = useState(0);
  const up = s.state === 'running' || s.state === 'starting';
  const load = async () => { try { setM(await api(`/servers/${s.id}/map`)); } catch (x) { toast(x.message, 'err'); } };
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [s.id]);
  if (!m) return html`<div class="skeleton" style="height:200px"></div>`;

  const toggle = async on => {
    setBusy(true);
    try { const r = await api(`/servers/${s.id}/map`, { method: 'PUT', body: { on } }); setM(r); toast(on ? 'Карта включена' : 'Карта выключена'); reload(); }
    catch (x) { toast(x.message, 'err'); }
    setBusy(false);
  };
  const render = async () => {
    setBusy(true);
    try { const r = await api(`/servers/${s.id}/map/render`, { method: 'POST', body: { world } }); toast(r.out || 'Отрисовка запущена'); }
    catch (x) { toast(x.message, 'err'); }
    setBusy(false);
  };

  if (!m.supported) {
    return html`<div class="card col"><h2>Карта мира</h2>
      <div class="banner info" style="margin:0">Встроенная карта работает на серверах Paper и Purpur (плагин Dynmap). Сейчас выбран тип «${m.type}». Для Fabric и Forge установите мод карты вручную на вкладке «Моды» или «Файлы».</div></div>`;
  }

  const lan = isRemote(s) ? s.node.host : location.hostname;
  const pub = isRemote(s) ? s.node.host : appState.settings.publicHost;
  const url = m.on ? `http://${lan}:${m.port}` : '';
  const embed = m.on && m.installed && up && location.protocol === 'http:';

  if (!m.on) {
    return html`<div class="card col"><h2>Карта мира</h2>
      <p style="margin:0">Живая карта вашего мира в браузере: игроки, постройки и день/ночь в реальном времени. Работает на плагине Dynmap, который панель установит и настроит сама.</p>
      <ul class="muted" style="margin:0;padding-left:20px;line-height:1.7">
        <li>Плагин скачается при следующем запуске сервера, понадобится перезапуск.</li>
        <li>Для карты выделяется отдельный порт на этой машине (обычно 8123).</li>
        <li>Отрисовка мира нагружает процессор: для больших миров лучше запускать её, когда на сервере никого нет.</li>
      </ul>
      <div><${Btn} kind="primary" icon="map" disabled=${busy} onClick=${() => toggle(true)}>Включить карту</${Btn}></div></div>`;
  }

  return html`<div class="col">
    <div class="card col">
      <div class="row wrap"><h2 class="grow" style="margin:0">Карта мира</h2>
        <span class=${'chip ' + (m.installed ? 'ok' : 'warn')}>${m.installed ? 'Dynmap установлен' : 'Плагин скачается при запуске'}</span></div>
      ${!up && html`<div class="banner info" style="margin:0">Карта заработает после запуска сервера.</div>`}
      ${up && s.outdated && html`<div class="banner warn flex" style="margin:0"><span class="grow">Чтобы карта заработала, перезапустите сервер.</span>
        <${Btn} kind="sm" icon="restart" disabled=${!!s.busy} onClick=${() => act('restart')}>Перезапустить</${Btn}></div>`}
      <div class="row wrap" style="gap:10px">
        <a class="btn primary" href=${url} target="_blank" rel="noopener"><${Icon} n="map" />Открыть карту</a>
        <span class="addr" title="Скопировать" onClick=${() => copyText(url)}>${url}<${Icon} n="copy" size=${13} /></span>
      </div>
      ${pub && pub !== lan && html`<div class="muted" style="font-size:13px">Для игроков и друзей: <span class="mono">http://${pub}:${m.port}</span>. Для этого откройте порт ${m.port}/tcp на роутере.</div>`}
      <div class="fields">
        <${Field} label="Отрисовать мир" hint="Запускает полную отрисовку карты. Для больших миров это долго и грузит процессор. Сервер должен работать.">
          <div class="row"><input value=${world} placeholder="world" onInput=${e => setWorld(e.target.value)} />
            <${Btn} icon="play" disabled=${busy || !up || !m.installed} onClick=${render}>Отрисовать</${Btn}></div></${Field}>
      </div>
    </div>
    ${embed && html`<div class="card col"><div class="row"><h2 class="grow" style="margin:0">Предпросмотр</h2>
        <${Btn} kind="sm" icon="refresh" onClick=${() => setFrame(f => f + 1)}>Обновить</${Btn}></div>
      <iframe key=${frame} class="mapframe" src=${url} title="Карта мира"></iframe>
      <small class="muted">Если карта пустая или не открывается: плагин запускается вместе с сервером, подождите минуту. Новые области появляются по мере прогулок игроков или после «Отрисовать».</small></div>`}
    <div><${Btn} kind="ghost" icon="x" disabled=${busy} onClick=${() => toggle(false)}>Выключить карту</${Btn}>
      <small class="muted" style="margin-left:10px">Плагин останется в папке plugins, при выключении удаляется только автоустановка.</small></div>
  </div>`;
}

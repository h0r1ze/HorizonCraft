import { html, useState, useEffect, useRef, Icon, Btn, Field, Meter, toast, TYPE_NAMES, TYPE_COLOR, fmtBytes, appState } from './ui.js';
import { useNodes, NodePicker } from './nodes.js';
import { useTemplates, tplLine } from './templates.js';
import { api, getVersions } from './api.js';

const TYPES = [
  ['PAPER', 'Быстрый, плагины Bukkit/Spigot. Лучший выбор по умолчанию.'],
  ['VANILLA', 'Чистый сервер Mojang без изменений.'],
  ['PURPUR', 'Форк Paper с доп. настройками геймплея.'],
  ['FABRIC', 'Лёгкий загрузчик модов.'],
  ['FORGE', 'Классический загрузчик модов.'],
  ['NEOFORGE', 'Современный преемник Forge.'],
  ['AUTO_CURSEFORGE', 'Готовая сборка с CurseForge одним кликом.'],
];

export function ModpackSearch({ onPick, kind = 'modpack', loader = '', gameVersion = '', label = 'Выбрать' }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const search = async e => {
    e && e.preventDefault();
    if (!appState.settings.cfApiKeySet || appState.settings.cfSearchOk === false) return;
    setBusy(true);
    try {
      const p = new URLSearchParams({ q, kind, loader, gameVersion });
      setRes(await api('/cf/search?' + p));
    } catch (x) { toast(x.message, 'err'); setRes(null); }
    setBusy(false);
  };
  useEffect(() => { search(); }, [kind]);
  return html`<div class="col">
    <form class="row" onSubmit=${search}>
      <input placeholder=${kind === 'mod' ? 'Поиск модов на CurseForge' : 'Поиск сборок на CurseForge'} value=${q} onInput=${e => setQ(e.target.value)} />
      <${Btn} icon="search" type="submit" disabled=${busy}>Найти</${Btn}>
    </form>
    ${!appState.settings.cfApiKeySet && html`<div class="banner warn" style="margin:0">Ключ CurseForge не задан. Добавьте его в <a href="#/settings">настройках</a>, и здесь появится поиск.</div>`}
    ${appState.settings.cfApiKeySet && appState.settings.cfSearchOk === false && html`<div class="banner warn" style="margin:0">CurseForge закрыл поиск для вашего ключа, поэтому сборки через него недоступны. Выберите тип Forge, Fabric или NeoForge, а моды добавьте по ID проекта на вкладке «Моды».</div>`}
    ${res && res.length === 0 && html`<div class="empty">Ничего не найдено</div>`}
    ${res && html`<div class="mods">${res.map(m => html`<div class="mod" key=${m.id}>
      ${m.icon ? html`<img src=${m.icon} loading="lazy" />` : html`<div class="ph"></div>`}
      <div class="grow">
        <div class="row"><b class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.name}</b></div>
        <p>${m.summary}</p>
        <div class="row"><${Btn} kind="sm primary" onClick=${() => onPick(m)}>${label}</${Btn}>
          <span class="muted" style="font-size:12px">${m.author || ''} · ${Intl.NumberFormat('ru').format(m.downloads || 0)} загрузок</span></div>
      </div></div>`)}</div>`}
  </div>`;
}

function NewServerForm({ nodeId, tplId }) {
  const [v, setV] = useState({ name: '', type: 'PAPER', version: 'LATEST', memory: 4, cfSlug: '', cfName: '', templateId: tplId || '' });
  const [versions, setVersions] = useState([]);
  const [templates] = useTemplates();
  const [busy, setBusy] = useState(false);
  useEffect(() => { getVersions().then(setVersions); }, []);
  const set = o => setV(x => ({ ...x, ...o }));
  const tpl = (templates || []).find(t => t.id === v.templateId) || null;
  const isPack = v.type === 'AUTO_CURSEFORGE';
  useEffect(() => { // выбран шаблон: берём из него память
    if (tpl) set({ memory: Math.min(24, Math.max(1, parseInt(tpl.memory) || 4)) });
  }, [tpl?.id]);

  const create = async start => {
    setBusy(true);
    try {
      const body = tpl ? {
        name: v.name.trim() || tpl.name, templateId: tpl.id, memory: v.memory + 'G',
        ...(nodeId && nodeId !== 'local' ? { nodeId } : {}),
      } : {
        name: v.name.trim() || 'Новый сервер', type: v.type, memory: v.memory + 'G',
        ...(isPack ? { cfSlug: v.cfSlug } : { version: v.version }),
        ...(nodeId && nodeId !== 'local' ? { nodeId } : {}),
      };
      const s = await api('/servers', { method: 'POST', body });
      if (start) await api(`/servers/${s.id}/action`, { method: 'POST', body: { action: 'start' } });
      location.hash = '#/s/' + s.id;
    } catch (x) { toast(x.message, 'err'); }
    setBusy(false);
  };

  return html`<div class="col">
    ${templates && templates.length > 0 && html`<div class="card col">
      <h2>Шаблон</h2>
      <${Field} label="Создать по шаблону" hint="Шаблон задаёт тип, версию, память, настройки и моды. Название и память можно изменить.">
        <select value=${v.templateId} onChange=${e => set({ templateId: e.target.value })}>
          <option value="">Без шаблона</option>
          ${templates.map(t => html`<option key=${t.id} value=${t.id}>${t.name}</option>`)}
        </select></${Field}>
      ${tpl && html`<div class="banner info" style="margin:0"><b>${tpl.name}</b>: ${tplLine(tpl)}${tpl.desc ? '. ' + tpl.desc : ''}</div>`}
    </div>`}
    <div class="card col">
      <h2>Название</h2>
      <input placeholder=${tpl ? tpl.name : 'Например, Выживание с друзьями'} value=${v.name} onInput=${e => set({ name: e.target.value })} />
    </div>
    ${!tpl && html`<div class="card col">
      <h2>Тип сервера</h2>
      <div class="types">${TYPES.map(([t, d]) => html`
        <button key=${t} class=${'type ' + (v.type === t ? 'on' : '')} style=${`--tc:${TYPE_COLOR[t]}`} onClick=${() => set({ type: t })}>
          <div class="avatar">${TYPE_NAMES[t].charAt(0)}</div>
          <div><b>${TYPE_NAMES[t]}</b><small>${d}</small></div></button>`)}</div>
    </div>
    ${isPack ? html`<div class="card col">
        <h2>Сборка CurseForge</h2>
        ${v.cfSlug && html`<div class="banner info" style="margin:0">Выбрана сборка: <b>${v.cfName || v.cfSlug}</b>
          <span class="chip mono">${v.cfSlug}</span></div>`}
        <${ModpackSearch} onPick=${m => set({ cfSlug: m.slug, cfName: m.name })} label="Выбрать сборку" />
      </div>`
      : html`<div class="card col">
        <h2>Версия Minecraft</h2>
        <${Field} label="Версия" hint="LATEST - последняя стабильная. Для Forge/Fabric выбирайте версию, под которую есть нужные моды.">
          <select value=${v.version} onChange=${e => set({ version: e.target.value })}>
            <option value="LATEST">Последняя (LATEST)</option>
            ${versions.map(x => html`<option value=${x}>${x}</option>`)}
          </select>
        </${Field}>
      </div>`}`}
    <div class="card col">
      <h2>Память: ${v.memory} ГБ</h2>
      <input type="range" min="1" max="24" value=${v.memory} onInput=${e => set({ memory: +e.target.value })} />
      <small class="muted">Для ванильного сервера на несколько человек хватает 2-4 ГБ, для больших сборок обычно 6-10 ГБ.</small>
    </div>
    <div class="row">
      <${Btn} kind="primary" icon="play" disabled=${busy || (!tpl && isPack && !v.cfSlug)} onClick=${() => create(true)}>Создать и запустить</${Btn}>
      <${Btn} disabled=${busy || (!tpl && isPack && !v.cfSlug)} onClick=${() => create(false)}>Только создать</${Btn}>
    </div>
    <small class="muted">При первом запуске скачиваются образ Java и файлы сервера, это может занять несколько минут.</small>
  </div>`;
}

const IMPORT_TYPES = TYPES.filter(([t]) => t !== 'AUTO_CURSEFORGE');
const LOADER_LABEL = { FORGE: 'Версия Forge', NEOFORGE: 'Версия NeoForge', FABRIC: 'Версия Fabric Loader' };

const nodeQuery = id => (id && id !== 'local' ? '?node=' + encodeURIComponent(id) : '');

function ImportServer({ nodeId }) {
  const [target, setTarget] = useState('local'); // нода, на которую загружен архив: фиксируется в момент загрузки
  const [phase, setPhase] = useState('pick');
  const [pct, setPct] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [r, setR] = useState(null);
  const [f, setF] = useState(null);
  const [versions, setVersions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef(null);
  useEffect(() => { getVersions().then(setVersions); }, []);

  const upload = file => {
    if (!file) return;
    setPhase('upload'); setPct(0); setAnalyzing(false); setTarget(nodeId || 'local');
    const fd = new FormData();
    fd.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/import' + nodeQuery(nodeId));
    xhr.upload.onprogress = e => { if (e.lengthComputable) setPct(Math.round((e.loaded / e.total) * 100)); };
    xhr.upload.onload = () => setAnalyzing(true);
    xhr.onload = () => {
      let d = {};
      try { d = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) {
        setR(d);
        setF({
          name: d.suggestedName, type: d.type || '', version: d.version || '', loaderVersion: d.loaderVersion || '',
          memory: d.modsCount > 100 ? 8 : d.modsCount > 30 ? 6 : 4, javaTag: 'auto',
        });
        setPhase('review');
      } else { toast(d.error || 'Не удалось загрузить архив', 'err'); setPhase('pick'); }
    };
    xhr.onerror = () => { toast('Соединение прервано во время загрузки', 'err'); setPhase('pick'); };
    xhr.send(fd);
  };
  const set = o => setF(x => ({ ...x, ...o }));
  const confirmImport = async start => {
    setBusy(true);
    try {
      const s = await api(`/import/${r.token}/confirm${nodeQuery(target)}`, { method: 'POST', body: { ...f, memory: f.memory + 'G', start } });
      location.hash = '#/s/' + s.id;
    } catch (x) { toast(x.message, 'err'); }
    setBusy(false);
  };
  const cancel = async () => {
    try { await api('/import/' + r.token + nodeQuery(target), { method: 'DELETE' }); } catch {}
    setR(null); setPhase('pick');
  };

  if (phase === 'pick') {
    return html`<div class="col">
      <div class="card col">
        <h2>Архив с сервером</h2>
        <div class=${'drop ' + (drag ? 'over' : '')}
          onDragOver=${e => { e.preventDefault(); setDrag(true); }} onDragLeave=${() => setDrag(false)}
          onDrop=${e => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files[0]); }}
          onClick=${() => input.current.click()}>
          <${Icon} n="upload" size=${30} />
          <b>Перетащите архив сюда или нажмите, чтобы выбрать</b>
          <span class="muted">.zip, .tar.gz или .tgz, до 8 ГБ</span>
        </div>
        <input type="file" hidden ref=${input} accept=".zip,.tar.gz,.tgz,.tar" onChange=${e => { upload(e.target.files[0]); e.target.value = ''; }} />
        <small class="muted">Панель распакует архив и определит тип сервера и версию Minecraft по файлам: по библиотекам Forge, NeoForge и Fabric, по jar-файлам Paper и Purpur, журналу и файлу мира. Результат можно поправить вручную перед созданием.</small>
      </div>
    </div>`;
  }
  if (phase === 'upload') {
    return html`<div class="card col">
      <h2>${analyzing ? 'Распаковка и анализ…' : `Загрузка ${pct}%`}</h2>
      <${Meter} pct=${analyzing ? 100 : pct} />
      <small class="muted">${analyzing ? 'Большие архивы распаковываются дольше минуты. Не закрывайте страницу.' : 'Файл передаётся на сервер.'}</small>
    </div>`;
  }
  const needLoader = LOADER_LABEL[f.type];
  const inList = f.version === 'LATEST' || versions.includes(f.version);
  const ready = f.type && f.version;
  return html`<div class="col">
    ${r.warnings.map(w => html`<div class="banner warn" style="margin:0" key=${w}>${w}</div>`)}
    <div class="card col">
      <h2>Что нашли в архиве</h2>
      <div class="row wrap">
        <span class="chip">${fmtBytes(r.sizeBytes)}</span><span class="chip">файлов: ${r.files}</span>
        ${r.hasWorld ? html`<span class="chip">есть мир</span>` : html`<span class="chip">мира нет</span>`}
        ${r.modsCount > 0 && html`<span class="chip">модов: ${r.modsCount}</span>`}
        ${r.pluginsCount > 0 && html`<span class="chip">плагинов: ${r.pluginsCount}</span>`}
      </div>
      ${r.evidence.length ? html`<div class="code" style="white-space:pre-wrap">${r.evidence.join('\n')}</div>`
        : html`<span class="muted">Признаков сервера не найдено.</span>`}
    </div>
    <div class="card col"><h2>Параметры сервера</h2>
      <div class="fields">
        <${Field} label="Название"><input value=${f.name} onInput=${e => set({ name: e.target.value })} /></${Field}>
        <${Field} label="Тип ядра" hint=${r.type ? 'Определён автоматически, можно изменить.' : 'Определить не удалось, выберите вручную.'}>
          <select value=${f.type} onChange=${e => set({ type: e.target.value })}>
            <option value="">— выберите —</option>
            ${IMPORT_TYPES.map(([t]) => html`<option value=${t}>${TYPE_NAMES[t]}</option>`)}</select></${Field}>
        <${Field} label="Версия Minecraft" hint=${r.version ? 'Определена автоматически, можно изменить.' : 'Определить не удалось, выберите вручную.'}>
          <select value=${f.version} onChange=${e => set({ version: e.target.value })}>
            <option value="">— выберите —</option><option value="LATEST">Последняя (LATEST)</option>
            ${!inList && f.version && html`<option value=${f.version}>${f.version}</option>`}
            ${versions.map(x => html`<option value=${x}>${x}</option>`)}</select></${Field}>
        ${needLoader && html`<${Field} label=${LOADER_LABEL[f.type]} hint="Пусто — подберётся последняя подходящая версия.">
          <input class="mono" value=${f.loaderVersion} onInput=${e => set({ loaderVersion: e.target.value })} /></${Field}>`}
        <${Field} label=${'Память: ' + f.memory + ' ГБ'}>
          <input type="range" min="1" max="24" value=${f.memory} onInput=${e => set({ memory: +e.target.value })} /></${Field}>
      </div>
      <small class="muted">Файлы сервера останутся как есть: мир, моды, конфиги. Ядро и загрузчик при запуске переустановятся под выбранные версии.</small>
    </div>
    <div class="row wrap">
      <${Btn} kind="primary" icon="play" disabled=${busy || !ready} onClick=${() => confirmImport(true)}>Создать и запустить</${Btn}>
      <${Btn} disabled=${busy || !ready} onClick=${() => confirmImport(false)}>Только создать</${Btn}>
      <${Btn} kind="ghost" disabled=${busy} onClick=${cancel}>Отмена</${Btn}>
    </div>
  </div>`;
}

export function CreatePage() {
  const [mode, setMode] = useState('new');
  const [nodes] = useNodes();
  const [nodeId, setNodeId] = useState('local');
  return html`<div class="col" style="max-width:900px">
    <div class="head"><${Btn} kind="ghost icon" icon="back" onClick=${() => (location.hash = '#/')} />
      <div class="grow"><h1>Новый сервер</h1><div class="sub">Создайте сервер с нуля или загрузите готовый</div></div></div>
    <div class="seg" style="width:fit-content">
      <button class=${mode === 'new' ? 'on' : ''} onClick=${() => setMode('new')}>Создать с нуля</button>
      <button class=${mode === 'import' ? 'on' : ''} onClick=${() => setMode('import')}>Загрузить свой сервер</button></div>
    <${NodePicker} nodes=${nodes} value=${nodeId} onChange=${setNodeId} />
    ${mode === 'new' ? html`<${NewServerForm} nodeId=${nodeId} tplId=${new URLSearchParams(location.hash.split('?')[1] || '').get('tpl') || ''} />` : html`<${ImportServer} nodeId=${nodeId} />`}
  </div>`;
}

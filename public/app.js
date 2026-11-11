import { html, rawHtml, render, t, lang, setLang, LANGS, useState, useEffect, Icon, Btn, Field, Toasts, Dialogs, toast, StateBadge, Avatar, Spark, Meter, TYPE_NAMES, TYPE_COLOR, addrOf, appState, getTheme, setTheme, THEMES, getUi, setUi, useUi, UIS, fmtBytes, fmtUptime, copyText, plural, isRemote } from './ui.js';
import { api } from './api.js';
import { CreatePage } from './create.js';
import { NodesStrip, NodesSettings } from './nodes.js';
import { TemplatesSettings } from './templates.js';
import { ProxySettings, PanelProxy } from './proxy.js';
import { coverUrl } from './cover.js';
import { ServerName } from './mcfmt.js';
import { ServerPage } from './server.js';
import { BackgroundCard, loadAppearance, saveAppearance, applyBackground, applyForTheme } from './appearance.js';
import { TlsCard } from './tls.js';

setTheme(getTheme());
setUi(getUi());

const REPO = 'https://github.com/h0r1ze/HorizonCraft';
const ME = 'https://github.com/h0r1ze';

/** Подвал: копирайт и ссылки на GitHub. Показывается внизу каждой страницы и под формой входа. */
function AppFooter() {
  const v = appState.version;
  return html`<footer class="appfoot">
    <span>© 2026 <a href=${ME} target="_blank" rel="noopener noreferrer" class="auth">h0r1ze</a> · HorizonCraft${v ? ' v' + v : ''}</span>
    <a href=${REPO} target="_blank" rel="noopener noreferrer"><${Icon} n="github" size=${14} />GitHub</a>
    <a href=${REPO + '/issues/new'} target="_blank" rel="noopener noreferrer">Сообщить об ошибке</a>
    <a href=${REPO + '/blob/main/LICENSE'} target="_blank" rel="noopener noreferrer">Лицензия PolyForm NC</a>
  </footer>`;
}

function Login({ onDone }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await api('/login', { method: 'POST', body: { password: pw } }); onDone(); }
    catch (x) { setErr(x.message); }
    setBusy(false);
  };
  return html`<div class="login"><form class="card col" onSubmit=${submit}>
    <div class="row" style="gap:14px"><div class="logo" style="width:46px;height:46px;border-radius:14px"><${Icon} n="cube" size=${24} /></div>
      <div><h1 style="font-size:22px">HorizonCraft</h1><div class="muted">Панель Minecraft-серверов</div></div></div>
    <${Field} label="Пароль"><input type="password" autofocus value=${pw} onInput=${e => setPw(e.target.value)} placeholder="Введите пароль администратора" /></${Field}>
    ${err && html`<div class="banner err" style="margin:0">${err}</div>`}
    <${Btn} kind="primary" disabled=${busy || !pw} type="submit">Войти</${Btn}>
  </form><${AppFooter} /></div>`;
}

const Ring = ({ pct, label, value, sub, color }) => html`<div class="tile ringtile">
  <div class="ring" style=${`--p:${Math.max(1, Math.min(100, pct))};--rc:${color}`}><b>${Math.round(pct)}%</b></div>
  <div style="min-width:0"><div class="l">${label}</div><div class="n">${value}</div><div class="s">${sub}</div></div></div>`;

function HostTiles() {
  const ui = useUi();
  const [h, setH] = useState(null);
  useEffect(() => {
    let alive = true;
    const f = async () => { try { const x = await api('/host'); if (alive) setH(x); } catch {} };
    f(); const t = setInterval(f, 10000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  if (!h) return html`<div class="tiles">${[1, 2, 3, 4].map(i => html`<div class="skeleton" key=${i} style="height:104px"></div>`)}</div>`;
  const memPct = (h.memUsed / h.memTotal) * 100, diskUsed = h.disk.total - h.disk.free, diskPct = (diskUsed / h.disk.total) * 100;
  if (ui === 'c') {
    return html`<div class="tiles">
      <${Ring} pct=${h.cpu} label="Процессор" value=${h.cpu + '%'} sub=${`${h.cores} потоков`} color="var(--info)" />
      <${Ring} pct=${memPct} label="Память" value=${fmtBytes(h.memUsed)} sub=${t('из') + ' ' + fmtBytes(h.memTotal)} color="var(--accent)" />
      <${Ring} pct=${diskPct} label="Диск" value=${fmtBytes(diskUsed)} sub=${t('свободно') + ' ' + fmtBytes(h.disk.free)} color="var(--warn-ink)" />
      <div class="tile"><div class="l"><${Icon} n="clock" size=${14} />Аптайм хоста</div>
        <div class="n" style="font-size:22px">${fmtUptime(h.uptime)}</div><div class="s" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${h.model}</div></div>
    </div>`;
  }
  return html`<div class="tiles">
    <div class="tile"><div class="l"><${Icon} n="cpu" size=${14} />Процессор</div>
      <div class="n">${h.cpu}<small>%</small></div><div class="s">${h.cores} потоков · нагрузка ${h.load[0].toFixed(2)}</div>
      <div class="spark"><${Spark} data=${h.hist.map(x => x.cpu)} max=${100} height=${38} color="var(--info)" stroke=${1.6} /></div></div>
    <div class="tile"><div class="l"><${Icon} n="ram" size=${14} />Память</div>
      <div class="n">${fmtBytes(h.memUsed)} <small>/ ${fmtBytes(h.memTotal)}</small></div><div class="s">${Math.round(memPct)}% занято</div>
      <div class="spark"><${Spark} data=${h.hist.map(x => x.mem)} max=${h.memTotal} height=${38} color="var(--accent)" stroke=${1.6} /></div></div>
    <div class="tile"><div class="l"><${Icon} n="disk" size=${14} />Диск</div>
      <div class="n">${fmtBytes(diskUsed)} <small>/ ${fmtBytes(h.disk.total)}</small></div>
      <div style="margin:14px 0 8px"><${Meter} pct=${diskPct} /></div><div class="s">Свободно ${fmtBytes(h.disk.free)}</div></div>
    <div class="tile"><div class="l"><${Icon} n="clock" size=${14} />Аптайм хоста</div>
      <div class="n" style="font-size:24px">${fmtUptime(h.uptime)}</div><div class="s" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${h.model}</div></div>
  </div>`;
}

const updCount = s => (s.updInfo ? (s.updInfo.mods || 0) + (s.updInfo.core ? 1 : 0) : 0);

function ServerCard({ s, act }) {
  const tc = TYPE_COLOR[s.type];
  const up = s.state === 'running' || s.state === 'starting';
  return html`<div class=${'card scard' + (s.cover ? ' hascover' : '')} style=${`--tc:${tc}`} onClick=${() => (location.hash = '#/s/' + s.id)}>
    ${s.cover && html`<div class="cv" style=${`background-image:url(${coverUrl(s, true)})`}></div>`}
    <div class="row" style="gap:13px">
      <${Avatar} s=${s} />
      <div class="grow"><div class="t trunc"><${ServerName} s=${s} /></div>
        <div class="row wrap" style="gap:6px;margin-top:3px"><span class="chip tc">${TYPE_NAMES[s.type]}</span>
          ${s.type !== 'AUTO_CURSEFORGE' ? html`<span class="chip">${s.version}</span>` : s.cfSlug && html`<span class="chip trunc" style="max-width:150px">${s.cfSlug}</span>`}
          ${isRemote(s) && html`<span class="chip trunc" style="max-width:150px" title=${'Нода: ' + s.node.name}><${Icon} n="server" size=${12} />${s.node.name}</span>`}
          ${updCount(s) > 0 && html`<span class="chip warn" title="Есть обновления: откройте вкладку «Обновления»" onClick=${e => { e.stopPropagation(); location.hash = `#/s/${s.id}/updates`; }}><${Icon} n="arrowup" size=${12} />${updCount(s)}</span>`}</div></div>
      <${StateBadge} s=${s} />
    </div>
    <div class="meta">
      <div><span>Игроки</span><b>${s.players != null ? `${s.players}${s.maxPlayers ? ' / ' + s.maxPlayers : ''}` : '—'}</b></div>
      <div><span>Память</span><b>${s.mem ? fmtBytes(s.mem) : s.memory}</b></div>
      <div title=${s.cpu != null ? `≈ ${s.cores} из ${s.cpus} ядер процессора` : ''}><span>CPU</span><b>${s.cpu != null ? s.cpu + '%' : '—'}</b></div>
    </div>
    <div class="row" style="gap:8px">
      <span class="mono muted trunc grow" style="font-size:12.5px" title="Скопировать адрес" onClick=${e => { e.stopPropagation(); copyText(addrOf(s)); }}>${addrOf(s)}</span>
    </div>
    ${s.error && html`<div class="banner err" style="margin:0;padding:7px 11px;font-size:12px">${s.error}</div>`}
    <div class="row">
      ${up ? html`<${Btn} kind="sm" icon="stop" disabled=${!!s.busy} onClick=${e => act(e, s, 'stop')}>Стоп</${Btn}>
                  <${Btn} kind="sm" icon="restart" disabled=${!!s.busy} onClick=${e => act(e, s, 'restart')}>Перезапуск</${Btn}>`
        : html`<${Btn} kind="sm primary" icon="play" disabled=${!!s.busy || s.state === 'unreachable'} onClick=${e => act(e, s, 'start')}>Запустить</${Btn}>`}
      <span class="right faint" style="font-size:12px">Открыть →</span>
    </div>
  </div>`;
}

/** Серверы таблицей (виды A и C). */
function ServerTable({ list, act }) {
  return html`<div class="card pad0 stable">
    <div class="srow hd"><span>Сервер</span><span>Машина</span><span>Статус</span><span>Игроки</span><span>CPU</span><span>Память</span><span></span></div>
    ${list.map(s => {
      const up = s.state === 'running' || s.state === 'starting';
      return html`<div class="srow" key=${s.id} style=${`--tc:${TYPE_COLOR[s.type]}`} onClick=${() => (location.hash = '#/s/' + s.id)}>
        <div class="sname"><${Avatar} s=${s} />
          <div class="grow"><div class="t trunc"><${ServerName} s=${s} />
              ${updCount(s) > 0 && html` <span class="chip warn" title="Есть обновления" onClick=${e => { e.stopPropagation(); location.hash = `#/s/${s.id}/updates`; }}><${Icon} n="arrowup" size=${12} />${updCount(s)}</span>`}</div>
            <div class="mono muted trunc" style="font-size:12px;margin-top:1px">${TYPE_NAMES[s.type]}${s.type !== 'AUTO_CURSEFORGE' ? ' ' + s.version : ''} · ${addrOf(s)}</div></div></div>
        <span class="trunc">${isRemote(s) ? s.node.name : 'Эта машина'}</span>
        <span><${StateBadge} s=${s} /></span>
        <span>${s.players != null ? `${s.players}${s.maxPlayers ? ' / ' + s.maxPlayers : ''}` : '—'}</span>
        <div class="cpu"><span>${s.cpu != null ? s.cpu + '%' : '—'}</span>${s.cpu != null && html`<${Meter} pct=${s.cpu} />`}</div>
        <span>${s.mem ? fmtBytes(s.mem) : s.memory}</span>
        <div class="acts">
          ${up ? html`<${Btn} kind="sm" icon="stop" title="Остановить" disabled=${!!s.busy} onClick=${e => act(e, s, 'stop')} />
                      <${Btn} kind="sm" icon="restart" title="Перезапустить" disabled=${!!s.busy} onClick=${e => act(e, s, 'restart')} />`
            : html`<${Btn} kind="sm primary" icon="play" title="Запустить" disabled=${!!s.busy || s.state === 'unreachable'} onClick=${e => act(e, s, 'start')}>Пуск</${Btn}>`}
        </div></div>`;
    })}</div>`;
}

function Dashboard() {
  const ui = useUi();
  const [list, setList] = useState(null);
  const load = async () => { try { setList(await api('/servers')); } catch {} };
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, []);
  const act = async (e, s, action) => {
    e.stopPropagation();
    try { await api(`/servers/${s.id}/action`, { method: 'POST', body: { action } }); load(); }
    catch (x) { toast(x.message, 'err'); }
  };
  const players = (list || []).reduce((a, s) => a + (s.players || 0), 0);
  const running = (list || []).filter(s => s.state === 'running').length;
  return html`<div>
    <div class="head"><div class="grow"><h1>Обзор</h1>
      <div class="sub">${list ? `${list.length} ${plural(list.length, 'сервер', 'сервера', 'серверов')} · работает: ${running} · игроков онлайн: ${players}` : 'Загрузка…'}</div></div>
      <${Btn} kind="primary" icon="plus" onClick=${() => (location.hash = '#/new')}>Создать сервер</${Btn}></div>
    <${HostTiles} />
    <${NodesStrip} />
    <div class="row" style="margin:6px 0 14px"><h2>Серверы</h2></div>
    ${!list ? html`<div class="grid">${[1, 2].map(i => html`<div class="skeleton" key=${i} style="height:230px"></div>`)}</div>`
      : list.length === 0 ? html`<div class="card empty">
          <div class="ico"><${Icon} n="server" size=${32} /></div><h2>Серверов пока нет</h2>
          <p style="margin:0 0 18px">Создайте первый сервер: выберите версию, ядро или сборку CurseForge.</p>
          <${Btn} kind="primary" icon="plus" onClick=${() => (location.hash = '#/new')}>Создать сервер</${Btn}></div>`
      : ui === 'b' ? html`<div class="grid">${list.map(s => html`<${ServerCard} key=${s.id} s=${s} act=${act} />`)}</div>`
      : html`<${ServerTable} list=${list} act=${act} />`}
  </div>`;
}

function UiSwatch({ id }) {
  const m = {
    a: html`<i class="dk" style="left:0;top:0;bottom:0;width:11%"></i><i class="ac" style="left:15%;top:10px;width:28%;height:9px"></i><i style="left:15%;top:28px;right:8px;height:11px"></i><i style="left:15%;top:44px;right:8px;height:11px"></i><i style="left:15%;top:60px;right:8px;height:11px"></i>`,
    b: html`<i style="left:0;top:0;bottom:0;width:22%;background:var(--panel)"></i><i class="ac" style="left:26%;top:9px;width:22%;height:8px"></i><i style="left:26%;top:26px;width:21%;height:48px;border-radius:9px"></i><i style="left:50%;top:26px;width:21%;height:48px;border-radius:9px"></i><i style="left:74%;top:26px;width:21%;height:48px;border-radius:9px"></i>`,
    c: html`<i class="dk" style="left:0;right:0;top:0;height:15px"></i><i class="ac" style="left:8px;top:5px;width:16px;height:5px"></i><i style="left:8px;top:22px;width:44px;height:44px;border-radius:50%"></i><i style="left:58px;top:22px;right:8px;height:9px"></i><i style="left:58px;top:37px;right:8px;height:9px"></i><i style="left:58px;top:52px;right:8px;height:9px"></i>`,
  }[id];
  return html`<div class="uisw">${m}</div>`;
}
function UiPicker({ onUi }) {
  const cur = useUi();
  return html`<div class="uis">${UIS.map(u => html`<button key=${u.id} class=${'uibtn ' + (u.id === cur ? 'on' : '')} onClick=${() => onUi(u.id)}>
    <${UiSwatch} id=${u.id} /><b>${u.name}</b><small>${u.desc}</small></button>`)}</div>`;
}

/* Разделы настроек: у каждого свой адрес #/settings/<раздел>, поэтому ссылки ведут сразу в нужное место. */
export const SETTINGS_SECTIONS = [
  ['look', 'Оформление', 'palette', 'Язык, вид интерфейса, тема и фон'],
  ['network', 'Сеть', 'globe', 'Адрес серверов и VLESS'],
  ['security', 'Безопасность', 'shield', 'HTTPS, порт панели и пароль'],
  ['servers', 'Серверы и ноды', 'server', 'CurseForge, образы, шаблоны и ноды'],
];
function SettingsNav({ section }) {
  const ui = useUi();
  const go = k => { location.hash = '#/settings/' + k; };
  if (ui === 'a') return html`<div class="tabs flat">${SETTINGS_SECTIONS.map(([k, n, ic]) => html`<button key=${k} class=${'tab ' + (section === k ? 'on' : '')} onClick=${() => go(k)}><${Icon} n=${ic} />${n}</button>`)}</div>`;
  return html`<nav class="vmenu" aria-label="Разделы настроек"><div class="grp"><div class="gh">Настройки</div>
    ${SETTINGS_SECTIONS.map(([k, n, ic]) => html`<button key=${k} class=${'vi ' + (section === k ? 'on' : '')} onClick=${() => go(k)}><${Icon} n=${ic} size=${16} />${n}</button>`)}</div></nav>`;
}

function SettingsPage({ onTheme, theme, onUi, section: sec0 }) {
  const ui = useUi();
  const section = SETTINGS_SECTIONS.some(x => x[0] === sec0) ? sec0 : 'look';
  const meta = SETTINGS_SECTIONS.find(x => x[0] === section);
  const [s, setS] = useState(null);
  const [key, setKey] = useState('');
  const [host, setHost] = useState('');
  const [pw, setPw] = useState({ old: '', next: '' });
  const [img, setImg] = useState(null);
  const load = async () => { const x = await api('/settings'); setS(x); setHost(x.publicHost); appState.settings = x; };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const f = async () => { try { setImg(await api('/images/status')); } catch {} };
    f(); const t = setInterval(f, 3000); return () => clearInterval(t);
  }, []);
  const save = async body => {
    try {
      const r = await api('/settings', { method: 'PUT', body });
      if (body.cfApiKey && r.searchOk === false) toast('Ключ принят, но поиск CurseForge для него закрыт. Моды можно добавлять по ID проекта.', 'err');
      else toast('Сохранено');
      setKey(''); load();
    }
    catch (x) { toast(x.message, 'err'); }
  };
  const recheckCf = async () => {
    try {
      const r = await api('/settings/cf/recheck', { method: 'POST' });
      toast(r.searchOk ? 'Поиск и установка сборок CurseForge доступны' : r.searchOk === false ? 'Поиск CurseForge по-прежнему закрыт для этого ключа' : 'Не удалось связаться с CurseForge', r.searchOk ? 'ok' : 'err');
      load();
    } catch (x) { toast(x.message, 'err'); }
  };
  const changePw = async () => {
    try { await api('/password', { method: 'POST', body: pw }); toast('Пароль изменён'); setPw({ old: '', next: '' }); }
    catch (x) { toast(x.message, 'err'); }
  };
  const updImg = async () => {
    try { await api('/images/update', { method: 'POST' }); toast('Обновление образов запущено'); }
    catch (x) { toast(x.message, 'err'); }
  };
  if (!s) return html`<div class="skeleton"></div>`;
  const parts = {
    look: html`
    <div class="card col">
      <h2>Язык / Language</h2>
      <p class="muted" style="margin:0">Язык интерфейса панели. Выбор сохраняется в этом браузере. / The panel language. The choice is saved in this browser.</p>
      <${LangPicker} />
    </div>
    <div class="card col">
      <h2>Вид интерфейса</h2>
      <p class="muted" style="margin:0">Раскладка страниц: меню, вкладки сервера, список серверов. Цвета задаёт тема ниже, поэтому вид и тему можно сочетать как угодно.</p>
      <${UiPicker} onUi=${onUi} />
    </div>
    <div class="card col">
      <h2>Тема</h2>
      <${ThemePicker} theme=${theme} onTheme=${onTheme} />
    </div>
    <${BackgroundCard} theme=${theme} />`,
    network: html`
    <div class="card col">
      <h2>Адрес сервера</h2>
      <${Field} label="Внешний адрес или домен по умолчанию" hint="Показывается игрокам в панели. Если пусто, используется адрес, по которому открыта панель.">
        <input placeholder="например, play.example.com" value=${host} onInput=${e => setHost(e.target.value)} />
      </${Field}>
      <div><${Btn} kind="primary" onClick=${() => save({ publicHost: host })}>Сохранить</${Btn}></div>
    </div>
    <${ProxySettings} />`,
    security: html`
    <${TlsCard} />
    <div class="card col">
      <h2>Смена пароля</h2>
      <div class="two">
        <${Field} label="Текущий пароль"><input type="password" value=${pw.old} onInput=${e => setPw({ ...pw, old: e.target.value })} /></${Field}>
        <${Field} label="Новый пароль" hint="Минимум 8 символов"><input type="password" value=${pw.next} onInput=${e => setPw({ ...pw, next: e.target.value })} /></${Field}>
      </div>
      <div><${Btn} onClick=${changePw} disabled=${!pw.old || !pw.next}>Изменить пароль</${Btn}></div>
    </div>`,
    servers: html`
    <div class="card col">
      <h2>CurseForge</h2>
      <p class="muted" style="margin:0">Нужен для установки сборок и модов. Бесплатный ключ выдаётся на${'\u00a0'}<a href="https://console.curseforge.com/" target="_blank" rel="noreferrer">console.curseforge.com</a>${'\u00a0'}(раздел API keys).</p>
      ${s.cfApiKeySet && s.cfSearchOk === false && html`<div class="banner warn" style="margin:0">Ключ рабочий, но поиск CurseForge для него закрыт (ошибка 403). Моды ставятся по ID проекта, а сборки через CurseForge установить не получится. Это ограничение на стороне CurseForge, не панели.</div>`}
      ${s.cfApiKeySet && s.cfSearchOk === true && html`<div class="banner info" style="margin:0">Ключ рабочий, поиск и установка сборок доступны.</div>`}
      <${Field} label=${s.cfApiKeySet ? 'Ключ задан: ' + s.cfApiKeyHint : 'API-ключ'} hint="Хранится на сервере и передаётся только в контейнеры Minecraft.">
        <input type="password" placeholder=${s.cfApiKeySet ? 'Введите новый ключ, чтобы заменить' : 'Вставьте ключ'} value=${key} onInput=${e => setKey(e.target.value)} />
      </${Field}>
      <div class="row wrap"><${Btn} kind="primary" disabled=${!key} onClick=${() => save({ cfApiKey: key })}>Сохранить ключ</${Btn}>
        ${s.cfApiKeySet && html`<${Btn} icon="refresh" onClick=${recheckCf}>Проверить доступ</${Btn}>`}
        ${s.cfApiKeySet && html`<${Btn} kind="danger" onClick=${() => save({ clearCfApiKey: true })}>Удалить ключ</${Btn}>`}</div>
      ${s.cfApiKeySet && html`<${PanelProxy} s=${s} onChanged=${load} />`}
    </div>
    <div class="card col">
      <h2>Образы Minecraft</h2>
      <p class="muted" style="margin:0">Скачивает свежие образы Java и ядра. Чтобы сервер начал использовать новый образ, откройте его и выберите «Пересоздать контейнер».</p>
      <div class="row"><${Btn} icon="refresh" disabled=${!!img?.busy} onClick=${updImg}>${img?.busy || 'Обновить образы'}</${Btn}>
        ${img?.error && html`<span style="color:var(--danger)">${img.error}</span>`}</div>
    </div>
    <${TemplatesSettings} />
    <${NodesSettings} />`,
  };
  const content = html`<div class="col setbody">
    <div class="head"><div><h1>${meta[1]}</h1><div class="sub">${meta[3]}</div></div></div>
    ${parts[section]}
  </div>`;
  return ui === 'a'
    ? html`<div class="col"><${SettingsNav} section=${section} />${content}</div>`
    : html`<div class="svlayout setlayout"><${SettingsNav} section=${section} /><div class="svbody">${content}</div></div>`;
}

function ThemeSwatch({ t }) {
  return html`<div class="sw" style=${`background:${t.sw.bg}`}>
    <i style=${`left:8px;top:8px;width:46%;height:46px;background:${t.sw.panel}`}></i>
    <i style=${`right:8px;top:8px;width:30%;height:14px;background:${t.sw.accent}`}></i>
    <i style=${`right:8px;top:28px;width:30%;height:7px;background:${t.sw.text};opacity:.35`}></i>
    <i style=${`left:8px;bottom:7px;width:62%;height:5px;background:${t.sw.text};opacity:.25`}></i>
    ${t.sw.hl && html`<i style=${`right:10px;bottom:8px;width:9px;height:9px;border-radius:50%;background:${t.sw.hl}`}></i>`}</div>`;
}
const THEME_GROUPS = [['dark', 'Тёмные темы', 'moon'], ['light', 'Светлые темы', 'sun']];
function ThemePicker({ theme, onTheme }) {
  return html`<div class="col" style="gap:20px">${THEME_GROUPS.map(([mode, title, icon]) => {
    const list = THEMES.filter(t => t.mode === mode);
    return html`<section key=${mode} class="thgroup">
      <div class="thhead"><${Icon} n=${icon} size=${18} /><b>${title}</b><span class="thcount">${list.length}</span><i></i></div>
      <div class="themes">${list.map(t => html`<button key=${t.id} class=${'themebtn ' + (t.id === theme ? 'on' : '')} onClick=${() => onTheme(t.id)}>
        <${ThemeSwatch} t=${t} /><b>${t.name}</b></button>`)}</div></section>`;
  })}</div>`;
}
/** Язык интерфейса. Названия языков показываются на самих языках и не переводятся. */
const LangPicker = () => rawHtml`<div class="langs">${LANGS.map(([id, name, short]) => rawHtml`<button key=${id} class=${'langbtn ' + (id === lang ? 'on' : '')} onClick=${() => id !== lang && setLang(id)}>
  <b>${short}</b><span>${name}</span>${id === lang ? rawHtml`<${Icon} n="check" size=${16} />` : ''}</button>`)}</div>`;
function LangMenu({ mobile }) {
  const [open, setOpen] = useState(false);
  const cur = LANGS.find(l => l[0] === lang) || LANGS[0];
  return rawHtml`<div class="menu" style=${mobile ? 'flex:1;display:flex' : ''}>
    <button class="nav" style="width:100%" title=${'Language: ' + cur[1]} onClick=${() => setOpen(!open)}><${Icon} n="globe" size=${mobile ? 20 : 17} /><span class="nl">${mobile ? cur[2] : cur[1]}</span></button>
    ${open && rawHtml`<div class="menu-scrim" onClick=${() => setOpen(false)}></div>
      <div class="pop up langpop" style=${mobile ? 'left:auto;right:0' : ''}>${LANGS.map(([id, name, short]) => rawHtml`<button key=${id} class=${id === lang ? 'cur' : ''} onClick=${() => id !== lang && setLang(id)}><b class="lcode">${short}</b>${name}</button>`)}</div>`}
  </div>`;
}
/** Быстрая смена вида интерфейса из бокового меню: те же три раскладки, что и в настройках. */
function UiMenu({ onUi, mobile }) {
  const [open, setOpen] = useState(false);
  const cur = useUi();
  const u = UIS.find(x => x.id === cur) || UIS[1];
  return html`<div class="menu" style=${mobile ? 'flex:1;display:flex' : ''}>
    <button class="nav" style="width:100%" title=${'Вид: ' + u.name} onClick=${() => setOpen(!open)}><${Icon} n="layout" size=${mobile ? 20 : 17} /><span class="nl">${mobile ? 'Вид' : 'Вид: ' + u.name}</span></button>
    ${open && html`<div class="menu-scrim" onClick=${() => setOpen(false)}></div>
      <div class="pop up uipop" style=${mobile ? 'left:auto;right:0' : ''}>${UIS.map(x => html`<button key=${x.id} class=${'uiopt ' + (x.id === cur ? 'cur' : '')} onClick=${() => { onUi(x.id); setOpen(false); }}>
        <${UiSwatch} id=${x.id} /><span class="uit"><b>${x.name}</b><small>${x.desc}</small></span></button>`)}</div>`}
  </div>`;
}
function ThemeMenu({ theme, onTheme, mobile }) {
  const [open, setOpen] = useState(false);
  const cur = THEMES.find(t => t.id === theme) || THEMES[0];
  return html`<div class="menu" style=${mobile ? 'flex:1;display:flex' : ''}>
    <button class="nav" style="width:100%" title=${'Тема: ' + cur.name} onClick=${() => setOpen(!open)}><${Icon} n="palette" size=${mobile ? 20 : 17} /><span class="nl">${mobile ? 'Тема' : 'Тема: ' + cur.name}</span></button>
    ${open && html`<div class="menu-scrim" onClick=${() => setOpen(false)}></div>
      <div class="pop up themepop" style=${mobile ? 'left:auto;right:0' : ''}>${THEME_GROUPS.map(([mode, title, icon]) => html`<div key=${mode} class="pgrp">
        <div class="pgh"><${Icon} n=${icon} size=${14} />${title}</div>
        ${THEMES.filter(t => t.mode === mode).map(t => html`<button key=${t.id} class=${t.id === theme ? 'cur' : ''} onClick=${() => { onTheme(t.id); setOpen(false); }}>
          <span class="sw2" style=${`background:linear-gradient(135deg,${t.sw.bg} 50%,${t.sw.accent} 50%)`}></span>${t.name}</button>`)}</div>`)}</div>`}
  </div>`;
}

function App() {
  const [auth, setAuth] = useState(null);
  const [theme, setThemeState] = useState(getTheme());
  const [route, setRoute] = useState(location.hash || '#/');
  useEffect(() => {
    const f = () => { setRoute(location.hash || '#/'); scrollTo(0, 0); };
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  const check = async () => {
    try { const me = await api('/me'); appState.version = me.version || ''; appState.settings = await api('/settings'); setAuth(true); syncLook(); } catch { setAuth(false); }
  };
  useEffect(() => { check(); }, []);
  // Последняя выбранная тема и фон хранятся на сервере: при входе подтягиваем их, при смене сохраняем
  const syncLook = async () => {
    try {
      const a = await loadAppearance();
      if (a.theme && THEMES.some(t => t.id === a.theme)) { if (a.theme !== getTheme()) { setTheme(a.theme); setThemeState(a.theme); applyForTheme(a.theme); } }
      else saveAppearance({ theme: getTheme() }).catch(() => {});
    } catch {}
  };
  const onTheme = t => { setTheme(t); setThemeState(t); applyForTheme(t); saveAppearance({ theme: t }).catch(() => {}); };
  // Вид меняет только раскладку. Тему (последний выбор пользователя) он не трогает.
  const onUi = u => setUi(u);
  if (auth === null) return html`<div class="login"><div class="skeleton" style="width:300px"></div></div>`;
  if (!auth) return html`<${Login} onDone=${check} /><${Toasts} /><${Dialogs} />`;

  const m = /^#\/s\/([a-f0-9]{8})(?:\/(\w+))?/.exec(route);
  let page;
  if (m) page = html`<${ServerPage} key=${m[1]} id=${m[1]} tab=${m[2] || 'overview'} />`;
  else if (route.split('?')[0] === '#/new') page = html`<${CreatePage} />`;
  else if (route.split('?')[0].startsWith('#/settings')) page = html`<${SettingsPage} theme=${theme} onTheme=${onTheme} onUi=${onUi} section=${route.split('?')[0].split('/')[2] || ''} />`;
  else page = html`<${Dashboard} />`;
  const settingsOn = route.startsWith('#/settings');
  const logout = async () => { await api('/logout', { method: 'POST' }); applyBackground(null); setAuth(false); };

  return html`<div class="shell">
    <aside class="side">
      <div class="brand"><div class="logo"><${Icon} n="cube" size=${19} /></div><span class="nl">HorizonCraft</span></div>
      <div class="navlabel">Управление</div>
      <button class=${'nav ' + (!settingsOn && route.split('?')[0] !== '#/new' ? 'on' : '')} title="Обзор" onClick=${() => (location.hash = '#/')}><${Icon} n="home" /><span class="nl">Обзор</span></button>
      <button class=${'nav ' + (route.split('?')[0] === '#/new' ? 'on' : '')} title="Новый сервер" onClick=${() => (location.hash = '#/new')}><${Icon} n="plus" /><span class="nl">Новый сервер</span></button>
      <button class=${'nav ' + (settingsOn ? 'on' : '')} title="Настройки" onClick=${() => (location.hash = '#/settings')}><${Icon} n="gear" /><span class="nl">Настройки</span></button>
      <div class="sp"></div>
      <div class="sidefoot">
        <${LangMenu} />
        <${UiMenu} onUi=${onUi} />
        <${ThemeMenu} theme=${theme} onTheme=${onTheme} />
        <a class="nav" href=${REPO} target="_blank" rel="noopener noreferrer" title="Исходный код на GitHub"><${Icon} n="github" /><span class="nl">GitHub</span></a>
        <button class="nav" title="Выйти" onClick=${logout}><${Icon} n="logout" /><span class="nl">Выйти</span></button>
      </div>
    </aside>
    <main class="main" key=${route}><div class="pagebody">${page}</div><${AppFooter} /></main>
    <nav class="bottomnav">
      <button class=${'nav ' + (!settingsOn ? 'on' : '')} onClick=${() => (location.hash = '#/')}><${Icon} n="home" size=${20} />Обзор</button>
      <button class="nav" onClick=${() => (location.hash = '#/new')}><${Icon} n="plus" size=${20} />Создать</button>
      <button class=${'nav ' + (settingsOn ? 'on' : '')} onClick=${() => (location.hash = '#/settings')}><${Icon} n="gear" size=${20} />Настройки</button>
      <${LangMenu} mobile=${true} />
      <${UiMenu} onUi=${onUi} mobile=${true} />
      <${ThemeMenu} theme=${theme} onTheme=${onTheme} mobile=${true} />
    </nav>
    <${Toasts} />
    <${Dialogs} />
  </div>`;
}

render(html`<${App} />`, document.getElementById('app'));

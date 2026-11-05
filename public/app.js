import { html, render, useState, useEffect, Icon, Btn, Field, Toasts, Dialogs, toast, StateBadge, Avatar, Spark, Meter, TYPE_NAMES, TYPE_COLOR, addrOf, appState, getTheme, setTheme, THEMES, fmtBytes, fmtUptime, copyText, plural, isRemote } from './ui.js';
import { api } from './api.js';
import { CreatePage } from './create.js';
import { NodesStrip, NodesSettings } from './nodes.js';
import { ProxySettings, PanelProxy } from './proxy.js';
import { coverUrl } from './cover.js';
import { ServerName } from './mcfmt.js';
import { ServerPage } from './server.js';

setTheme(getTheme());

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
  </form></div>`;
}

function HostTiles() {
  const [h, setH] = useState(null);
  useEffect(() => {
    let alive = true;
    const f = async () => { try { const x = await api('/host'); if (alive) setH(x); } catch {} };
    f(); const t = setInterval(f, 10000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  if (!h) return html`<div class="tiles">${[1, 2, 3, 4].map(i => html`<div class="skeleton" key=${i} style="height:104px"></div>`)}</div>`;
  const memPct = (h.memUsed / h.memTotal) * 100, diskUsed = h.disk.total - h.disk.free, diskPct = (diskUsed / h.disk.total) * 100;
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
          ${isRemote(s) && html`<span class="chip trunc" style="max-width:150px" title=${'Нода: ' + s.node.name}><${Icon} n="server" size=${12} />${s.node.name}</span>`}</div></div>
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

function Dashboard() {
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
      : html`<div class="grid">${list.map(s => html`<${ServerCard} key=${s.id} s=${s} act=${act} />`)}</div>`}
  </div>`;
}

function SettingsPage({ onTheme, theme }) {
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
  return html`<div class="col" style="max-width:760px">
    <div class="head"><div><h1>Настройки</h1><div class="sub">Общие параметры панели</div></div></div>
    <div class="card col">
      <h2>Внешний вид</h2>
      <${ThemePicker} theme=${theme} onTheme=${onTheme} />
    </div>
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
      <h2>Адрес сервера</h2>
      <${Field} label="Внешний адрес или домен по умолчанию" hint="Показывается игрокам в панели. Если пусто, используется адрес, по которому открыта панель.">
        <input placeholder="например, play.example.com" value=${host} onInput=${e => setHost(e.target.value)} />
      </${Field}>
      <div><${Btn} kind="primary" onClick=${() => save({ publicHost: host })}>Сохранить</${Btn}></div>
    </div>
    <${NodesSettings} />
    <${ProxySettings} />
    <div class="card col">
      <h2>Образы Minecraft</h2>
      <p class="muted" style="margin:0">Скачивает свежие образы Java и ядра. Чтобы сервер начал использовать новый образ, откройте его и выберите «Пересоздать контейнер».</p>
      <div class="row"><${Btn} icon="refresh" disabled=${!!img?.busy} onClick=${updImg}>${img?.busy || 'Обновить образы'}</${Btn}>
        ${img?.error && html`<span style="color:var(--danger)">${img.error}</span>`}</div>
    </div>
    <div class="card col">
      <h2>Смена пароля</h2>
      <div class="two">
        <${Field} label="Текущий пароль"><input type="password" value=${pw.old} onInput=${e => setPw({ ...pw, old: e.target.value })} /></${Field}>
        <${Field} label="Новый пароль" hint="Минимум 8 символов"><input type="password" value=${pw.next} onInput=${e => setPw({ ...pw, next: e.target.value })} /></${Field}>
      </div>
      <div><${Btn} onClick=${changePw} disabled=${!pw.old || !pw.next}>Изменить пароль</${Btn}></div>
    </div>
  </div>`;
}

function ThemeSwatch({ t }) {
  return html`<div class="sw" style=${`background:${t.sw.bg}`}>
    <i style=${`left:8px;top:8px;width:46%;height:46px;background:${t.sw.panel}`}></i>
    <i style=${`right:8px;top:8px;width:30%;height:14px;background:${t.sw.accent}`}></i>
    <i style=${`right:8px;top:28px;width:30%;height:7px;background:${t.sw.text};opacity:.35`}></i>
    <i style=${`left:8px;bottom:7px;width:62%;height:5px;background:${t.sw.text};opacity:.25`}></i>
    ${t.sw.hl && html`<i style=${`right:10px;bottom:8px;width:9px;height:9px;border-radius:50%;background:${t.sw.hl}`}></i>`}</div>`;
}
function ThemePicker({ theme, onTheme }) {
  return html`<div class="themes">${THEMES.map(t => html`<button key=${t.id} class=${'themebtn ' + (t.id === theme ? 'on' : '')} onClick=${() => onTheme(t.id)}>
    <${ThemeSwatch} t=${t} /><b>${t.name}</b><small>${t.mode === 'dark' ? 'тёмная' : 'светлая'}</small></button>`)}</div>`;
}
function ThemeMenu({ theme, onTheme, mobile }) {
  const [open, setOpen] = useState(false);
  const cur = THEMES.find(t => t.id === theme) || THEMES[0];
  return html`<div class="menu" style=${mobile ? 'flex:1;display:flex' : ''}>
    <button class="nav" style="width:100%" onClick=${() => setOpen(!open)}><${Icon} n="palette" size=${mobile ? 20 : 17} />${mobile ? 'Тема' : 'Тема: ' + cur.name}</button>
    ${open && html`<div class="menu-scrim" onClick=${() => setOpen(false)}></div>
      <div class="pop up" style=${mobile ? 'left:auto;right:0' : ''}>${THEMES.map(t => html`<button key=${t.id} class=${t.id === theme ? 'cur' : ''} onClick=${() => { onTheme(t.id); setOpen(false); }}>
        <span class="sw2" style=${`background:linear-gradient(135deg,${t.sw.bg} 50%,${t.sw.accent} 50%)`}></span>${t.name}</button>`)}</div>`}
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
    try { await api('/me'); appState.settings = await api('/settings'); setAuth(true); } catch { setAuth(false); }
  };
  useEffect(() => { check(); }, []);
  const onTheme = t => { setTheme(t); setThemeState(t); };
  if (auth === null) return html`<div class="login"><div class="skeleton" style="width:300px"></div></div>`;
  if (!auth) return html`<${Login} onDone=${check} /><${Toasts} /><${Dialogs} />`;

  const m = /^#\/s\/([a-f0-9]{8})(?:\/(\w+))?/.exec(route);
  let page;
  if (m) page = html`<${ServerPage} key=${m[1]} id=${m[1]} tab=${m[2] || 'overview'} />`;
  else if (route === '#/new') page = html`<${CreatePage} />`;
  else if (route === '#/settings') page = html`<${SettingsPage} theme=${theme} onTheme=${onTheme} />`;
  else page = html`<${Dashboard} />`;
  const settingsOn = route.startsWith('#/settings');
  const logout = async () => { await api('/logout', { method: 'POST' }); setAuth(false); };

  return html`<div class="shell">
    <aside class="side">
      <div class="brand"><div class="logo"><${Icon} n="cube" size=${19} /></div>HorizonCraft</div>
      <div class="navlabel">Управление</div>
      <button class=${'nav ' + (!settingsOn ? 'on' : '')} onClick=${() => (location.hash = '#/')}><${Icon} n="home" />Обзор</button>
      <button class="nav" onClick=${() => (location.hash = '#/new')}><${Icon} n="plus" />Новый сервер</button>
      <button class=${'nav ' + (settingsOn ? 'on' : '')} onClick=${() => (location.hash = '#/settings')}><${Icon} n="gear" />Настройки</button>
      <div class="sp"></div>
      <div class="sidefoot">
        <${ThemeMenu} theme=${theme} onTheme=${onTheme} />
        <button class="nav" onClick=${logout}><${Icon} n="logout" />Выйти</button>
      </div>
    </aside>
    <main class="main" key=${route}>${page}</main>
    <nav class="bottomnav">
      <button class=${'nav ' + (!settingsOn ? 'on' : '')} onClick=${() => (location.hash = '#/')}><${Icon} n="home" size=${20} />Обзор</button>
      <button class="nav" onClick=${() => (location.hash = '#/new')}><${Icon} n="plus" size=${20} />Создать</button>
      <button class=${'nav ' + (settingsOn ? 'on' : '')} onClick=${() => (location.hash = '#/settings')}><${Icon} n="gear" size=${20} />Настройки</button>
      <${ThemeMenu} theme=${theme} onTheme=${onTheme} mobile=${true} />
    </nav>
    <${Toasts} />
    <${Dialogs} />
  </div>`;
}

render(html`<${App} />`, document.getElementById('app'));

import { html, useState, useEffect, useRef, askConfirm, askText, Icon, Btn, Field, Toggle, Modal, Spark, Meter, Avatar, toast, StateBadge, TYPE_NAMES, TYPE_COLOR, fmtBytes, addrOf, uptime, ago, copyText, plural, appState } from './ui.js';
import { api, getVersions } from './api.js';
import { ModpackSearch } from './create.js';
import { ServerProxy } from './proxy.js';
import { CoverCard, CoverEditor, coverUrl } from './cover.js';
import { McEditor, MotdPreview, FmtText, ColorRow, ServerName } from './mcfmt.js';
import { escape as mcEsc, strip as mcStrip } from './mc.js';

const TABS = [
  ['overview', 'Обзор', 'chart'], ['console', 'Консоль', 'terminal'], ['players', 'Игроки', 'users'],
  ['config', 'Настройки', 'sliders'], ['mods', 'Моды', 'puzzle'], ['backups', 'Бэкапы', 'archive'],
  ['schedule', 'Расписание', 'clock'], ['network', 'Сеть и домен', 'globe'], ['files', 'Файлы', 'folder'],
];

function Menu({ children }) {
  const [open, setOpen] = useState(false);
  return html`<div class="menu">
    <${Btn} kind="icon" icon="dots" title="Ещё" onClick=${() => setOpen(!open)} />
    ${open && html`<div class="menu-scrim" onClick=${() => setOpen(false)}></div><div class="pop" onClick=${() => setOpen(false)}>${children}</div>`}
  </div>`;
}

export function ServerPage({ id, tab }) {
  const [s, setS] = useState(null);
  const [coverOpen, setCoverOpen] = useState(null);
  const load = async () => {
    try { setS(await api('/servers/' + id)); }
    catch (e) { if (e.status === 404) location.hash = '#/'; }
  };
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, [id]);
  if (!s) return html`<div class="skeleton" style="height:300px"></div>`;

  const act = async action => {
    try { await api(`/servers/${id}/action`, { method: 'POST', body: { action } }); load(); }
    catch (x) { toast(x.message, 'err'); }
  };
  const del = async () => {
    const r = await askConfirm(`Удалить сервер «${s.name}»?`, { checkbox: 'Удалить также мир и все файлы сервера (безвозвратно)' });
    if (!r) return;
    const withData = r.checked;
    try { await api(`/servers/${id}?data=${withData ? 1 : 0}`, { method: 'DELETE' }); location.hash = '#/'; }
    catch (x) { toast(x.message, 'err'); }
  };
  const clone = async () => {
    const r = await askText('Клонировать сервер', { label: 'Название копии', value: s.name + ' (копия)', required: true, ok: 'Создать копию', checkbox: s.state === 'stopped' || s.state === 'missing' ? 'Скопировать также мир и файлы' : null });
    if (!r) return;
    const name = r.value, withData = !!r.checked;
    try { const c = await api(`/servers/${id}/clone`, { method: 'POST', body: { name, withData } }); toast('Копия создана'); location.hash = '#/s/' + c.id; }
    catch (x) { toast(x.message, 'err'); }
  };
  const up = s.state === 'running' || s.state === 'starting';

  const body = {
    overview: () => html`<${OverviewTab} s=${s} />`,
    console: () => html`<${ConsoleTab} s=${s} />`,
    players: () => html`<${PlayersTab} s=${s} />`,
    config: () => html`<${ConfigTab} s=${s} reload=${load} />`,
    mods: () => html`<${ModsTab} s=${s} reload=${load} />`,
    backups: () => html`<${BackupsTab} s=${s} />`,
    schedule: () => html`<${ScheduleTab} s=${s} />`,
    network: () => html`<${NetworkTab} s=${s} reload=${load} />`,
    files: () => html`<${FilesTab} s=${s} />`,
  }[tab] || (() => null);

  return html`<div>
    ${s.cover && html`<div class="hero page-hero" style=${`background-image:url(${coverUrl(s)})`}></div>`}
    ${coverOpen && html`<${CoverEditor} s=${s} kind=${coverOpen} onClose=${() => setCoverOpen(null)} onSaved=${() => { setCoverOpen(null); load(); }} />`}
    <div class="head" style=${`--tc:${TYPE_COLOR[s.type]}`}>
      <${Btn} kind="ghost icon" icon="back" onClick=${() => (location.hash = '#/')} />
      <${Avatar} s=${s} lg=${true} />
      <div class="grow"><div class="row wrap"><h1><${ServerName} s=${s} /></h1><${StateBadge} s=${s} /></div>
        <div class="sub row wrap" style="gap:10px;margin-top:4px">
          <span class="chip tc">${TYPE_NAMES[s.type]}${s.type !== 'AUTO_CURSEFORGE' ? ' ' + s.version : ''}</span>
          ${s.type === 'AUTO_CURSEFORGE' && s.cfSlug && html`<span class="chip">${s.cfSlug}</span>`}
          ${s.proxy?.on && html`<span class="chip" title="Прокси включён" style="color:var(--info)"><${Icon} n="globe" size=${12} />прокси: ${s.proxy.scope === 'all' ? 'весь трафик' : 'установка'}</span>`}
          <span class="addr" title="Скопировать" onClick=${() => copyText(addrOf(s))}>${addrOf(s)}<${Icon} n="copy" size=${13} /></span>
          ${s.state === 'running' && html`<span>работает ${uptime(s.startedAt)}</span>`}
          ${s.players != null && html`<span>игроков: <b style="color:var(--text)">${s.players}${s.maxPlayers ? ' / ' + s.maxPlayers : ''}</b></span>`}</div></div>
      <div class="row wrap">
        ${up ? html`<${Btn} icon="stop" disabled=${!!s.busy} onClick=${() => act('stop')}>Стоп</${Btn}>
                    <${Btn} icon="restart" disabled=${!!s.busy} onClick=${() => act('restart')}>Перезапуск</${Btn}>`
             : html`<${Btn} kind="primary" icon="play" disabled=${!!s.busy} onClick=${() => act('start')}>Запустить</${Btn}>`}
        <${Menu}>
          ${up && html`<button class="red" onClick=${async () => (await askConfirm('Принудительно убить процесс? Мир может не сохраниться.')) && act('kill')}><${Icon} n="bolt" />Принудительно остановить</button><hr />`}
          <button onClick=${() => setCoverOpen('logo')}><${Icon} n="cube" />${s.logo ? 'Изменить значок' : 'Добавить значок'}</button>
          <button onClick=${() => setCoverOpen('cover')}><${Icon} n="upload" />${s.cover ? 'Изменить обложку' : 'Добавить обложку'}</button>
          <button onClick=${clone}><${Icon} n="clone" />Клонировать сервер</button>
          <button onClick=${async () => (await askConfirm('Контейнер будет пересоздан (мир сохранится). Это применит обновлённый образ. Продолжить?')) && act('recreate')}><${Icon} n="refresh" />Пересоздать контейнер</button>
          <hr /><button class="red" onClick=${del}><${Icon} n="trash" />Удалить сервер</button>
        </${Menu}>
      </div>
    </div>
    ${s.error && html`<div class="banner err"><b>Ошибка:</b> ${s.error}</div>`}
    ${s.outdated && html`<div class="banner warn flex"><span class="grow">Настройки изменены. Они применятся при следующем запуске.</span>
      ${up && html`<${Btn} kind="sm" icon="restart" disabled=${!!s.busy} onClick=${() => act('restart')}>Перезапустить сейчас</${Btn}>`}</div>`}
    <div class="tabs">${TABS.map(([k, l, ic]) => html`<button key=${k} class=${'tab ' + (tab === k ? 'on' : '')}
      onClick=${() => (location.hash = `#/s/${id}/${k}`)}><${Icon} n=${ic} />${l}</button>`)}</div>
    ${body()}
  </div>`;
}

/* ---------------- Обзор ---------------- */
const memBytes = m => { const x = /^(\d+)([MG])$/.exec(m || ''); return x ? +x[1] * (x[2] === 'G' ? 1024 ** 3 : 1024 ** 2) : 0; };

/* ---------------- Чат ---------------- */
const fmtClock = t => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
function ChatName({ e, tags }) {
  const tag = e.nick && tagOf(tags, e.nick);
  if (e.fmt) return html`<${FmtText} real src=${e.name} />`;
  if (!tag) return e.name;
  return html`${tag.prefix ? html`<${FmtText} real src=${tag.prefix} /> ` : ''}<span style=${`color:var(--mc${tag.color || 'f'})`}>${e.nick}</span>${tag.suffix ? html` <${FmtText} real src=${tag.suffix} />` : ''}`;
}
function ChatLine({ e, tags }) {
  const cls = { join: 'y', leave: 'y', adv: 'g', death: '', say: 'p' }[e.k] || '';
  return html`<div class=${'ml ' + cls}><span class="tm">${fmtClock(e.t)}</span>${e.k === 'chat'
    ? html`<span>${'<'}<${ChatName} e=${e} tags=${tags} />${'> '}${e.fmt ? html`<${FmtText} real src=${e.text} />` : e.text}</span>`
    : e.k === 'say' ? html`<span>[${e.name}] ${e.text}</span>` : html`<span>${e.text}</span>`}</div>`;
}
function ChatCard({ s }) {
  const [ev, setEv] = useState(null);
  const [tags, setTags] = useState({});
  const [up, setUp] = useState(false);
  const [text, setText] = useState('');
  const [from, setFrom] = useState(() => { try { return localStorage.getItem('hc-chat-from') || 'Сервер'; } catch { return 'Сервер'; } });
  const [sending, setSending] = useState(false);
  const box = useRef(null), stick = useRef(true), last = useRef(0);
  useEffect(() => {
    let dead = false;
    setEv(null); last.current = 0; stick.current = true;
    const load = async () => {
      try {
        const r = await api(`/servers/${s.id}/chat${last.current ? '?after=' + last.current : ''}`);
        if (dead) return;
        setTags(r.tags || {}); setUp(r.running);
        if (!last.current) setEv(r.events);
        else if (r.events.length) setEv(x => [...(x || []), ...r.events].slice(-500));
        if (r.events.length) last.current = Math.max(last.current, ...r.events.map(e => e.t));
        else if (!last.current) last.current = 1;
      } catch {}
    };
    load();
    const t = setInterval(load, 2500);
    return () => { dead = true; clearInterval(t); };
  }, [s.id]);
  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [ev]);
  const onScroll = () => { const el = box.current; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; };
  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await api(`/servers/${s.id}/chat`, { method: 'POST', body: { name: from, text } });
      try { localStorage.setItem('hc-chat-from', from); } catch {}
      setText(''); stick.current = true;
      const r = await api(`/servers/${s.id}/chat?after=${last.current}`);
      if (r.events.length) { setEv(x => [...(x || []), ...r.events].slice(-500)); last.current = Math.max(last.current, ...r.events.map(e => e.t)); }
    } catch (x) { toast(x.message, 'err'); } finally { setSending(false); }
  };
  return html`<div class="card col"><h2>Чат сервера <span class="sub">${ev ? ev.filter(e => e.k === 'chat' || e.k === 'say').length + ' сообщений в истории' : ''}</span></h2>
    <div class="mc-chat mcreal" ref=${box} onScroll=${onScroll}>
      ${ev === null ? html`<div class="ml y">Загрузка…</div>`
        : ev.length ? ev.map((e, i) => html`<${ChatLine} key=${e.t + '-' + i} e=${e} tags=${tags} />`)
        : html`<div class="ml y">В чате пока ничего нет. Сообщения игроков, входы и выходы появятся здесь.</div>`}
    </div>
    <div class="row chatsend">
      <input style="width:150px;flex:none" value=${from} placeholder="От имени" title="Имя отправителя. Можно использовать цветовые коды &, например &6Админ" onInput=${e => setFrom(e.target.value)} />
      <input class="grow" value=${text} placeholder=${up ? 'Сообщение всем игрокам (Enter — отправить)' : 'Сервер не запущен'} disabled=${!up} maxlength="240"
        onInput=${e => setText(e.target.value)} onKeyDown=${e => e.key === 'Enter' && send()} />
      <${Btn} kind="primary" icon="msg" disabled=${!up || !text.trim() || sending} onClick=${send}>Отправить</${Btn}>
    </div>
  </div>`;
}

function OverviewTab({ s }) {
  const [o, setO] = useState(null);
  const [msg, setMsg] = useState('');
  const load = async () => { try { setO(await api(`/servers/${s.id}/overview`)); } catch {} };
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [s.id]);
  const say = async () => {
    try { await api(`/servers/${s.id}/say`, { method: 'POST', body: { message: msg } }); toast('Отправлено всем игрокам'); setMsg(''); }
    catch (x) { toast(x.message, 'err'); }
  };
  const backup = async () => {
    try { await api(`/servers/${s.id}/backups`, { method: 'POST' }); toast('Резервная копия создаётся…'); }
    catch (x) { toast(x.message, 'err'); }
  };
  if (!o) return html`<div class="skeleton" style="height:260px"></div>`;
  const hist = o.hist, last = hist[hist.length - 1] || { cpu: 0, mem: 0, players: 0 };
  const limit = memBytes(s.memory);
  const live = s.state === 'running' || s.state === 'starting';
  return html`<div class="col">
    ${!live && html`<div class="banner info" style="margin:0">Сервер ${s.state === 'missing' ? 'ещё не запускался' : 'остановлен'}. Графики появятся после запуска.</div>`}
    <div class="charts">
      <div class="card chart"><h3><span>Игроки</span><span class="faint">за ~30 мин</span></h3>
        <div class="big">${live ? last.players : '—'}<small class="muted" style="font-size:14px;font-weight:500"> / ${s.maxPlayers || s.props?.MAX_PLAYERS || '?'}</small></div>
        <${Spark} data=${hist.map(x => x.players)} max=${Math.max(5, ...hist.map(x => x.players)) * 1.2} height=${70} color="var(--info)" /></div>
      <div class="card chart"><h3><span>Процессор</span><span class="faint">за ~30 мин</span></h3>
        <div class="big">${live ? last.cpu + '%' : '—'}${live && html`<small class="muted" style="font-size:13px;font-weight:500"> ≈ ${last.cores ?? 0} из ${s.cpus || '?'} ядер</small>`}</div>
        <${Spark} data=${hist.map(x => x.cpu)} max=${Math.min(100, Math.max(10, ...hist.map(x => x.cpu)) * 1.25)} height=${70} color="var(--warn)" /></div>
      <div class="card chart"><h3><span>Память</span><span class="faint">лимит ${s.memory}</span></h3>
        <div class="big">${live ? fmtBytes(last.mem) : '—'}</div>
        <${Spark} data=${hist.map(x => x.mem)} max=${limit || undefined} height=${70} color="var(--accent)" /></div>
    </div>
    <div class="two">
      <div class="card"><h2>О сервере</h2>
        <dl class="kvlist">
          <dt>Адрес</dt><dd><span class="addr" onClick=${() => copyText(addrOf(s))}>${addrOf(s)}<${Icon} n="copy" size=${13} /></span></dd>
          <dt>Ядро</dt><dd>${TYPE_NAMES[s.type]}${s.type === 'AUTO_CURSEFORGE' ? ' · ' + (s.cfSlug || '—') : ' ' + s.version}</dd>
          <dt>Образ Java</dt><dd class="mono" style="font-size:12.5px">${s.image.split(':')[1]}</dd>
          <dt>Порт</dt><dd>${s.port}</dd>
          <dt>Размер на диске</dt><dd>${fmtBytes(o.diskBytes)}</dd>
          <dt>Резервные копии</dt><dd>${o.backups ? `${o.backups} шт. · ${fmtBytes(o.backupsSize)} · ${ago(o.lastBackup)}` : 'нет'}</dd>
          <dt>Создан</dt><dd>${new Date(s.createdAt).toLocaleDateString('ru')}</dd>
        </dl></div>
      <div class="card col"><h2>Быстрые действия</h2>
        <${Field} label="Сообщение всем игрокам">
          <div class="row"><input placeholder="Например: через 5 минут перезагрузка" value=${msg} onInput=${e => setMsg(e.target.value)} onKeyDown=${e => e.key === 'Enter' && msg && say()} />
            <${Btn} kind="primary" icon="msg" disabled=${!msg || s.state !== 'running'} onClick=${say}>Отправить</${Btn}></div></${Field}>
        <div class="row wrap">
          <${Btn} icon="archive" disabled=${!!s.busy} onClick=${backup}>Сделать бэкап</${Btn}>
          <${Btn} icon="terminal" onClick=${() => (location.hash = `#/s/${s.id}/console`)}>Консоль</${Btn}>
          <${Btn} icon="folder" onClick=${() => (location.hash = `#/s/${s.id}/files`)}>Файлы</${Btn}>
        </div>
        <div><h3 style="margin-bottom:10px">Сейчас на сервере</h3>
          ${o.online.length ? html`<div class="list">${o.online.map(n => html`<div class="pcard" key=${n}>
              <img src=${'https://mc-heads.net/avatar/' + n + '/24'} width="24" height="24" onError=${e => (e.target.style.display = 'none')} /><b>${n}</b></div>`)}</div>`
            : html`<span class="muted">Никого нет</span>`}</div>
      </div>
    </div>
    <${ChatCard} s=${s} />
  </div>`;
}

/* ---------------- Консоль ---------------- */
const stripAnsi = t => t.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');

function ConsoleTab({ s }) {
  const [lines, setLines] = useState([]);
  const [input, setInput] = useState('');
  const [filter, setFilter] = useState('');
  const [atBottom, setAtBottom] = useState(true);
  const box = useRef(null), ws = useRef(null), stick = useRef(true), force = useRef(0);
  const hist = useRef({ list: [], i: -1 });
  const push = (text, cls = '') => setLines(l => {
    const add = stripAnsi(text).split('\n').filter(x => x.length).map(t => ({ t, cls }));
    return [...l, ...add].slice(-3000);
  });
  useEffect(() => {
    let closed = false, timer;
    const connect = () => {
      const w = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + `/ws/servers/${s.id}/console`);
      ws.current = w;
      w.onopen = () => setLines([]);
      w.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.type === 'log') push(m.data, /\bERROR\b|Exception/.test(m.data) ? 'error' : /\bWARN\b/.test(m.data) ? 'warn' : '');
        else if (m.type === 'resp') push(m.data, 'resp');
        else if (m.type === 'info') push(m.data, 'dim');
      };
      w.onclose = () => { if (!closed) timer = setTimeout(connect, 2500); };
    };
    connect();
    return () => { closed = true; clearTimeout(timer); ws.current && ws.current.close(); };
  }, [s.id, s.state === 'missing']);
  const shown = filter ? lines.filter(l => l.t.toLowerCase().includes(filter.toLowerCase())) : lines;
  // Прокрутка зависит от самого массива строк, а не от его длины: после 3000 строк длина не растёт.
  useEffect(() => {
    const el = box.current;
    if (el && (stick.current || Date.now() < force.current)) {
      el.scrollTop = el.scrollHeight;
      requestAnimationFrame(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; });
    }
  }, [lines, filter]);
  const send = cmd => {
    cmd = (cmd ?? input).trim();
    if (!cmd) return;
    if (!ws.current || ws.current.readyState !== 1) return toast('Нет соединения с консолью', 'err');
    stick.current = true; force.current = Date.now() + 4000;   // ответ на команду всегда показываем
    push('> ' + cmd, 'cmd');
    ws.current.send(JSON.stringify({ type: 'cmd', data: cmd }));
    hist.current.list.push(cmd); hist.current.i = -1;
    setInput('');
  };
  const key = e => {
    const h = hist.current;
    if (e.key === 'Enter') send();
    else if (e.key === 'ArrowUp' && h.list.length) {
      h.i = h.i < 0 ? h.list.length - 1 : Math.max(0, h.i - 1); setInput(h.list[h.i]); e.preventDefault();
    } else if (e.key === 'ArrowDown' && h.i >= 0) {
      h.i++; setInput(h.i >= h.list.length ? (h.i = -1, '') : h.list[h.i]); e.preventDefault();
    }
  };
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.map(l => l.t).join('\n')], { type: 'text/plain' }));
    a.download = `${s.name}-console.log`;
    a.click();
  };
  return html`<div>
    <div class="cwrap">
      <div class="cbar"><div class="dots"><i></i><i></i><i></i></div><span class="mono grow">${s.name} · console</span>
        <input placeholder="Фильтр" value=${filter} onInput=${e => setFilter(e.target.value)} />
        <${Btn} kind="sm ghost icon" icon="download" title="Скачать лог" onClick=${download} />
        <${Btn} kind="sm ghost icon" icon="trash" title="Очистить" onClick=${() => setLines([])} /></div>
      <div class="console" ref=${box} onScroll=${e => {
        const el = e.target, near = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        // Пока идёт принудительная прокрутка после команды, расхождения от роста содержимого не считаем уходом вверх
        if (near || Date.now() >= force.current) stick.current = near;
        setAtBottom(near);
      }}>
        ${shown.length === 0 && html`<div class="dim">${s.state === 'missing' ? 'Сервер ещё не запускался. Нажмите «Запустить».' : filter ? 'Нет строк по фильтру' : 'Ожидание вывода…'}</div>`}
        ${shown.map((l, i) => html`<div key=${i} class=${l.cls}>${l.t}</div>`)}
      </div>
      ${!atBottom && html`<button class="jump" onClick=${() => { stick.current = true; box.current.scrollTop = box.current.scrollHeight; setAtBottom(true); }}>↓ К последним строкам</button>`}
      <div class="cmdline">
        <input class="mono" placeholder=${s.state === 'running' ? 'Команда сервера, например: say Привет' : 'Консоль доступна, когда сервер запущен'}
          value=${input} onInput=${e => setInput(e.target.value)} onKeyDown=${key} />
        <${Btn} kind="primary" onClick=${() => send()}>Отправить</${Btn}>
      </div>
    </div>
    <div class="row wrap" style="margin-top:12px">
      ${['list', 'save-all', 'time set day', 'weather clear', 'difficulty peaceful'].map(c => html`
        <${Btn} key=${c} kind="sm" onClick=${() => send(c)}>${c}</${Btn}>`)}
    </div>
  </div>`;
}

/* ---------------- Игроки ---------------- */
const TAG_EMPTY = { nick: '', prefix: '', suffix: '', color: '' };
const tagOf = (tags, n) => tags?.[n] || tags?.[Object.keys(tags || {}).find(k => k.toLowerCase() === String(n).toLowerCase())];
const TagPreview = ({ nick, tag }) => html`<span class="mc-box mini mcreal">${tag.prefix ? html`<${FmtText} real src=${tag.prefix} /> ` : ''}<span style=${`color:var(--mc${tag.color || 'f'})`}>${nick || 'Ник'}</span>${tag.suffix ? html` <${FmtText} real src=${tag.suffix} />` : ''}</span>`;

function TagsCard({ s, d, load, f, setF }) {
  const [busy, setBusy] = useState(false);
  const tags = d.tags || {};
  const names = [...new Set([...d.online, ...Object.keys(tags)])];
  const save = async () => {
    setBusy(true);
    try {
      const r = await api(`/servers/${s.id}/tags`, { method: 'PUT', body: f });
      if (r.error) toast('Сохранено, но сервер ответил ошибкой: ' + r.error, 'err');
      else toast(r.applied ? 'Приписка применена' : 'Сохранено. Применится, когда сервер будет запущен');
      setF(TAG_EMPTY); load();
    } catch (x) { toast(x.message, 'err'); } finally { setBusy(false); }
  };
  const remove = async n => {
    try { await api(`/servers/${s.id}/tags/${encodeURIComponent(n)}`, { method: 'DELETE' }); load(); }
    catch (x) { toast(x.message, 'err'); }
  };
  const set = o => setF({ ...f, ...o });
  return html`<div class="card col" id="tags-card">
    <h2>Приписки к никам <span class="sub">видны в списке игроков (Tab), в чате и над головой</span></h2>
    ${Object.keys(tags).length ? html`<div class="col" style="gap:8px">${Object.entries(tags).map(([n, t]) => html`<div class="tagrow" key=${n}>
        <${TagPreview} nick=${n} tag=${t} /><span class="grow"></span>
        <${Btn} kind="sm" onClick=${() => setF({ nick: n, prefix: t.prefix || '', suffix: t.suffix || '', color: t.color || '' })}>Изменить</${Btn}>
        <${Btn} kind="sm danger" onClick=${() => remove(n)}>Убрать</${Btn}></div>`)}</div>`
      : html`<div class="muted">Пока нет ни одной приписки</div>`}
    <div class="tagform">
      <div class="col" style="gap:14px">
        <${Field} label="Ник игрока" hint="Точно, с учётом регистра. Можно выбрать из списка тех, кто сейчас онлайн.">
          <input list="tag-nicks" value=${f.nick} placeholder="Steve" onInput=${e => set({ nick: e.target.value })} />
          <datalist id="tag-nicks">${names.map(n => html`<option value=${n} />`)}</datalist></${Field}>
        <div style="display:flex;flex-direction:column;gap:6px"><span style="font-weight:580;font-size:13px">Цвет самого ника</span>
          <${ColorRow} value=${f.color} none=${true} onPick=${c => set({ color: c })} />
          <small class="muted">Для ника доступны только 16 цветов игры. Жирный и прочие стили действуют на приписки.</small></div>
      </div>
      <div class="col" style="gap:14px">
        <div style="display:flex;flex-direction:column;gap:6px"><span style="font-weight:580;font-size:13px">Приписка перед ником</span>
          <${McEditor} value=${f.prefix} onChange=${v => set({ prefix: v })} max=${24} compact placeholder="&c&l[Админ]" /></div>
        <div style="display:flex;flex-direction:column;gap:6px"><span style="font-weight:580;font-size:13px">Приписка после ника</span>
          <${McEditor} value=${f.suffix} onChange=${v => set({ suffix: v })} max=${24} compact placeholder="&7(строитель)" /></div>
      </div>
    </div>
    <div class="row wrap"><span class="muted" style="font-size:12.5px">Так увидят игроки:</span><${TagPreview} nick=${f.nick} tag=${f} />
      <span class="grow"></span>
      <${Btn} kind="primary" icon="save" disabled=${!f.nick || busy || (!f.prefix && !f.suffix && !f.color)} onClick=${save}>Сохранить приписку</${Btn}></div>
    <small class="muted">Работает через команды team (Minecraft 1.13 и новее), приписки хранятся в панели и заново применяются при каждом запуске сервера. Если игрок состоит в другой команде, он перейдёт в команду приписки.</small>
  </div>`;
}

function PlayersTab({ s }) {
  const [d, setD] = useState(null);
  const [name, setName] = useState('');
  const [tf, setTf] = useState(TAG_EMPTY);
  const load = async () => { try { setD(await api(`/servers/${s.id}/players`)); } catch {} };
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [s.id]);
  const act = async (action, n, extra = {}) => {
    try { const r = await api(`/servers/${s.id}/players/${action}`, { method: 'POST', body: { name: n, ...extra } }); toast(r.out || 'Готово'); load(); }
    catch (x) { toast(x.message, 'err'); }
  };
  if (!d) return html`<div class="skeleton" style="height:240px"></div>`;
  const pill = (n, onRemove) => html`<span class="pill" key=${n}>${n}<button title="Убрать" onClick=${() => onRemove(n)}><${Icon} n="x" size=${14} /></button></span>`;
  return html`<div class="col">
    ${!d.running && html`<div class="banner info" style="margin:0">Сервер остановлен. Списки читаются из файлов, управлять онлайн-игроками можно только при запущенном сервере.</div>`}
    <div class="card">
      <h2>Онлайн ${d.running ? html`<span class="sub">${d.online.length}${d.max ? ' из ' + d.max : ''}</span>` : ''}</h2>
      ${d.online.length === 0 ? html`<div class="muted">Никого нет на сервере</div>`
        : html`<div class="col" style="gap:10px">${d.online.map(n => html`<div class="pcard" key=${n}>
            <img src=${'https://mc-heads.net/avatar/' + n + '/36'} width="36" height="36" onError=${e => (e.target.style.display = 'none')} />
            <b class="grow">${n} ${tagOf(d.tags, n) && html`<${TagPreview} nick=${n} tag=${tagOf(d.tags, n)} />`}</b>
            ${d.ops.includes(n) && html`<span class="chip">OP</span>`}
            <select style="width:auto;padding:5px 8px" value="" onChange=${e => e.target.value && (act('gamemode', n, { mode: e.target.value }), (e.target.value = ''))}>
              <option value="">Режим…</option><option value="survival">Выживание</option><option value="creative">Творчество</option>
              <option value="adventure">Приключение</option><option value="spectator">Наблюдатель</option></select>
            <${Btn} kind="sm" onClick=${() => { const t = tagOf(d.tags, n); setTf({ nick: n, prefix: t?.prefix || '', suffix: t?.suffix || '', color: t?.color || '' }); document.getElementById('tags-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>Приписка</${Btn}>
            <${Btn} kind="sm" icon="msg" onClick=${async () => { const r = await askText('Личное сообщение игроку ' + n, { label: 'Сообщение', required: true, ok: 'Отправить', placeholder: 'Что передать игроку?' }); if (r) act('tell', n, { reason: r.value }); }}>Написать</${Btn}>
            <${Btn} kind="sm" onClick=${() => act(d.ops.includes(n) ? 'deop' : 'op', n)}>${d.ops.includes(n) ? 'Снять OP' : 'Дать OP'}</${Btn}>
            <${Btn} kind="sm" onClick=${async () => { const r = await askText('Кик игрока ' + n, { label: 'Причина (необязательно)', ok: 'Выгнать', danger: true }); if (r) act('kick', n, { reason: r.value }); }}>Кик</${Btn}>
            <${Btn} kind="sm danger" onClick=${async () => { const r = await askText('Бан игрока ' + n, { label: 'Причина (необязательно)', ok: 'Забанить', danger: true }); if (r) act('ban', n, { reason: r.value }); }}>Бан</${Btn}>
          </div>`)}</div>`}
    </div>
    <${TagsCard} s=${s} d=${d} load=${load} f=${tf} setF=${setTf} />
    <div class="card col">
      <h2>Добавить по нику</h2>
      <div class="row wrap"><input style="max-width:280px" placeholder="Ник игрока" value=${name} onInput=${e => setName(e.target.value)} />
        <${Btn} disabled=${!name || !d.running} onClick=${() => act('wl-add', name)}>В белый список</${Btn}>
        <${Btn} disabled=${!name || !d.running} onClick=${() => act('op', name)}>Дать OP</${Btn}>
        <${Btn} kind="danger" disabled=${!name || !d.running} onClick=${() => act('ban', name)}>Забанить</${Btn}></div>
    </div>
    <div class="two">
      <div class="card"><h2>Белый список</h2>
        <div class="row wrap" style="margin-bottom:14px">
          <${Btn} kind="sm" disabled=${!d.running} onClick=${() => api(`/servers/${s.id}/whitelist`, { method: 'POST', body: { on: true } }).then(r => toast(r.out))}>Включить</${Btn}>
          <${Btn} kind="sm" disabled=${!d.running} onClick=${() => api(`/servers/${s.id}/whitelist`, { method: 'POST', body: { on: false } }).then(r => toast(r.out))}>Выключить</${Btn}></div>
        <div class="list">${d.whitelist.length ? d.whitelist.map(n => pill(n, x => act('wl-remove', x))) : html`<span class="muted">Пусто</span>`}</div></div>
      <div class="card"><h2>Операторы</h2>
        <div class="list">${d.ops.length ? d.ops.map(n => pill(n, x => act('deop', x))) : html`<span class="muted">Нет</span>`}</div>
        <h2 style="margin:20px 0 14px">Заблокированные</h2>
        <div class="list">${d.banned.length ? d.banned.map(n => pill(n, x => act('pardon', x))) : html`<span class="muted">Нет</span>`}</div></div>
    </div>
  </div>`;
}

/* ---------------- Настройки ---------------- */
const PROPS = [
  ['MAX_PLAYERS', 'Максимум игроков', 'number'],
  ['DIFFICULTY', 'Сложность', ['peaceful', 'easy', 'normal', 'hard']],
  ['MODE', 'Режим игры', ['survival', 'creative', 'adventure', 'spectator']],
  ['LEVEL', 'Название мира (папка)', 'text'],
  ['SEED', 'Seed мира', 'text'],
  ['LEVEL_TYPE', 'Тип мира', ['minecraft:normal', 'minecraft:flat', 'minecraft:large_biomes', 'minecraft:amplified']],
  ['VIEW_DISTANCE', 'Дальность прорисовки', 'number'],
  ['SIMULATION_DISTANCE', 'Дальность симуляции', 'number'],
  ['SPAWN_PROTECTION', 'Защита спавна (блоков)', 'number'],
  ['MAX_WORLD_SIZE', 'Максимальный размер мира', 'number'],
  ['ONLINE_MODE', 'Лицензионная проверка (online-mode)', 'bool'],
  ['PVP', 'PvP', 'bool'],
  ['ALLOW_NETHER', 'Незер', 'bool'],
  ['ALLOW_FLIGHT', 'Разрешить полёт', 'bool'],
  ['ENABLE_COMMAND_BLOCK', 'Командные блоки', 'bool'],
  ['HARDCORE', 'Хардкор', 'bool'],
  ['FORCE_GAMEMODE', 'Принудительный режим игры', 'bool'],
  ['SPAWN_ANIMALS', 'Спавн животных', 'bool'],
  ['SPAWN_MONSTERS', 'Спавн монстров', 'bool'],
  ['SPAWN_NPCS', 'Спавн жителей', 'bool'],
  ['GENERATE_STRUCTURES', 'Генерация структур', 'bool'],
  ['ENFORCE_WHITELIST', 'Принудительный белый список', 'bool'],
  ['ENABLE_WHITELIST', 'Белый список', 'bool'],
];
const TYPE_NAMES_LIST = { VANILLA: 'Vanilla', PAPER: 'Paper', PURPUR: 'Purpur', FABRIC: 'Fabric', FORGE: 'Forge', NEOFORGE: 'NeoForge', AUTO_CURSEFORGE: 'Сборка CurseForge' };

function useDraft(s, reload, keys, init = {}) {
  const [d, setD] = useState(null);
  const base = k => (init[k] ? init[k](s) : s[k]);
  useEffect(() => { setD(Object.fromEntries(keys.map(k => [k, base(k)]))); }, [s.id]);
  const dirty = d && keys.some(k => JSON.stringify(d[k]) !== JSON.stringify(base(k)));
  const set = o => setD(x => ({ ...x, ...o }));
  const save = async () => {
    try { await api('/servers/' + s.id, { method: 'PATCH', body: d }); toast('Сохранено'); reload(); }
    catch (x) { toast(x.message, 'err'); }
  };
  return { d, set, dirty, save };
}

function ConfigTab({ s, reload }) {
  const { d, set, save } = useDraft(s, reload, ['nameFmt', 'motd', 'type', 'version', 'memory', 'javaTag', 'loaderVersion', 'props', 'customEnv'], { nameFmt: x => x.nameFmt || mcEsc(x.name) });
  const [versions, setVersions] = useState([]);
  const [envText, setEnvText] = useState(null);
  useEffect(() => { getVersions().then(setVersions); }, []);
  useEffect(() => { if (d && envText === null) setEnvText(Object.entries(d.customEnv || {}).map(([k, v]) => `${k}=${v}`).join('\n')); }, [d]);
  if (!d) return null;
  const setProp = (k, v) => set({ props: { ...d.props, [k]: v } });
  const memGb = parseInt(d.memory) || 4;
  const parseEnv = t => Object.fromEntries(t.split('\n').map(l => l.trim()).filter(l => l && l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1)]));
  const onSave = () => {
    if (!mcStrip(d.nameFmt).trim()) return toast('Введите название сервера', 'err');
    d.customEnv = parseEnv(envText || '');
    save();
  };
  const motd = d.motd || { follow: true, l1: '', l2: '' };
  const setMotd = o => set({ motd: { ...motd, ...o } });

  return html`<div class="col">
    <${CoverCard} s=${s} reload=${reload} />
    <div class="card col"><h2>Основное</h2>
      <div class="fields">
        <div style="grid-column:1/-1;display:flex;flex-direction:column;gap:6px">
          <span style="font-weight:580;font-size:13px">Название сервера</span>
          <${McEditor} value=${d.nameFmt} onChange=${v => set({ nameFmt: v })} max=${40}
            preview=${v => html`<div class="mc-box"><${FmtText} real src=${v || ' '} /></div>`} />
          <small class="muted">Цвет и стиль видны в панели и (если включено ниже) в списке серверов игры.</small>
        </div>
        <${Field} label="Тип ядра">
          <select value=${d.type} onChange=${e => set({ type: e.target.value })}>
            ${Object.entries(TYPE_NAMES_LIST).map(([k, v]) => html`<option value=${k}>${v}</option>`)}</select></${Field}>
        ${d.type !== 'AUTO_CURSEFORGE' && html`<${Field} label="Версия Minecraft">
          <select value=${d.version} onChange=${e => set({ version: e.target.value })}>
            <option value="LATEST">Последняя (LATEST)</option>
            ${!versions.includes(d.version) && d.version !== 'LATEST' && html`<option value=${d.version}>${d.version}</option>`}
            ${versions.map(x => html`<option value=${x}>${x}</option>`)}</select></${Field}>`}
        ${['FORGE', 'NEOFORGE', 'FABRIC'].includes(d.type) && html`<${Field} label="Версия загрузчика" hint="Например 47.2.0 для Forge. Пусто — последняя подходящая.">
          <input class="mono" value=${d.loaderVersion || ''} onInput=${e => set({ loaderVersion: e.target.value })} /></${Field}>`}
        <${Field} label=${'Память: ' + d.memory} hint="Лимит Java-кучи (-Xmx)">
          <input type="range" min="1" max="32" value=${memGb} onInput=${e => set({ memory: e.target.value + 'G' })} /></${Field}>
        <${Field} label="Версия Java" hint="Авто подбирает под версию Minecraft. Для старых сборок выбирайте вручную.">
          <select value=${d.javaTag} onChange=${e => set({ javaTag: e.target.value })}>
            <option value="auto">Авто</option><option value="java21">Java 21</option><option value="java17">Java 17</option>
            <option value="java11">Java 11</option><option value="java8">Java 8</option><option value="latest">Последняя</option></select></${Field}>
      </div>
    </div>
    <div class="card col"><h2>Описание в списке серверов</h2>
      <${Toggle} label="Первая строка — название сервера (с цветом и стилем)" on=${motd.follow} onChange=${on => setMotd({ follow: on })} />
      ${!motd.follow && html`<div style="display:flex;flex-direction:column;gap:6px"><span style="font-weight:580;font-size:13px">Первая строка</span>
        <${McEditor} value=${motd.l1} onChange=${v => setMotd({ l1: v })} max=${60} compact /></div>`}
      <div style="display:flex;flex-direction:column;gap:6px"><span style="font-weight:580;font-size:13px">Вторая строка</span>
        <${McEditor} value=${motd.l2} onChange=${v => setMotd({ l2: v })} max=${60} compact /></div>
      <div><div class="muted" style="font-size:12px;margin-bottom:6px">Так сервер увидят игроки</div>
        <${MotdPreview} s=${s} l1=${motd.follow ? d.nameFmt : motd.l1} l2=${motd.l2} /></div>
      <small class="muted">Верхняя белая строка («Сервер Minecraft») — это имя, которое игрок сам дал записи в своём списке, сервер на него повлиять не может.
        Серым показывается описание, а слева — значок сервера (из меню ⋯ → «Изменить значок», уменьшается до 64×64). Описание и значок обновляются после перезапуска сервера.</small>
    </div>
    <div class="card col"><h2>Параметры игры</h2>
      <div class="fields">${PROPS.map(([k, label, type]) => {
        const val = d.props[k] ?? '';
        if (type === 'bool') return html`<div key=${k} style="display:flex;align-items:flex-end;padding-bottom:8px">
          <${Toggle} label=${label} on=${val === '' ? false : String(val).toUpperCase() === 'TRUE'} onChange=${on => setProp(k, on ? 'TRUE' : 'FALSE')} /></div>`;
        if (Array.isArray(type)) return html`<${Field} key=${k} label=${label}><select value=${val} onChange=${e => setProp(k, e.target.value)}>
          <option value="">по умолчанию</option>${type.map(o => html`<option value=${o}>${o}</option>`)}</select></${Field}>`;
        return html`<${Field} key=${k} label=${label}><input type=${type} value=${val} placeholder="по умолчанию" onInput=${e => setProp(k, e.target.value)} /></${Field}>`;
      })}</div>
      <small class="muted">Пустое значение означает настройку по умолчанию. Остальные параметры можно править в файле server.properties на вкладке «Файлы».</small>
    </div>
    <div class="card col"><h2>Дополнительные переменные</h2>
      <${Field} label="Переменные окружения (по одной на строку: КЛЮЧ=значение)" hint="Любые переменные образа itzg/minecraft-server, например JVM_OPTS, OPS, WHITELIST, ICON.">
        <textarea value=${envText ?? ''} onInput=${e => setEnvText(e.target.value)} placeholder="OPS=Steve,Alex"></textarea></${Field}>
    </div>
    <div class="row"><${Btn} kind="primary" icon="save" onClick=${onSave}>Сохранить</${Btn}>
      <span class="muted">Изменения применяются после перезапуска сервера.</span></div>
  </div>`;
}

/* ---------------- Моды ---------------- */
function Installed({ s }) {
  const dir = ['PAPER', 'PURPUR'].includes(s.type) ? 'plugins' : 'mods';
  const [data, setData] = useState(null);
  const input = useRef(null);
  const load = async () => { try { setData(await api(`/servers/${s.id}/files?path=${dir}`)); } catch {} };
  useEffect(() => { load(); }, [s.id, dir]);
  const del = async n => {
    if (!(await askConfirm(`Удалить ${n}?`))) return;
    try { await api(`/servers/${s.id}/file?path=${encodeURIComponent(dir + '/' + n)}`, { method: 'DELETE' }); load(); }
    catch (x) { toast(x.message, 'err'); }
  };
  const upload = async e => {
    const files = [...e.target.files];
    if (!files.length) return;
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    try { await api(`/servers/${s.id}/upload?path=${dir}`, { method: 'POST', body: fd }); toast('Загружено'); load(); }
    catch (x) { toast(x.message, 'err'); }
    e.target.value = '';
  };
  const jars = (data?.entries || []).filter(e => !e.dir);
  return html`<div class="card col"><div class="row"><h2 class="grow" style="margin:0">Установлено в ${dir}/ <span class="sub">${jars.length}</span></h2>
      <input type="file" multiple hidden accept=".jar" ref=${input} onChange=${upload} />
      <${Btn} kind="sm primary" icon="upload" onClick=${() => input.current.click()}>Загрузить .jar</${Btn}></div>
    ${jars.length ? html`<div class="list">${jars.map(j => html`<span class="pill" key=${j.name}><span>${j.name}</span><span class="faint" style="font-size:12px">${fmtBytes(j.size)}</span>
        <button title="Удалить" onClick=${() => del(j.name)}><${Icon} n="trash" size=${14} /></button></span>`)}</div>`
      : html`<span class="muted">Пока пусто. Загрузите .jar-файлы или добавьте моды с CurseForge/Modrinth выше.</span>`}
  </div>`;
}

const modCache = new Map();
function ModName({ id }) {
  const [m, setM] = useState(modCache.get(id) || null);
  useEffect(() => {
    if (!/^\d+$/.test(id) || modCache.has(id)) return;
    api('/cf/mod/' + id).then(x => { modCache.set(id, x); setM(x); }).catch(() => {});
  }, [id]);
  return html`<span>${m ? m.name : id}${m && /^\d+$/.test(id) && html` <span class="faint" style="font-size:12px">#${id}</span>`}</span>`;
}

function ModById({ onAdd }) {
  const [id, setId] = useState('');
  const [m, setM] = useState(null);
  const [busy, setBusy] = useState(false);
  const find = async e => {
    e && e.preventDefault();
    const num = (id.match(/\d{3,9}/) || [''])[0];
    if (!num) return toast('Введите числовой ID проекта', 'err');
    setBusy(true);
    try { setM(await api('/cf/mod/' + num)); } catch (x) { toast(x.message, 'err'); setM(null); }
    setBusy(false);
  };
  return html`<div class="col">
    <form class="row" onSubmit=${find}>
      <input placeholder="ID проекта, например 238222 (JEI)" value=${id} onInput=${e => setId(e.target.value)} />
      <${Btn} icon="search" type="submit" disabled=${busy || !id}>Найти</${Btn}></form>
    <small class="muted">ID указан на странице мода на CurseForge, в правой колонке «About Project», строка «Project ID».</small>
    ${m && html`<div class="mod"><${m.icon ? 'img' : 'div'} ...${m.icon ? { src: m.icon } : { class: 'ph' }} />
      <div class="grow"><b>${m.name}</b><p>${m.summary}</p>
        ${m.kind === 'mod' ? html`<${Btn} kind="sm primary" onClick=${() => { onAdd(m); setM(null); setId(''); }}>Добавить мод</${Btn}>`
          : m.kind === 'modpack' ? html`<span class="chip">Это сборка. По ID сборки не ставятся, см. подсказку выше.</span>`
          : html`<span class="chip">Этот тип проектов не поддерживается</span>`}</div></div>`}
  </div>`;
}

function ModsTab({ s, reload }) {
  const [, tick] = useState(0);
  useEffect(() => { api('/settings').then(x => { appState.settings = x; tick(n => n + 1); }).catch(() => {}); }, []);
  const [kind, setKind] = useState(s.type === 'AUTO_CURSEFORGE' ? 'modpack' : ['FORGE', 'FABRIC', 'NEOFORGE'].includes(s.type) ? 'mod' : 'modpack');
  const [mr, setMr] = useState(s.modrinthMods || '');
  const patch = async body => {
    try { await api('/servers/' + s.id, { method: 'PATCH', body }); toast('Сохранено'); reload(); }
    catch (x) { toast(x.message, 'err'); }
  };
  const mods = (s.cfMods || '').split(',').filter(Boolean);
  const loaderOk = ['FORGE', 'FABRIC', 'NEOFORGE'].includes(s.type);
  const searchOff = appState.settings.cfApiKeySet && appState.settings.cfSearchOk === false;
  const pick = async m => {
    if (kind === 'modpack' && !m.forceMod) {
      if (!(await askConfirm(`Установить сборку «${m.name}»?\n\nТип сервера сменится на «Сборка CurseForge». Файлы сборки скачаются при следующем запуске.`))) return;
      patch({ type: 'AUTO_CURSEFORGE', cfSlug: m.slug, cfFileId: '' });
    } else {
      const ref = m.forceMod ? String(m.id) : m.slug;
      if (mods.includes(ref)) return toast('Уже добавлен');
      patch({ cfMods: [...mods, ref].join(',') });
    }
  };
  return html`<div class="col">
    ${s.type === 'AUTO_CURSEFORGE' && html`<div class="banner info" style="margin:0">Установлена сборка: <b>${s.cfSlug || 'не выбрана'}</b>.
      Моды сборки управляются самой сборкой. Отдельные моды можно добавить файлами.</div>`}
    ${searchOff ? html`<div class="card col">
      <h2>Моды CurseForge по ID</h2>
      <div class="banner warn" style="margin:0">CurseForge закрыл поиск для вашего ключа. Моды при этом ставятся по ID проекта. Сборки через CurseForge без поиска установить нельзя: скачайте серверный архив сборки на сайте и распакуйте его на вкладке «Файлы».</div>
      ${!loaderOk && html`<div class="banner warn" style="margin:0">Моды работают на Forge, Fabric или NeoForge. Сейчас выбран тип «${TYPE_NAMES_LIST[s.type]}». Сменить можно на вкладке «Настройки».</div>`}
      <${ModById} onAdd=${m => pick({ ...m, forceMod: true })} />
    </div>` : html`<div class="card col">
      <div class="row wrap"><h2 class="grow" style="margin:0">Поиск на CurseForge</h2>
        <div class="seg"><button class=${kind === 'modpack' ? 'on' : ''} onClick=${() => setKind('modpack')}>Сборки</button>
          <button class=${kind === 'mod' ? 'on' : ''} onClick=${() => setKind('mod')}>Моды</button></div></div>
      ${kind === 'mod' && !loaderOk && html`<div class="banner warn" style="margin:0">Моды работают на Forge, Fabric или NeoForge. Сейчас выбран тип «${TYPE_NAMES_LIST[s.type]}». Сменить можно на вкладке «Настройки».</div>`}
      <${ModpackSearch} key=${kind} kind=${kind} loader=${s.type} gameVersion=${/^[\d.]+$/.test(s.version) ? s.version : ''}
        label=${kind === 'modpack' ? 'Установить сборку' : 'Добавить мод'} onPick=${pick} />
    </div>`}
    ${mods.length > 0 && html`<div class="card col"><h2>Моды CurseForge этого сервера</h2>
      <div class="list">${mods.map(m => html`<span class="pill" key=${m}><${ModName} id=${m} />
        <button onClick=${() => patch({ cfMods: mods.filter(x => x !== m).join(',') })}><${Icon} n="x" size=${14} /></button></span>`)}</div>
      <small class="muted">Моды скачиваются автоматически при запуске. Убедитесь, что версия мода подходит под версию Minecraft и загрузчик.</small></div>`}
    <div class="card col"><h2>Modrinth</h2>
      <${Field} label="Проекты Modrinth (через запятую)" hint="Slug проекта, например: fabric-api, lithium, sodium. Для плагинов Paper тоже работает.">
        <input value=${mr} onInput=${e => setMr(e.target.value)} placeholder="fabric-api, lithium" /></${Field}>
      <div><${Btn} icon="save" onClick=${() => patch({ modrinthMods: mr })}>Сохранить</${Btn}></div>
    </div>
    <${Installed} s=${s} />
  </div>`;
}

/* ---------------- Бэкапы ---------------- */
const KIND = { manual: 'Ручная', auto: 'По расписанию', 'pre-restore': 'Перед восстановлением' };
function stampOf(name) {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(name);
  return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).toLocaleString('ru') : name;
}

function BackupsTab({ s }) {
  const [list, setList] = useState(null);
  const load = async () => { try { setList(await api(`/servers/${s.id}/backups`)); } catch {} };
  useEffect(() => { load(); const t = setInterval(load, s.busy ? 2000 : 6000); return () => clearInterval(t); }, [s.id, !!s.busy]);
  const create = async () => {
    try { await api(`/servers/${s.id}/backups`, { method: 'POST' }); toast('Резервная копия создаётся…'); }
    catch (x) { toast(x.message, 'err'); }
  };
  const restore = async b => {
    if (!(await askConfirm(`Восстановить сервер из копии от ${stampOf(b.name)}?\n\nТекущее состояние будет заменено. Перед этим автоматически создастся копия «Перед восстановлением».`))) return;
    try { await api(`/servers/${s.id}/backups/${b.name}/restore`, { method: 'POST' }); toast('Восстановление запущено'); }
    catch (x) { toast(x.message, 'err'); }
  };
  const del = async b => {
    if (!(await askConfirm('Удалить эту резервную копию?'))) return;
    try { await api(`/servers/${s.id}/backups/${b.name}`, { method: 'DELETE' }); load(); }
    catch (x) { toast(x.message, 'err'); }
  };
  if (!list) return html`<div class="skeleton" style="height:200px"></div>`;
  const total = list.reduce((a, b) => a + b.size, 0);
  const running = s.state === 'running' || s.state === 'starting';
  return html`<div class="col">
    <div class="row wrap">
      <div class="grow muted">${list.length ? `${list.length} ${plural(list.length, 'копия', 'копии', 'копий')} · ${fmtBytes(total)}` : 'Копий пока нет'}</div>
      <${Btn} kind="primary" icon="archive" disabled=${!!s.busy} onClick=${create}>${s.busy && s.busy.includes('копия') ? 'Создаётся…' : 'Создать копию'}</${Btn}>
    </div>
    <div class="card pad0">
      ${list.length === 0 ? html`<div class="empty"><div class="ico"><${Icon} n="archive" size=${30} /></div><h2>Резервных копий нет</h2>
          <p style="margin:0">Создайте копию вручную или настройте автоматические на вкладке «Расписание».</p></div>`
        : html`<table><thead><tr><th>Дата</th><th>Тип</th><th>Размер</th><th style="width:150px"></th></tr></thead><tbody>
          ${list.map(b => html`<tr key=${b.name}>
            <td><b>${stampOf(b.name)}</b><div class="faint" style="font-size:12px">${ago(b.mtime)}</div></td>
            <td><span class="chip">${KIND[b.kind] || b.kind}</span></td>
            <td>${fmtBytes(b.size)}</td>
            <td><div class="row" style="justify-content:flex-end;gap:2px">
              <a class="btn sm ghost icon" title="Скачать" href=${`/api/servers/${s.id}/backups/${b.name}`}><${Icon} n="download" size=${15} /></a>
              <${Btn} kind="sm" icon="refresh" disabled=${running || !!s.busy} title=${running ? 'Сначала остановите сервер' : 'Восстановить'} onClick=${() => restore(b)}>Восстановить</${Btn}>
              <${Btn} kind="sm ghost icon" icon="trash" onClick=${() => del(b)} /></div></td></tr>`)}
        </tbody></table>`}
    </div>
    <small class="muted">Копии хранятся на сервере в папке данных панели. Для восстановления сервер должен быть остановлен. Логи и кэш в копии не включаются.</small>
  </div>`;
}

/* ---------------- Расписание ---------------- */
const TASK_KIND = { backup: ['Резервная копия', 'archive'], restart: ['Перезапуск сервера', 'restart'], command: ['Команда в консоль', 'terminal'] };

function ScheduleTab({ s }) {
  const [tasks, setTasks] = useState(null);
  const [edit, setEdit] = useState(null);
  const load = async () => { try { setTasks(await api(`/servers/${s.id}/schedule`)); } catch {} };
  useEffect(() => { load(); }, [s.id]);
  const saveAll = async next => {
    try { setTasks(await api(`/servers/${s.id}/schedule`, { method: 'PUT', body: { tasks: next } })); toast('Расписание сохранено'); }
    catch (x) { toast(x.message, 'err'); }
  };
  if (!tasks) return html`<div class="skeleton" style="height:180px"></div>`;
  const blank = { kind: 'backup', mode: 'daily', time: '04:00', hours: 6, command: '', keep: 7, enabled: true };
  const describe = t => (t.mode === 'daily' ? `каждый день в ${t.time}` : `каждые ${t.hours} ч`) +
    (t.kind === 'backup' ? ` · хранить ${t.keep}` : t.kind === 'command' ? ` · ${t.command}` : '');
  const submit = () => {
    const next = edit.idx == null ? [...tasks, edit.t] : tasks.map((x, i) => (i === edit.idx ? edit.t : x));
    saveAll(next); setEdit(null);
  };
  const t = edit?.t;
  const setT = o => setEdit({ ...edit, t: { ...edit.t, ...o } });
  return html`<div class="col">
    <div class="row"><div class="grow muted">Автоматические задачи выполняются по времени панели (Москва).</div>
      <${Btn} kind="primary" icon="plus" onClick=${() => setEdit({ idx: null, t: { ...blank } })}>Добавить задачу</${Btn}></div>
    ${tasks.length === 0 ? html`<div class="card empty"><div class="ico"><${Icon} n="clock" size=${30} /></div><h2>Задач нет</h2>
        <p style="margin:0 0 16px">Например, ежедневная копия мира в 4 утра и перезапуск после неё.</p>
        <${Btn} icon="plus" onClick=${() => setEdit({ idx: null, t: { ...blank } })}>Добавить задачу</${Btn}></div>`
      : tasks.map((x, i) => html`<div class="task" key=${x.id}>
          <div class="ti"><${Icon} n=${TASK_KIND[x.kind][1]} size=${20} /></div>
          <div style="min-width:0"><b>${TASK_KIND[x.kind][0]}</b>
            <div class="muted trunc">${describe(x)}</div>
            <div style="font-size:12px" class="faint">Последний запуск: ${x.lastStatus ? ago(x.lastRun) : '—'}
              ${x.lastStatus && html` · <span class=${x.lastStatus === 'ok' ? 'stat-ok' : 'stat-err'}>${x.lastStatus === 'ok' ? 'успешно' : x.lastStatus}</span>`}</div></div>
          <div class="row">
            <${Toggle} on=${x.enabled} onChange=${on => saveAll(tasks.map((y, j) => (j === i ? { ...y, enabled: on } : y)))} />
            <${Btn} kind="sm" onClick=${() => setEdit({ idx: i, t: { ...x } })}>Изменить</${Btn}>
            <${Btn} kind="sm ghost icon" icon="trash" onClick=${async () => (await askConfirm('Удалить задачу?')) && saveAll(tasks.filter((_, j) => j !== i))} />
          </div></div>`)}
    ${edit && html`<${Modal} title=${edit.idx == null ? 'Новая задача' : 'Изменить задачу'} onClose=${() => setEdit(null)}
      footer=${html`<${Btn} onClick=${() => setEdit(null)}>Отмена</${Btn}><${Btn} kind="primary" icon="check" onClick=${submit}>Сохранить</${Btn}>`}>
      <div class="fields">
        <${Field} label="Действие"><select value=${t.kind} onChange=${e => setT({ kind: e.target.value })}>
          ${Object.entries(TASK_KIND).map(([k, v]) => html`<option value=${k}>${v[0]}</option>`)}</select></${Field}>
        <${Field} label="Как часто"><select value=${t.mode} onChange=${e => setT({ mode: e.target.value })}>
          <option value="daily">Каждый день в заданное время</option><option value="interval">Через равные промежутки</option></select></${Field}>
        ${t.mode === 'daily' ? html`<${Field} label="Время"><input type="time" value=${t.time} onInput=${e => setT({ time: e.target.value })} /></${Field}>`
          : html`<${Field} label="Каждые N часов"><input type="number" min="1" max="168" value=${t.hours} onInput=${e => setT({ hours: e.target.value })} /></${Field}>`}
        ${t.kind === 'backup' && html`<${Field} label="Сколько копий хранить" hint="Старые автоматические копии удаляются. Ручные не трогаются.">
          <input type="number" min="1" max="50" value=${t.keep} onInput=${e => setT({ keep: e.target.value })} /></${Field}>`}
        ${t.kind === 'command' && html`<${Field} label="Команда" hint="Например: say Не забывайте сохраняться, или save-all"><input class="mono" value=${t.command} onInput=${e => setT({ command: e.target.value })} /></${Field}>`}
      </div>
      ${t.kind === 'restart' && html`<div class="banner info" style="margin:18px 0 0">За 30 секунд до перезапуска игрокам придёт сообщение в чат.</div>`}
    </${Modal}>`}
  </div>`;
}

/* ---------------- Сеть ---------------- */
function NetworkTab({ s, reload }) {
  const { d, set, dirty, save } = useDraft(s, reload, ['port', 'extraPorts', 'domain', 'proxy']);
  if (!d) return null;
  const host = appState.settings.publicHost || '<ваш внешний IP>';
  const dom = (d.domain || '').split(',')[0].trim();
  return html`<div class="col">
    <div class="card col"><h2>Порты</h2>
      <div class="fields">
        <${Field} label="Порт сервера" hint="Внешний порт на этой машине. Порт 25565 занят маршрутизатором доменов.">
          <input type="number" value=${d.port} onInput=${e => set({ port: +e.target.value })} /></${Field}>
        <${Field} label="Дополнительные порты" hint="Например 24454/udp для голосового чата, 8123/tcp для Dynmap. Через запятую.">
          <input value=${d.extraPorts} placeholder="24454/udp" onInput=${e => set({ extraPorts: e.target.value })} /></${Field}>
      </div>
    </div>
    <div class="card col"><h2>Домен</h2>
      <${Field} label="Домен (или несколько через запятую)" hint="Игроки подключаются по домену без указания порта. Один порт 25565 может обслуживать много серверов по разным доменам.">
        <input value=${d.domain} placeholder="mc.example.com" onInput=${e => set({ domain: e.target.value })} /></${Field}>
      ${dom ? html`<div class="col" style="gap:12px">
        <div class="banner info" style="margin:0">Чтобы домен заработал, нужны две вещи вне панели:</div>
        <div><b>1. DNS-запись</b> у регистратора домена:
          <div class="code" style="margin-top:8px">${dom}   A   ${host === '<ваш внешний IP>' ? '<внешний IP вашей сети>' : host}</div></div>
        <div><b>2. Проброс порта на роутере:</b>
          <div class="code" style="margin-top:8px">TCP 25565  →  ${location.hostname}:25565</div></div>
        <small class="muted">Если внешний IP меняется, используйте DDNS. Подключения по домену принимает маршрутизатор mc-router, он сам направляет игрока на нужный сервер.</small></div>`
      : html`<small class="muted">Без домена игроки заходят по адресу <span class="mono">${host}:${d.port}</span>, для этого нужно пробросить порт ${d.port} на роутере.</small>`}
    </div>
    <${ServerProxy} value=${d.proxy} onChange=${v => set({ proxy: v })} />
    <div class="row"><${Btn} kind="primary" icon="save" onClick=${save} disabled=${!dirty}>Сохранить</${Btn}></div>
  </div>`;
}

/* ---------------- Файлы ---------------- */
function FilesTab({ s }) {
  const [path, setPath] = useState('');
  const [data, setData] = useState(null);
  const [edit, setEdit] = useState(null);
  const fileInput = useRef(null);
  const arcInput = useRef(null);
  const [ex, setEx] = useState(null);
  useEffect(() => { if (!s.busy && data) load(); }, [!!s.busy]);
  const load = async (p = path) => {
    try { setData(await api(`/servers/${s.id}/files?path=${encodeURIComponent(p)}`)); setPath(p); }
    catch (x) { toast(x.message, 'err'); }
  };
  useEffect(() => { load(''); }, [s.id]);
  if (!data) return html`<div class="skeleton" style="height:200px"></div>`;
  const join = n => (path ? path + '/' : '') + n;
  const crumbs = path ? path.split('/') : [];
  const ARCH = /\.(zip|tar\.gz|tgz|tar)$/i;
  const doExtract = async (rel, o) => {
    try { await api(`/servers/${s.id}/extract`, { method: 'POST', body: { path: rel, ...o } }); toast('Распаковка запущена, это может занять время'); setEx(null); }
    catch (x) { toast(x.message, 'err'); }
  };
  const openExtract = async (name, auto) => {
    const rel = join(name);
    try {
      const i = await api(`/servers/${s.id}/archive?path=${encodeURIComponent(rel)}`);
      const flatten = !!i.singleRoot && !i.plain;
      if (auto) return doExtract(rel, { flatten, remove: true });
      setEx({ path: rel, name, info: i, flatten, remove: false });
    } catch (x) { toast(x.message, 'err'); }
  };
  const uploadArchive = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('files', file);
    toast(`Загрузка ${file.name}…`);
    try { await api(`/servers/${s.id}/upload?path=${encodeURIComponent(path)}`, { method: 'POST', body: fd }); }
    catch (x) { return toast(x.message, 'err'); }
    await openExtract(file.name, true);
    load();
  };
  const open = async e => {
    if (e.dir) return load(join(e.name));
    if (ARCH.test(e.name)) return openExtract(e.name);
    try {
      const r = await api(`/servers/${s.id}/file?path=${encodeURIComponent(join(e.name))}`);
      setEdit({ path: join(e.name), content: r.content });
    } catch (x) { toast(x.message, 'err'); }
  };
  const del = async e => {
    if (!(await askConfirm(`Удалить «${e.name}»${e.dir ? ' вместе с содержимым' : ''}?`))) return;
    try { await api(`/servers/${s.id}/file?path=${encodeURIComponent(join(e.name))}`, { method: 'DELETE' }); load(); }
    catch (x) { toast(x.message, 'err'); }
  };
  const saveFile = async () => {
    try { await api(`/servers/${s.id}/file`, { method: 'PUT', body: edit }); toast('Файл сохранён'); setEdit(null); load(); }
    catch (x) { toast(x.message, 'err'); }
  };
  const mkdir = async () => {
    const r = await askText('Новая папка', { label: 'Название папки', required: true, ok: 'Создать' });
    if (!r) return;
    const n = r.value;
    try { await api(`/servers/${s.id}/mkdir`, { method: 'POST', body: { path: join(n) } }); load(); }
    catch (x) { toast(x.message, 'err'); }
  };
  const upload = async e => {
    const files = [...e.target.files];
    if (!files.length) return;
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    toast(`Загрузка файлов: ${files.length}…`);
    try { await api(`/servers/${s.id}/upload?path=${encodeURIComponent(path)}`, { method: 'POST', body: fd }); toast('Загружено'); load(); }
    catch (x) { toast(x.message, 'err'); }
    e.target.value = '';
  };
  return html`<div class="col">
    <div class="row wrap">
      <div class="row grow wrap" style="gap:2px">
        <${Btn} kind="sm ghost" onClick=${() => load('')}>/data</${Btn}>
        ${crumbs.map((c, i) => html`<span class="faint" key=${i}>/</span><${Btn} kind="sm ghost" onClick=${() => load(crumbs.slice(0, i + 1).join('/'))}>${c}</${Btn}>`)}
      </div>
      <input type="file" multiple hidden ref=${fileInput} onChange=${upload} />
      <input type="file" hidden ref=${arcInput} accept=".zip,.tar.gz,.tgz,.tar" onChange=${uploadArchive} />
      <${Btn} kind="sm" icon="folderplus" onClick=${mkdir}>Папка</${Btn}>
      <${Btn} kind="sm" icon="archive" disabled=${!!s.busy} onClick=${() => arcInput.current.click()}>Загрузить архив и распаковать</${Btn}>
      <${Btn} kind="sm primary" icon="upload" onClick=${() => fileInput.current.click()}>Загрузить файлы</${Btn}>
    </div>
    <div class="card pad0"><table>
      <thead><tr><th>Имя</th><th style="width:110px">Размер</th><th style="width:170px">Изменён</th><th style="width:100px"></th></tr></thead>
      <tbody>
        ${path && html`<tr class="click" onClick=${() => load(crumbs.slice(0, -1).join('/'))}><td colspan="4" class="muted">.. наверх</td></tr>`}
        ${data.entries.map(e => html`<tr class="click" key=${e.name} onClick=${() => open(e)}>
          <td><div class="row"><span style=${e.dir ? 'color:var(--warn)' : 'color:var(--muted)'}><${Icon} n=${e.dir ? 'folder' : 'file'} size=${16} /></span><span>${e.name}</span></div></td>
          <td class="muted">${e.dir ? '' : fmtBytes(e.size)}</td>
          <td class="muted">${e.mtime ? new Date(e.mtime).toLocaleString('ru') : ''}</td>
          <td onClick=${ev => ev.stopPropagation()}><div class="row" style="gap:2px;justify-content:flex-end">
            ${!e.dir && ARCH.test(e.name) && html`<${Btn} kind="sm ghost icon" icon="unpack" title="Распаковать" disabled=${!!s.busy} onClick=${() => openExtract(e.name)} />`}
            ${!e.dir && html`<a class="btn sm ghost icon" title="Скачать" href=${`/api/servers/${s.id}/file?download=1&path=${encodeURIComponent(join(e.name))}`}><${Icon} n="download" size=${15} /></a>`}
            <${Btn} kind="sm ghost icon" icon="trash" title="Удалить" onClick=${() => del(e)} /></div></td></tr>`)}
        ${data.entries.length === 0 && html`<tr><td colspan="4" class="empty">Папка пуста${s.state === 'missing' ? '. Файлы появятся после первого запуска.' : ''}</td></tr>`}
      </tbody></table></div>
    ${ex && html`<${Modal} title="Распаковать архив" onClose=${() => setEx(null)}
      footer=${html`<${Btn} onClick=${() => setEx(null)}>Отмена</${Btn}><${Btn} kind="primary" icon="archive" onClick=${() => doExtract(ex.path, { flatten: ex.flatten, remove: ex.remove })}>Распаковать</${Btn}>`}>
      <div class="col">
        <div><b>${ex.name}</b><div class="muted">файлов: ${ex.info.count}${ex.info.total ? ', около ' + fmtBytes(ex.info.total) : ''}</div></div>
        <div class="muted">Куда: <span class="mono">/data${path ? '/' + path : ''}</span>. Файлы с такими же именами будут заменены.</div>
        ${ex.info.singleRoot && html`<${Toggle} on=${ex.flatten} onChange=${v => setEx({ ...ex, flatten: v })}
          label=${`В архиве одна папка «${ex.info.singleRoot}». Распаковать её содержимое прямо сюда`} />`}
        <${Toggle} on=${ex.remove} onChange=${v => setEx({ ...ex, remove: v })} label="Удалить архив после распаковки" />
        ${(s.state === 'running' || s.state === 'starting') && html`<div class="banner warn" style="margin:0">Сервер запущен. Лучше остановить его перед распаковкой, иначе он может перезаписать часть файлов.</div>`}
      </div>
    </${Modal}>`}
    ${edit && html`<${Modal} wide title=${edit.path} onClose=${() => setEdit(null)}
      footer=${html`<${Btn} onClick=${() => setEdit(null)}>Отмена</${Btn}><${Btn} kind="primary" icon="save" onClick=${saveFile}>Сохранить</${Btn}>`}>
      <textarea style="min-height:55vh;font-size:13px" spellcheck="false" value=${edit.content} onInput=${e => setEdit({ ...edit, content: e.target.value })}></textarea>
      <small class="muted">Изменения вступят в силу после перезапуска сервера. Пока сервер работает, он может перезаписать некоторые файлы.</small>
    </${Modal}>`}
  </div>`;
}

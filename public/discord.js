import { html, rawHtml, useState, useEffect, Icon, Btn, Field, Toggle, toast, askConfirm, ago, appState, isRemote, lang as uiLang } from './ui.js';
import { api } from './api.js';

/* Табло в Discord: панель сама правит одно сообщение в канале через вебхук. */

const INTERVALS = [[30, '30 секунд'], [60, '1 минута'], [120, '2 минуты'], [300, '5 минут']];
const TYPE_NAME = { VANILLA: 'Vanilla', PAPER: 'Paper', PURPUR: 'Purpur', FABRIC: 'Fabric', FORGE: 'Forge', NEOFORGE: 'NeoForge', AUTO_CURSEFORGE: 'CurseForge' };

/* Тексты макета на языке сообщений в Discord (не зависят от языка панели): так они выглядят в канале. */
const PV = {
  ru: { who: 'Вебхук', bot: 'БОТ', today: 'сегодня', status: 'Статус', players: 'Игроки', of: 'из', version: 'Версия', address: 'Адрес', uptime: 'Аптайм', self: 'обновляется само',
    online: '🟢 Онлайн', starting: '🟡 Запускается', offline: '🔴 Выключен', updates: 'обновляется', every: { 30: 'каждые 30 секунд', 60: 'каждую минуту', 120: 'каждые 2 минуты', 300: 'каждые 5 минут' } },
  en: { who: 'Webhook', bot: 'BOT', today: 'today', status: 'Status', players: 'Players', of: 'of', version: 'Version', address: 'Address', uptime: 'Uptime', self: 'updates itself',
    online: '🟢 Online', starting: '🟡 Starting', offline: '🔴 Offline', updates: 'updates', every: { 30: 'every 30 seconds', 60: 'every minute', 120: 'every 2 minutes', 300: 'every 5 minutes' } },
};

/** Макет сообщения: так оно выглядит в Discord (по данным сервера прямо сейчас). */
function Preview({ s, address, interval, msgLang }) {
  const X = PV[msgLang] || PV.ru;
  const up = s.state === 'running', boot = s.state === 'starting';
  const ver = `${TYPE_NAME[s.type] || s.type} ${s.version && s.version !== 'LATEST' ? s.version : ''}`.trim();
  const col = up ? '#2ecc71' : boot ? '#f1c40f' : '#e74c3c';
  const f = (n, v, mono) => rawHtml`<div class="dcf"><b>${n}</b><span class=${mono ? 'mono' : ''}>${v}</span></div>`;
  return rawHtml`<div class="dc-msg">
    <div class="dc-ava">${(s.name || 'H')[0]}</div>
    <div class="grow" style="min-width:0">
      <div class="dc-who"><b>${X.who}</b><span class="dc-bot">${X.bot}</span><small>${X.today}</small></div>
      <div class="dc-embed" style=${`border-left-color:${col}`}>
        <div class="dc-title">${s.name}</div>
        <div class="dc-grid">
          ${f(X.status, up ? X.online : boot ? X.starting : X.offline)}
          ${up && f(X.players, rawHtml`<b>${s.players ?? 0}</b> ${X.of} ${s.maxPlayers ?? '—'}`)}
          ${f(X.version, ver)}
          ${address && f(X.address, address, true)}
          ${up && f(X.uptime, X.self)}
        </div>
        <div class="dc-foot">HorizonCraft · ${X.updates} ${X.every[interval] || X.every[60]}</div>
      </div>
    </div>
  </div>`;
}

/** Адрес, который увидят игроки: готовые варианты (домен, публичный и локальный адрес) и поле для любого своего. */
function AddrPicker({ s, d, value, onChange }) {
  const port = Number(s.port) || 25565, withPort = h => (port === 25565 ? h : `${h}:${port}`);
  const lan = isRemote(s) ? s.node.host : location.hostname;
  const pub = isRemote(s) ? s.node.host : appState.settings.publicHost;
  const opts = [];
  const add = (label, host) => { if (host && !opts.some(o => o.v === host)) opts.push({ label, v: host }); };
  add('Домен сервера', s.domain);
  if (pub && pub !== lan) add('Публичный адрес', withPort(pub));
  add('Локальная сеть', lan && withPort(lan));
  return html`<${Field} label="Адрес для игроков"
    hint=${value ? 'Можно указать домен, внешний IP или адрес в локальной сети, с портом или без. Порт 25565 писать необязательно.'
      : d.autoAddress ? `Если оставить пустым, будет показан ${d.autoAddress}` : 'Если оставить пустым, адрес не показывается. Выберите вариант ниже или впишите свой.'}>
    <input placeholder=${d.autoAddress || 'play.example.com'} value=${value} maxlength="100" onInput=${e => onChange(e.target.value)} />
    ${opts.length > 0 && html`<div class="row wrap" style="gap:6px;margin-top:6px">${opts.map(o => html`<button key=${o.v} type="button" class=${'chip pick ' + (value === o.v ? 'ok' : '')} title="Подставить" onClick=${e => { e.preventDefault(); onChange(o.v); }}>${o.label}: <span class="mono">${o.v}</span></button>`)}</div>`}
  </${Field}>`;
}

/** Прокси только для табло: Discord открывается через выбранный узел (VLESS, ссылка vless:// или свой прокси). */
function ProxyBox({ s, d, value, onChange }) {
  const [chk, setChk] = useState(null);
  const [busy, setBusy] = useState(false);
  const nodes = d.proxyNodes || [];
  const nodeName = id => nodes.find(n => n.id === id)?.name || '';
  const toggle = on => { setChk(null); onChange({ on, node: value.node && nodes.some(n => n.id === value.node) ? value.node : (nodes[0]?.id || '') }); };
  const test = async () => {
    setBusy(true); setChk(null);
    try { setChk(await api(`/servers/${s.id}/discord/check`, { method: 'POST', body: { proxy: value } })); }
    catch (e) { setChk({ reach: false, error: e.message, via: '' }); }
    setBusy(false);
  };
  return html`<div class="col" style="gap:10px;border-top:1px solid var(--line);padding-top:14px">
    <div class="row wrap"><h3 class="grow" style="margin:0">Отправлять через прокси</h3>
      <${Toggle} on=${value.on} onChange=${toggle} label=${value.on ? 'Включено' : 'Выключено'} /></div>
    <small class="muted">Discord заблокирован у ряда провайдеров. Включите, и только запросы этого табло пойдут через выбранный узел. Остальной трафик панели и серверов не меняется. Узлы берутся из раздела «Прокси для серверов» в Настройках.</small>
    ${nodes.length === 0 ? html`<div class="banner info" style="margin:0">Узлов прокси пока нет. Добавьте подписку 3x-ui, ссылку <span class="mono">vless://</span> или свой прокси в <a href="#/settings">Настройках → Прокси для серверов</a>${isRemote(s) ? ' на машине, где работает этот сервер' : ''}.</div>`
      : html`<div class="row wrap" style="gap:10px">
        <select style="max-width:380px" value=${value.node} disabled=${!value.on} onChange=${e => { setChk(null); onChange({ on: true, node: e.target.value }); }}>
          ${nodes.map(n => html`<option key=${n.id} value=${n.id}>${n.name}${n.host ? ' · ' + n.host : ''}</option>`)}</select>
        <${Btn} icon="refresh" disabled=${busy} onClick=${test}>${busy ? 'Проверка…' : 'Проверить связь'}</${Btn}></div>`}
    ${chk && html`<div class=${'banner ' + (chk.reach && chk.webhook !== 'bad' ? 'info' : 'warn')} style="margin:0">
      ${chk.reach ? html`Discord доступен${chk.via ? ' (' + chk.via + ')' : ''}, ответ за ${chk.ms} мс.${chk.webhook === 'ok' ? ' Вебхук принимается.' : chk.webhook === 'bad' ? ' Но Discord не признаёт этот вебхук: проверьте адрес.' : ''}`
        : html`${chk.error || 'Discord не открывается'}`}</div>`}
  </div>`;
}

/** Язык сообщений в канале. Названия языков показываются на самих языках и не переводятся. */
function MsgLang({ value, onChange }) {
  return html`<div class="col" style="gap:8px"><span style="font-weight:580;font-size:13px">Язык сообщений в Discord</span>
    <div class="gpick">${[['ru', 'Русский'], ['en', 'English']].map(([id, n]) => html`<button type="button" key=${id} class=${'gp none ' + (value === id ? 'on' : '')} onClick=${() => onChange(id)}>${rawHtml`<span>${n}</span>`}</button>`)}</div>
    <small class="muted">На этом языке написаны статусы и события в канале. Он не зависит от языка панели.</small></div>`;
}

export function DiscordTab({ s }) {
  const [d, setD] = useState(null);
  const [f, setF] = useState(null);
  const [url, setUrl] = useState('');
  const [addr0, setAddr0] = useState('');
  const [proxy0, setProxy0] = useState({ on: false, node: '' });
  const [lang0, setLang0] = useState(uiLang);   // язык сообщений в канале: по умолчанию язык панели
  const [busy, setBusy] = useState(false);
  const set = (x, init) => { setD(x); if (init) setF({ on: x.on, interval: x.interval, address: x.address, lang: x.lang, events: x.events, proxy: { on: x.proxy.on, node: x.proxy.node } }); };
  const load = async init => { try { set(await api(`/servers/${s.id}/discord`), init); } catch (e) { toast(e.message, 'err'); } };
  useEffect(() => { load(true); const t = setInterval(() => load(false), 5000); return () => clearInterval(t); }, [s.id]);
  if (!d || !f) return html`<div class="skeleton" style="height:240px"></div>`;

  const put = async (body, ok) => {
    setBusy(true);
    try {
      const r = await api(`/servers/${s.id}/discord`, { method: 'PUT', body });
      set(r, true);
      if (r.error) toast(r.error, 'err'); else toast(ok);
      return r;
    } catch (e) { toast(e.message, 'err'); }
    finally { setBusy(false); }
  };
  const connect = async () => {
    if (!url.trim()) return toast('Вставьте адрес вебхука', 'err');
    const r = await put({ url, on: true, address: addr0.trim(), proxy: proxy0, lang: lang0 }, 'Готово, табло появилось в канале');
    if (r && !r.error) setUrl('');
  };
  const resend = async () => {
    setBusy(true);
    try { const r = await api(`/servers/${s.id}/discord/resend`, { method: 'POST' }); set(r, false); r.error ? toast(r.error, 'err') : toast('Новое сообщение отправлено, старое удалено'); }
    catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  const drop = async () => {
    if (!(await askConfirm('Отключить Discord? Сообщение с табло в канале будет удалено.'))) return;
    try { set(await api(`/servers/${s.id}/discord`, { method: 'DELETE' }), true); setUrl(''); toast('Discord отключён'); }
    catch (e) { toast(e.message, 'err'); }
  };
  const dirty = f.on !== d.on || f.lang !== d.lang || f.interval !== d.interval || f.address !== d.address || ['started', 'stopped', 'crashed', 'join'].some(k => f.events[k] !== d.events[k]) || f.proxy.on !== d.proxy.on || (f.proxy.on && f.proxy.node !== d.proxy.node);
  const addr = f.address || d.autoAddress;

  if (!d.connected) {
    return html`<div class="col">
      <div class="card col"><h2 style="margin:0">Табло сервера в Discord</h2>
        <p style="margin:0">Панель отправит в выбранный канал красивое сообщение со статусом сервера и сама будет его обновлять: онлайн или нет, сколько игроков и кто играет, версия, аптайм. Бот не нужен, хватит адреса вебхука.</p>
        <ol class="dc-steps">
          <li>В Discord откройте канал: <b>Настройки канала → Интеграции → Вебхуки → Новый вебхук</b>.</li>
          <li>Нажмите <b>«Копировать URL вебхука»</b>.</li>
          <li>Вставьте адрес сюда и нажмите «Подключить».</li>
        </ol>
        <${Field} label="Адрес вебхука" hint="Адрес секретный: кто его знает, тот может писать в канал. Панель его никому не показывает.">
          <div class="row"><input type="password" autocomplete="off" placeholder="https://discord.com/api/webhooks/…" value=${url} onInput=${e => setUrl(e.target.value)}
            onKeyDown=${e => e.key === 'Enter' && connect()} />
            <${Btn} kind="primary" icon="msg" disabled=${busy} onClick=${connect}>${busy ? 'Подключение…' : 'Подключить'}</${Btn}></div></${Field}>
        <${AddrPicker} s=${s} d=${d} value=${addr0} onChange=${setAddr0} />
        <${MsgLang} value=${lang0} onChange=${setLang0} />
        <${ProxyBox} s=${s} d=${d} value=${proxy0} onChange=${setProxy0} />
        ${d.error && html`<div class="banner warn" style="margin:0">${d.error}</div>`}
      </div>
      <div class="card col"><h3 style="margin:0">Так это будет выглядеть</h3><${Preview} s=${s} address=${addr0 || d.autoAddress} interval=${60} msgLang=${lang0} /></div>
    </div>`;
  }

  const state = d.error ? ['warn', 'Ошибка отправки'] : !d.on ? ['', 'Приостановлено'] : d.sentAt ? ['ok', 'Работает'] : ['', 'Ожидание первой отправки'];
  return html`<div class="col">
    <div class="card col">
      <div class="row wrap"><h2 class="grow" style="margin:0">Табло сервера в Discord</h2>
        <span class=${'chip ' + state[0]}>${state[1]}</span></div>
      ${d.error && html`<div class="banner warn" style="margin:0">${d.error}</div>`}
      <div class="row wrap" style="gap:18px">
        <span class="muted">Вебхук: <span class="mono" style="color:var(--text)">${d.hook}</span></span>
        <span class="muted">Последнее обновление: <b style="color:var(--text)">${d.sentAt ? ago(d.sentAt) : 'ещё не было'}</b></span>
      </div>
      <${Toggle} on=${f.on} onChange=${v => setF({ ...f, on: v })} label="Обновлять табло в канале" />
      <div class="row wrap" style="gap:20px 28px;align-items:flex-start">
        <div style="flex:1 1 440px;min-width:0"><${Field} label="Как часто обновлять" hint="Изменения (запуск, вход игрока) попадают в табло почти сразу, это ещё и пульс: если панель остановится, время в сообщении перестанет меняться.">
          <div class="seg" style="width:fit-content;white-space:nowrap">${INTERVALS.map(([v, n]) => html`<button key=${v} class=${f.interval === v ? 'on' : ''} onClick=${() => setF({ ...f, interval: v })}>${n}</button>`)}</div></${Field}></div>
        <div style="flex:1 1 300px;min-width:0"><${AddrPicker} s=${s} d=${d} value=${f.address} onChange=${v => setF({ ...f, address: v })} /></div>
      </div>
      <${MsgLang} value=${f.lang} onChange=${v => setF({ ...f, lang: v })} />
      <div class="col" style="gap:8px"><h3 style="margin:4px 0 0">Отдельные сообщения о событиях</h3>
        <${Toggle} on=${f.events.started} onChange=${v => setF({ ...f, events: { ...f.events, started: v } })} label="Сервер запущен" />
        <${Toggle} on=${f.events.stopped} onChange=${v => setF({ ...f, events: { ...f.events, stopped: v } })} label="Сервер остановился" />
        <${Toggle} on=${f.events.crashed} onChange=${v => setF({ ...f, events: { ...f.events, crashed: v } })} label="Сервер упал (завершился с ошибкой)" />
        <${Toggle} on=${f.events.join} onChange=${v => setF({ ...f, events: { ...f.events, join: v } })} label="Игрок зашёл или вышел" />
        <small class="muted">Каждое событие о запуске, остановке и падении приходит не чаще раза в 10 минут. Само табло обновляется без новых сообщений.</small></div>
      <${ProxyBox} s=${s} d=${d} value=${f.proxy} onChange=${v => setF({ ...f, proxy: v })} />
      <div class="row wrap" style="gap:10px">
        <${Btn} kind="primary" icon="save" disabled=${busy || !dirty} onClick=${() => put(f, 'Сохранено')}>Сохранить</${Btn}>
        <${Btn} icon="refresh" disabled=${busy || !d.on || dirty} onClick=${resend} title="Удалить старое сообщение и отправить табло заново, например, чтобы закрепить его">Отправить заново</${Btn}>
        <span class="grow"></span>
        <${Btn} kind="danger ghost" icon="x" disabled=${busy} onClick=${drop}>Отключить</${Btn}>
      </div>
    </div>
    <div class="card col"><h3 style="margin:0">Так сейчас выглядит сообщение</h3><${Preview} s=${s} address=${addr} interval=${f.interval} msgLang=${f.lang} /></div>
  </div>`;
}

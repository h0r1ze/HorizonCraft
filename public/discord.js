import { html, rawHtml, useState, useEffect, useRef, Icon, Btn, Field, Toggle, toast, askConfirm, ago, appState, isRemote, lang as uiLang } from './ui.js';
import { api } from './api.js';
import { ViaSwitch, ActiveLine } from './proxy.js';

/* Табло в Discord: панель сама правит одно сообщение в канале. Отправитель: вебхук канала или свой бот. */

const INTERVALS = [[30, '30 секунд'], [60, '1 минута'], [120, '2 минуты'], [300, '5 минут']];
const TYPE_NAME = { VANILLA: 'Vanilla', PAPER: 'Paper', PURPUR: 'Purpur', FABRIC: 'Fabric', FORGE: 'Forge', NEOFORGE: 'NeoForge', AUTO_CURSEFORGE: 'CurseForge' };
const ACTIVITIES = [[0, 'Играет в …'], [3, 'Смотрит …'], [2, 'Слушает …'], [5, 'Соревнуется в …'], [4, 'Свой текст']];
const FIELDS = [['players', 'Игроки'], ['version', 'Версия'], ['address', 'Адрес'], ['uptime', 'Аптайм'], ['memory', 'Память'], ['list', 'Кто сейчас играет']];

/* Тексты макета на языке сообщений в Discord (не зависят от языка панели): так они выглядят в канале. */
const PV = {
  ru: { who: 'Вебхук', bot: 'БОТ', app: 'ПРИЛОЖЕНИЕ', today: 'сегодня', status: 'Статус', players: 'Игроки', of: 'из', version: 'Версия', address: 'Адрес', uptime: 'Аптайм', memory: 'Память', playing: 'Сейчас играют', self: 'обновляется само',
    online: '🟢 Онлайн', starting: '🟡 Запускается', offline: '🔴 Выключен', updates: 'обновляется', every: { 30: 'каждые 30 секунд', 60: 'каждую минуту', 120: 'каждые 2 минуты', 300: 'каждые 5 минут' },
    started: '🟢 Сервер запущен', joined: '➕ Зашёл: ', about: 'ОБО МНЕ', verbs: { 0: 'Играет в', 2: 'Слушает', 3: 'Смотрит', 5: 'Соревнуется в' }, offShort: 'сервер выключен', bootShort: 'сервер запускается', gb: 'ГБ' },
  en: { who: 'Webhook', bot: 'BOT', app: 'APP', today: 'today', status: 'Status', players: 'Players', of: 'of', version: 'Version', address: 'Address', uptime: 'Uptime', memory: 'Memory', playing: 'Playing now', self: 'updates itself',
    online: '🟢 Online', starting: '🟡 Starting', offline: '🔴 Offline', updates: 'updates', every: { 30: 'every 30 seconds', 60: 'every minute', 120: 'every 2 minutes', 300: 'every 5 minutes' },
    started: '🟢 Server started', joined: '➕ Joined: ', about: 'ABOUT ME', verbs: { 0: 'Playing', 2: 'Listening to', 3: 'Watching', 5: 'Competing in' }, offShort: 'server offline', bootShort: 'server starting', gb: 'GB' },
};

/** Кружок с аватаром отправителя: загруженная в форме картинка, аватар из Discord или первая буква имени. */
function Ava({ s, d, draft, cls = 'dc-ava', name }) {
  const src = draft?.avatar || (!draft?.avatarClear && d.profile?.avatar ? `/api/servers/${s.id}/discord/avatar?v=${d.profile.ver}` : '');
  return src ? rawHtml`<img class=${cls} src=${src} alt="" />` : rawHtml`<div class=${cls}>${(name || s.name || 'H')[0]}</div>`;
}
const senderName = (d, draft, X) => (draft?.name ?? d.profile?.name) || (d.kind === 'bot' ? 'HorizonCraft' : X.who);

/** Что бот покажет под именем (как на сервере: подстановки и короткий текст при выключенном сервере). */
function presenceText(s, f, address, X) {
  const a = f.bot?.activity || { type: 0, text: '' };
  if (!a.text) return null;
  const st = s.state === 'running' ? 'running' : s.state === 'starting' ? 'starting' : 'stopped';
  const text = st !== 'running' ? `${s.name}: ${st === 'starting' ? X.bootShort : X.offShort}`
    : a.text.replace(/\{server\}/g, s.name).replace(/\{online\}/g, s.players ?? 0).replace(/\{max\}/g, s.maxPlayers ?? '?').replace(/\{address\}/g, address || '').replace(/\{version\}/g, s.version && s.version !== 'LATEST' ? s.version : '').trim();
  return { verb: a.type === 4 || st !== 'running' && a.type === 4 ? '' : X.verbs[st === 'running' ? a.type : 0] || '', text, dot: st === 'running' ? 'online' : st === 'starting' ? 'idle' : 'dnd' };
}

/** Макет: так сообщения выглядят в Discord (по данным сервера прямо сейчас). */
function Preview({ s, d, f, address, draft, withEvent }) {
  const X = PV[f.lang] || PV.ru, look = f.look, on = look.fields;
  const up = s.state === 'running', boot = s.state === 'starting';
  const ver = `${TYPE_NAME[s.type] || s.type} ${s.version && s.version !== 'LATEST' ? s.version : ''}`.trim();
  const col = up ? '#2ecc71' : boot ? '#f1c40f' : '#e74c3c';
  const fl = (n, v, mono) => rawHtml`<div class="dcf"><b>${n}</b><span class=${mono ? 'mono' : ''}>${v}</span></div>`;
  const who = senderName(d, draft, X), title = look.title || s.name;
  const head = rawHtml`<div class="dc-who"><b>${who}</b><span class="dc-bot">${d.kind === 'bot' ? X.app : X.bot}</span><small>${X.today}</small></div>`;
  return rawHtml`<div class="dc-chat">
    <div class="dc-msg">
      <${Ava} s=${s} d=${d} draft=${draft} name=${who} />
      <div class="grow" style="min-width:0">${head}
        <div class="dc-embed" style=${`border-left-color:${col}`}>
          <div class="dc-title">${title}</div>
          ${look.text && rawHtml`<div class="dc-desc">${look.text}</div>`}
          <div class="dc-grid">
            ${fl(X.status, up ? X.online : boot ? X.starting : X.offline)}
            ${up && on.players && fl(X.players, rawHtml`<b>${s.players ?? 0}</b> ${X.of} ${s.maxPlayers ?? '—'}`)}
            ${on.version && fl(X.version, ver)}
            ${address && on.address && fl(X.address, address, true)}
            ${up && on.uptime && fl(X.uptime, X.self)}
            ${up && on.memory && fl(X.memory, X.self)}
          </div>
          ${look.footerOn && rawHtml`<div class="dc-foot">${look.footer || 'HorizonCraft'} · ${X.updates} ${X.every[f.interval] || X.every[60]}</div>`}
        </div>
      </div>
    </div>
    ${withEvent && rawHtml`<div class="dc-msg">
      <${Ava} s=${s} d=${d} draft=${draft} name=${who} />
      <div class="grow" style="min-width:0">${head}
        <div class="dc-embed" style="border-left-color:#3498db"><div class="dc-title">${title}</div><div class="dc-desc">${X.joined}<code>Steve</code></div></div></div>
    </div>`}
  </div>`;
}

/** Макет профиля бота: так он выглядит в списке участников и по клику на имя. */
function BotProfile({ s, d, f, address, draft }) {
  const X = PV[f.lang] || PV.ru, name = senderName(d, draft, X);
  const p = f.bot.online ? presenceText(s, f, address, X) : null;
  const about = draft?.about ?? d.profile?.about;
  return rawHtml`<div class="dc-prof">
    <div class="dc-banner"></div>
    <div class="dc-pava"><${Ava} s=${s} d=${d} draft=${draft} cls="dc-ava big" name=${name} /><span class=${'dc-dot ' + (f.bot.online ? p?.dot || 'online' : 'off')}></span></div>
    <div class="dc-pbody">
      <div class="dc-pname">${name} <span class="dc-bot">${X.app}</span></div>
      ${p && rawHtml`<div class="dc-pact">${p.verb ? p.verb + ' ' : ''}<b>${p.text}</b></div>`}
      ${about && rawHtml`<div class="dc-psec">${X.about}</div><div class="dc-pabout">${about}</div>`}
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

/** Как панель ходит в Discord: напрямую или через VLESS (узел и режим общие, из Настроек). */
function ProxyBox({ s, d, value, onChange }) {
  const [chk, setChk] = useState(null);
  const [busy, setBusy] = useState(false);
  const test = async () => {
    setBusy(true); setChk(null);
    try { setChk(await api(`/servers/${s.id}/discord/check`, { method: 'POST', body: { proxy: value } })); }
    catch (e) { setChk({ reach: false, error: e.message, via: '' }); }
    setBusy(false);
  };
  const act = { node: d.proxy.available ? 'x' : '', name: d.proxy.name, mode: 'proxy' };
  return html`<div class="col" style="gap:10px;border-top:1px solid var(--line);padding-top:14px">
    <div class="row wrap"><h3 class="grow" style="margin:0">Связь с Discord</h3>
      <${ViaSwitch} on=${value.on} disabled=${!d.proxy.available} onChange=${on => { setChk(null); onChange({ on }); }} /></div>
    <small class="muted">Discord заблокирован у ряда провайдеров. Через VLESS пойдут только запросы этого табло и подключение бота. Остальной трафик панели и серверов не меняется.</small>
    ${!d.proxy.available ? html`<${ActiveLine} active=${act} />` : value.on && html`<small class="muted">Узел: <b style="color:var(--text)">${rawHtml`${d.proxy.name}`}</b> · <a href="#/settings/network">изменить в Настройках</a></small>`}
    <div class="row wrap" style="gap:10px"><${Btn} icon="refresh" disabled=${busy} onClick=${test}>${busy ? 'Проверка…' : 'Проверить связь'}</${Btn}></div>
    ${chk && html`<div class=${'banner ' + (chk.reach && chk.webhook !== 'bad' && chk.bot !== 'bad' ? 'info' : 'warn')} style="margin:0">
      ${chk.reach ? html`Discord доступен${chk.via ? ' (' + chk.via + ')' : ''}, ответ за ${chk.ms} мс.${chk.webhook === 'ok' ? ' Вебхук принимается.' : chk.webhook === 'bad' ? ' Но Discord не признаёт этот вебхук: проверьте адрес.' : ''}${chk.bot === 'ok' ? ' Токен бота принимается.' : chk.bot === 'bad' ? ' Но Discord не принимает токен бота.' : ''}`
        : html`${chk.error || 'Discord не открывается'}`}</div>`}
  </div>`;
}

/** Язык сообщений в канале. Названия языков показываются на самих языках и не переводятся. */
function MsgLang({ value, onChange }) {
  return html`<div class="col" style="gap:8px"><span style="font-weight:580;font-size:13px">Язык сообщений в Discord</span>
    <div class="gpick">${[['ru', 'Русский'], ['en', 'English']].map(([id, n]) => html`<button type="button" key=${id} class=${'gp none ' + (value === id ? 'on' : '')} onClick=${() => onChange(id)}>${rawHtml`<span>${n}</span>`}</button>`)}</div>
    <small class="muted">На этом языке написаны статусы и события в канале. Он не зависит от языка панели.</small></div>`;
}

/** Бот: сервер Discord и каналы, куда он пишет. Бот пишет только в выбранные каналы. */
function ChannelPicker({ s, d, value, onChange }) {
  const [guilds, setGuilds] = useState(null);
  const [chans, setChans] = useState(null);
  const [err, setErr] = useState('');
  const loadGuilds = async () => {
    setErr('');
    try {
      const g = await api(`/servers/${s.id}/discord/guilds`);
      setGuilds(g);
      if (!value.guildId && g.length === 1) onChange({ ...value, guildId: g[0].id, guildName: g[0].name });
    } catch (e) { setErr(e.message); setGuilds([]); }
  };
  useEffect(() => { loadGuilds(); }, [s.id, d.bot.hint]);
  useEffect(() => {
    if (!value.guildId) { setChans(null); return; }
    let alive = true;
    setChans(null);
    api(`/servers/${s.id}/discord/channels?guild=${value.guildId}`).then(c => alive && setChans(c)).catch(e => { if (alive) { setErr(e.message); setChans([]); } });
    return () => { alive = false; };
  }, [value.guildId]);
  const opt = c => html`<option key=${c.id} value=${c.id}>${rawHtml`# ${c.name}${c.category ? ' · ' + c.category : ''}`}</option>`;
  const keep = (id, name) => id && !(chans || []).some(c => c.id === id) && html`<option value=${id}>${rawHtml`# ${name || id}`}</option>`;
  return html`<div class="col" style="gap:12px">
    ${err && html`<div class="banner warn" style="margin:0">${err}</div>`}
    ${guilds && guilds.length === 0 && !err && html`<div class="banner info" style="margin:0">Бот пока не добавлен ни на один сервер Discord. Нажмите «Пригласить бота», выберите свой сервер и вернитесь сюда.</div>`}
    <div class="row wrap" style="gap:10px">
      ${d.bot.invite && html`<a class="btn" href=${d.bot.invite} target="_blank" rel="noopener noreferrer"><${Icon} n="plus" size=${17} />Пригласить бота на сервер Discord</a>`}
      <${Btn} icon="refresh" onClick=${loadGuilds}>Обновить список</${Btn}></div>
    <div class="fields">
      <${Field} label="Сервер Discord">
        <select value=${value.guildId} onChange=${e => { const g = (guilds || []).find(x => x.id === e.target.value); onChange({ ...value, guildId: e.target.value, guildName: g?.name || '', channelId: '', eventsChannelId: '' }); }}>
          <option value="">— выберите —</option>
          ${value.guildId && !(guilds || []).some(g => g.id === value.guildId) && html`<option value=${value.guildId}>${rawHtml`${d.bot.guildName || value.guildId}`}</option>`}
          ${(guilds || []).map(g => html`<option key=${g.id} value=${g.id}>${rawHtml`${g.name}`}</option>`)}</select></${Field}>
      <${Field} label="Канал для табло" hint="Здесь бот держит одно сообщение со статусом сервера и сам его обновляет.">
        <select value=${value.channelId} disabled=${!value.guildId} onChange=${e => onChange({ ...value, channelId: e.target.value })}>
          <option value="">${value.guildId && !chans ? 'загрузка…' : '— выберите —'}</option>
          ${keep(value.channelId, d.bot.channelName)}${(chans || []).map(opt)}</select></${Field}>
      <${Field} label="Канал для событий" hint="Запуск, остановка, входы и выходы игроков. Можно оставить тот же канал или выбрать отдельный.">
        <select value=${value.eventsChannelId} disabled=${!value.guildId} onChange=${e => onChange({ ...value, eventsChannelId: e.target.value })}>
          <option value="">Тот же, что для табло</option>
          ${keep(value.eventsChannelId, d.bot.eventsChannelName)}${(chans || []).map(opt)}</select></${Field}>
    </div>
    <small class="muted">Бот пишет только в выбранные каналы. В остальных каналах сервера он молчит, даже если видит их.</small>
  </div>`;
}

/** Имя, аватар и описание бота или вебхука: меняются прямо из панели. */
function ProfileCard({ s, d, f, address, set }) {
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const file = useRef(null);
  const bot = d.kind === 'bot', X = PV[f.lang] || PV.ru;
  const name = draft.name ?? d.profile?.name ?? '', about = draft.about ?? d.profile?.about ?? '';
  const dirty = 'name' in draft && draft.name !== (d.profile?.name ?? '') || 'about' in draft && draft.about !== (d.profile?.about ?? '') || !!draft.avatar || !!draft.avatarClear;
  const pick = e => {
    const fl = e.target.files?.[0];
    e.target.value = '';
    if (!fl) return;
    if (fl.size > 3 * 1024 * 1024) return toast('Аватар: файл больше 3 МБ', 'err');
    const r = new FileReader();
    r.onload = () => setDraft(x => ({ ...x, avatar: r.result, avatarClear: false }));
    r.readAsDataURL(fl);
  };
  const save = async () => {
    setBusy(true);
    try {
      const body = {};
      if ('name' in draft && draft.name !== (d.profile?.name ?? '')) body.name = draft.name;
      if (bot && 'about' in draft && draft.about !== (d.profile?.about ?? '')) body.about = draft.about;
      if (draft.avatar) body.avatar = draft.avatar; else if (draft.avatarClear) body.avatarClear = true;
      set(await api(`/servers/${s.id}/discord/profile`, { method: 'PUT', body }), false);
      setDraft({});
      toast(bot ? 'Профиль бота обновлён' : 'Вебхук обновлён');
    } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  return html`<div class="card col">
    <h2 style="margin:0">${bot ? 'Как выглядит бот' : 'Как выглядит отправитель'} <span class="sub">имя и аватар меняются прямо отсюда</span></h2>
    <div class="dc-edit">
      <div class="col" style="gap:14px;min-width:0">
        <div class="row wrap" style="gap:14px;align-items:center">
          <${Ava} s=${s} d=${d} draft=${draft} cls="dc-ava big" name=${name || senderName(d, draft, X)} />
          <div class="row wrap" style="gap:8px">
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none" ref=${file} onChange=${pick} />
            <${Btn} icon="upload" disabled=${busy} onClick=${() => file.current?.click()}>Загрузить аватар</${Btn}>
            ${(draft.avatar || (d.profile?.avatar && !draft.avatarClear)) && html`<${Btn} kind="ghost" icon="trash" disabled=${busy} onClick=${() => setDraft(x => ({ ...x, avatar: '', avatarClear: true }))}>Убрать</${Btn}>`}
          </div>
        </div>
        <${Field} label=${bot ? 'Имя бота' : 'Имя отправителя'} hint=${bot ? 'От 2 до 32 символов. Discord разрешает менять имя бота не чаще двух раз в час.' : 'Так подписаны сообщения в канале. До 80 символов.'}>
          <input value=${name} maxlength=${bot ? 32 : 80} placeholder=${bot ? 'HorizonCraft' : X.who} onInput=${e => setDraft(x => ({ ...x, name: e.target.value }))} /></${Field}>
        ${bot && html`<${Field} label="О себе" hint="Текст в профиле бота, виден по клику на его имя. До 400 символов.">
          <textarea style="min-height:70px" maxlength="400" value=${about} onInput=${e => setDraft(x => ({ ...x, about: e.target.value }))}></textarea></${Field}>`}
        ${bot && html`<div class="col" style="gap:10px">
          <${Toggle} on=${f.bot.online} onChange=${v => set(null, null, { bot: { ...f.bot, online: v } })} label="Показывать бота в сети со статусом" />
          ${f.bot.online && html`<div class="fields">
            <${Field} label="Вид статуса"><select value=${f.bot.activity.type} onChange=${e => set(null, null, { bot: { ...f.bot, activity: { ...f.bot.activity, type: +e.target.value } } })}>
              ${ACTIVITIES.map(([v, n]) => html`<option key=${v} value=${v}>${n}</option>`)}</select></${Field}>
            <${Field} label="Текст статуса" hint="Подстановки: {server} название, {online} игроков сейчас, {max} мест, {address} адрес, {version} версия. Пустое поле: без статуса.">
              <input class="mono" maxlength="100" value=${f.bot.activity.text} onInput=${e => set(null, null, { bot: { ...f.bot, activity: { ...f.bot.activity, text: e.target.value } } })} /></${Field}></div>
            <small class="muted">Зелёный кружок, когда сервер работает, жёлтый при запуске, красный, когда сервер выключен. Статус и переключатель сохраняются кнопкой «Сохранить» вверху.</small>`}
        </div>`}
        <div><${Btn} kind="primary" icon="save" disabled=${busy || !dirty} onClick=${save}>${bot ? 'Сохранить профиль бота' : 'Сохранить имя и аватар'}</${Btn}></div>
      </div>
      <div class="col" style="gap:8px;min-width:0"><span class="muted" style="font-size:12.5px">${bot ? 'Так бот выглядит в Discord' : 'Так подписано сообщение в Discord'}</span>
        ${bot ? html`<${BotProfile} s=${s} d=${d} f=${f} address=${address} draft=${draft} />`
          : rawHtml`<div class="dc-chat"><div class="dc-msg"><${Ava} s=${s} d=${d} draft=${draft} name=${name || X.who} /><div class="grow"><div class="dc-who"><b>${name || X.who}</b><span class="dc-bot">${X.bot}</span><small>${X.today}</small></div><div class="dc-desc">${X.started}</div></div></div></div>`}
      </div>
    </div>
  </div>`;
}

/** Вид сообщения-табло: заголовок, текст, поля и подпись. Макет справа меняется сразу. */
function LookCard({ s, d, f, address, setF }) {
  const look = f.look, set = o => setF({ ...f, look: { ...look, ...o } });
  return html`<div class="card col">
    <h2 style="margin:0">Как выглядит сообщение <span class="sub">макет показывает канал Discord</span></h2>
    <div class="dc-edit">
      <div class="col" style="gap:14px;min-width:0">
        <${Field} label="Заголовок" hint="Если оставить пустым, в заголовке будет название сервера.">
          <input value=${look.title} maxlength="100" placeholder=${s.name} onInput=${e => set({ title: e.target.value })} /></${Field}>
        <${Field} label="Текст под заголовком" hint="Например, приветствие или правила. До 400 символов, работает разметка Discord (**жирный**, ссылки).">
          <textarea style="min-height:70px" maxlength="400" value=${look.text} onInput=${e => set({ text: e.target.value })}></textarea></${Field}>
        <div class="col" style="gap:8px"><span style="font-weight:580;font-size:13px">Что показывать в табло</span>
          <div class="dc-checks">${FIELDS.map(([k, n]) => html`<${Toggle} key=${k} on=${look.fields[k]} onChange=${v => set({ fields: { ...look.fields, [k]: v } })} label=${n} />`)}</div>
          <small class="muted">Статус сервера показывается всегда. Игроки, аптайм и память видны только у работающего сервера.</small></div>
        <div class="col" style="gap:8px">
          <${Toggle} on=${look.footerOn} onChange=${v => set({ footerOn: v })} label="Подпись внизу сообщения" />
          ${look.footerOn && html`<input value=${look.footer} maxlength="60" placeholder="HorizonCraft" onInput=${e => set({ footer: e.target.value })} />`}</div>
      </div>
      <div class="col" style="gap:8px;min-width:0"><span class="muted" style="font-size:12.5px">Так сообщения выглядят в канале сейчас</span>
        <${Preview} s=${s} d=${d} f=${f} address=${address} withEvent=${true} /></div>
    </div>
  </div>`;
}

/** Ответ сервера в полном виде. Нода со старой версией панели отдаёт прежний формат (без бота, вида сообщения
    и профиля): дополняем значениями по умолчанию, чтобы вкладка работала и не ломала остальную панель. */
const LOOK0 = { title: '', text: '', footer: '', footerOn: true, fields: { players: true, version: true, address: true, uptime: true, memory: true, list: true } };
const BOT0 = { tokenSet: false, hint: '', guildId: '', guildName: '', channelId: '', channelName: '', eventsChannelId: '', eventsChannelName: '', activity: { type: 0, text: '{server}: {online}/{max}' }, online: true, gateway: 'off', gatewayError: '', invite: '' };
const norm = x => ({
  kind: 'webhook', profile: null, ...x,
  bot: { ...BOT0, ...(x.bot || {}), activity: { ...BOT0.activity, ...(x.bot?.activity || {}) } },
  look: { ...LOOK0, ...(x.look || {}), fields: { ...LOOK0.fields, ...(x.look?.fields || {}) } },
  events: { started: false, stopped: false, crashed: false, join: false, ...(x.events || {}) },
  proxy: { on: !!x.proxy?.on, name: x.proxy?.name || '', available: x.proxy?.available ?? !!(x.proxyNodes || []).length },
});

/** Способ отправки на уже подключённом табло: вебхук или свой бот. Смена не требует отключать Discord. */
function KindSwitch({ s, d, f, run }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [url, setUrl] = useState('');
  const bot = d.kind === 'bot';
  const toBot = async () => {
    if (!token.trim()) return toast('Вставьте токен бота', 'err');
    const r = await run(() => api(`/servers/${s.id}/discord/bot`, { method: 'POST', body: { token: token.trim(), proxy: f.proxy, lang: f.lang } }), 'Бот подключён. Теперь выберите канал.');
    if (r) { setToken(''); setOpen(false); }
  };
  const toHook = async () => {
    if (!d.hook && !url.trim()) return toast('Вставьте адрес вебхука', 'err');
    const r = await run(() => api(`/servers/${s.id}/discord`, { method: 'PUT', body: { kind: 'webhook', on: true, ...(url.trim() ? { url: url.trim() } : {}) } }), 'Табло снова отправляется через вебхук');
    if (r) { setUrl(''); setOpen(false); }
  };
  return html`<div class="col" style="gap:10px;border-top:1px solid var(--line);padding-top:14px">
    <div class="row wrap"><h3 class="grow" style="margin:0">Способ отправки</h3>
      <div class="seg" style="width:fit-content;white-space:nowrap">${[['webhook', 'Вебхук'], ['bot', 'Свой бот']].map(([k, n]) => html`<button type="button" key=${k} class=${(open ? k !== d.kind : k === d.kind) ? 'on' : ''} onClick=${() => setOpen(k !== d.kind)}>${n}</button>`)}</div></div>
    ${!open ? html`<small class="muted">${bot ? 'Сейчас табло отправляет ваш бот. Нажмите «Вебхук», чтобы вернуться к вебхуку канала.' : 'Сейчас табло отправляется через вебхук. Нажмите «Свой бот», чтобы панель подняла вашего бота: он будет в сети со статусом и будет писать только в выбранные каналы.'}</small>`
      : !bot ? html`<div class="col" style="gap:12px">
        <ol class="dc-steps">
          <li>Откройте <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer">Discord Developer Portal</a> и нажмите <b>New Application</b>.</li>
          <li>В разделе <b>Bot</b> нажмите <b>Reset Token</b> и скопируйте токен.</li>
          <li>Вставьте токен сюда. Дальше панель покажет ссылку-приглашение и список каналов.</li>
        </ol>
        <${Field} label="Токен бота" hint="Старое сообщение вебхука будет удалено, бот отправит новое табло в выбранный канал. Адрес вебхука сохранится, к нему можно вернуться.">
          <div class="row"><input type="password" autocomplete="off" placeholder="MTIzNDU2Nzg5…" value=${token} onInput=${e => setToken(e.target.value)} onKeyDown=${e => e.key === 'Enter' && toBot()} />
            <${Btn} kind="primary" icon="rocket" onClick=${toBot}>Подключить бота</${Btn}></div></${Field}>
        <div><${Btn} kind="ghost" onClick=${() => setOpen(false)}>Отмена</${Btn}></div></div>`
      : html`<div class="col" style="gap:12px">
        <${Field} label="Адрес вебхука" hint=${d.hook ? 'Если оставить пустым, будет использован сохранённый вебхук. Бот перестанет писать и уйдёт из сети.' : 'Настройки канала → Интеграции → Вебхуки → Новый вебхук → Копировать URL вебхука.'}>
          <div class="row"><input type="password" autocomplete="off" placeholder=${d.hook || 'https://discord.com/api/webhooks/…'} value=${url} onInput=${e => setUrl(e.target.value)} onKeyDown=${e => e.key === 'Enter' && toHook()} />
            <${Btn} kind="primary" icon="msg" onClick=${toHook}>Перейти на вебхук</${Btn}></div></${Field}>
        <div><${Btn} kind="ghost" onClick=${() => setOpen(false)}>Отмена</${Btn}></div></div>`}
  </div>`;
}

const formOf = x => ({
  on: x.on, interval: x.interval, address: x.address, lang: x.lang, events: x.events, proxy: { on: x.proxy.on }, look: x.look,
  bot: { guildId: x.bot.guildId, guildName: x.bot.guildName, channelId: x.bot.channelId, eventsChannelId: x.bot.eventsChannelId, activity: x.bot.activity, online: x.bot.online },
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function DiscordTab({ s }) {
  const [d, setD] = useState(null);
  const [f, setF] = useState(null);
  const [kind0, setKind0] = useState('webhook');   // способ, выбранный на экране подключения
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  // set(ответ, сбросить форму?, правка формы): после сохранения форма берётся из ответа, при опросе остаётся как есть
  const set = (x0, init, patch) => {
    const x = x0 && norm(x0);
    if (x) setD(x);
    if (x && init) setF({ ...formOf(x), lang: x.connected || x.bot.tokenSet ? x.lang : uiLang });
    if (patch) setF(cur => ({ ...cur, ...patch }));
  };
  const load = async init => { try { const x = norm(await api(`/servers/${s.id}/discord`)); set(x, init); if (init) setKind0(x.kind); } catch (e) { toast(e.message, 'err'); } };
  useEffect(() => { load(true); const t = setInterval(() => load(false), 5000); return () => clearInterval(t); }, [s.id]);
  if (!d || !f) return html`<div class="skeleton" style="height:240px"></div>`;

  const run = async (fn, ok) => {
    setBusy(true);
    try {
      const r = await fn();
      set(r, true);
      if (r.error) toast(r.error, 'err'); else if (ok) toast(ok);
      return r;
    } catch (e) { toast(e.message, 'err'); }
    finally { setBusy(false); }
  };
  const put = (body, ok) => run(() => api(`/servers/${s.id}/discord`, { method: 'PUT', body }), ok);
  const body = (extra = {}) => ({ ...f, kind: d.kind, bot: d.kind === 'bot' ? f.bot : undefined, ...extra });
  const connectHook = async () => {
    if (!url.trim()) return toast('Вставьте адрес вебхука', 'err');
    const r = await put({ ...f, bot: undefined, kind: 'webhook', url, on: true, address: f.address.trim() }, 'Готово, табло появилось в канале');
    if (r && !r.error) setUrl('');
  };
  const connectBot = async () => {
    if (!token.trim()) return toast('Вставьте токен бота', 'err');
    const r = await run(() => api(`/servers/${s.id}/discord/bot`, { method: 'POST', body: { token: token.trim(), proxy: f.proxy, lang: f.lang } }), 'Бот подключён. Теперь выберите канал.');
    if (r) setToken('');
  };
  const resend = () => run(() => api(`/servers/${s.id}/discord/resend`, { method: 'POST' }), 'Новое сообщение отправлено, старое удалено');
  const drop = async () => {
    if (!(await askConfirm('Отключить Discord? Сообщение с табло в канале будет удалено.'))) return;
    const r = await run(() => api(`/servers/${s.id}/discord`, { method: 'DELETE' }), 'Discord отключён');
    if (r) { setUrl(''); setToken(''); setKind0('webhook'); }
  };
  const dirty = !same(f, formOf(d));
  const addr = f.address || d.autoAddress;
  const botSetup = d.kind === 'bot' && d.bot.tokenSet && !d.connected;

  /* ---------- ещё не подключено ---------- */
  if (!d.connected && !botSetup) {
    const bot = kind0 === 'bot';
    return html`<div class="col">
      <div class="card col"><h2 style="margin:0">Табло сервера в Discord</h2>
        <p style="margin:0">Панель отправит в выбранный канал красивое сообщение со статусом сервера и сама будет его обновлять: онлайн или нет, сколько игроков и кто играет, версия, аптайм.</p>
        <div class="vmodes">
          <button class=${'vmode ' + (!bot ? 'on' : '')} onClick=${() => setKind0('webhook')}><b>Вебхук</b><span>Самый простой способ: нужен только адрес вебхука канала. Имя и аватар отправителя настраиваются из панели.</span></button>
          <button class=${'vmode ' + (bot ? 'on' : '')} onClick=${() => setKind0('bot')}><b>Свой бот</b><span>Панель поднимает вашего бота: он в сети, показывает статус «Играет в …» и пишет только в выбранные каналы. Имя, аватар и описание меняются из панели.</span></button>
        </div>
        ${!bot ? html`<ol class="dc-steps">
          <li>В Discord откройте канал: <b>Настройки канала → Интеграции → Вебхуки → Новый вебхук</b>.</li>
          <li>Нажмите <b>«Копировать URL вебхука»</b>.</li>
          <li>Вставьте адрес сюда и нажмите «Подключить».</li>
        </ol>
        <${Field} label="Адрес вебхука" hint="Адрес секретный: кто его знает, тот может писать в канал. Панель его никому не показывает.">
          <div class="row"><input type="password" autocomplete="off" placeholder="https://discord.com/api/webhooks/…" value=${url} onInput=${e => setUrl(e.target.value)}
            onKeyDown=${e => e.key === 'Enter' && connectHook()} />
            <${Btn} kind="primary" icon="msg" disabled=${busy} onClick=${connectHook}>${busy ? 'Подключение…' : 'Подключить'}</${Btn}></div></${Field}>`
        : html`<ol class="dc-steps">
          <li>Откройте <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer">Discord Developer Portal</a> и нажмите <b>New Application</b>.</li>
          <li>В разделе <b>Bot</b> нажмите <b>Reset Token</b> и скопируйте токен.</li>
          <li>Вставьте токен сюда. Дальше панель покажет ссылку-приглашение и список каналов.</li>
        </ol>
        <${Field} label="Токен бота" hint="Токен секретный: с ним можно управлять ботом. Панель хранит его у себя и никому не показывает.">
          <div class="row"><input type="password" autocomplete="off" placeholder="MTIzNDU2Nzg5…" value=${token} onInput=${e => setToken(e.target.value)}
            onKeyDown=${e => e.key === 'Enter' && connectBot()} />
            <${Btn} kind="primary" icon="rocket" disabled=${busy} onClick=${connectBot}>${busy ? 'Подключение…' : 'Подключить бота'}</${Btn}></div></${Field}>`}
        <${AddrPicker} s=${s} d=${d} value=${f.address} onChange=${v => setF({ ...f, address: v })} />
        <${MsgLang} value=${f.lang} onChange=${v => setF({ ...f, lang: v })} />
        <${ProxyBox} s=${s} d=${d} value=${f.proxy} onChange=${v => setF({ ...f, proxy: v })} />
        ${d.error && html`<div class="banner warn" style="margin:0">${d.error}</div>`}
      </div>
      <div class="card col"><h3 style="margin:0">Так это будет выглядеть</h3><${Preview} s=${s} d=${{ ...d, kind: kind0, profile: null }} f=${f} address=${addr} /></div>
    </div>`;
  }

  /* ---------- бот подключён, осталось выбрать канал ---------- */
  if (botSetup) {
    return html`<div class="col">
      <div class="card col">
        <div class="row wrap"><h2 class="grow" style="margin:0">Бот подключён: выберите канал</h2><span class="chip ok">токен принят</span></div>
        <div class="row wrap" style="gap:12px;align-items:center"><${Ava} s=${s} d=${d} cls="dc-ava big" name=${d.profile?.name} />
          <div><b style="font-size:16px">${rawHtml`${d.profile?.name || 'бот'}`}</b><div class="muted mono" style="font-size:12.5px">токен ${d.bot.hint}</div></div></div>
        <${ChannelPicker} s=${s} d=${d} value=${f.bot} onChange=${v => setF({ ...f, bot: v })} />
        <${ProxyBox} s=${s} d=${d} value=${f.proxy} onChange=${v => setF({ ...f, proxy: v })} />
        <div class="row wrap" style="gap:10px">
          <${Btn} kind="primary" icon="rocket" disabled=${busy || !f.bot.channelId} onClick=${() => put(body({ on: true }), 'Готово, бот отправил табло в канал')}>${busy ? 'Запуск…' : 'Запустить бота'}</${Btn}>
          ${d.hook && html`<${Btn} kind="ghost" icon="back" disabled=${busy} onClick=${() => put({ kind: 'webhook', on: true }, 'Табло снова отправляется через вебхук')}>Вернуться к вебхуку</${Btn}>`}
          <span class="grow"></span>
          <${Btn} kind="danger ghost" icon="x" disabled=${busy} onClick=${drop}>Отключить</${Btn}></div>
      </div>
      <div class="card col"><h3 style="margin:0">Так это будет выглядеть</h3><${Preview} s=${s} d=${d} f=${f} address=${addr} /></div>
    </div>`;
  }

  /* ---------- работает ---------- */
  const bot = d.kind === 'bot';
  const state = d.error ? ['warn', 'Ошибка отправки'] : !d.on ? ['', 'Приостановлено'] : d.sentAt ? ['ok', 'Работает'] : ['', 'Ожидание первой отправки'];
  const gw = { online: ['ok', 'бот в сети'], connecting: ['', 'бот подключается…'], off: ['', 'бот не в сети'] }[d.bot.gateway] || ['', ''];
  return html`<div class="col">
    <div class="card col">
      <div class="row wrap"><h2 class="grow" style="margin:0">Табло сервера в Discord</h2>
        ${bot && d.on && d.bot.online && html`<span class=${'chip ' + gw[0]}>${gw[1]}</span>`}
        <span class=${'chip ' + state[0]}>${state[1]}</span></div>
      ${d.error && html`<div class="banner warn" style="margin:0">${d.error}</div>`}
      ${bot && d.bot.gatewayError && d.on && d.bot.online && html`<div class="banner warn" style="margin:0">${d.bot.gatewayError}. Сообщения отправляются, но бот не отображается в сети.</div>`}
      <div class="row wrap" style="gap:18px">
        ${bot ? html`<span class="muted">Бот: <b style="color:var(--text)">${rawHtml`${d.profile?.name || '…'}`}</b> · канал <span class="mono" style="color:var(--text)">${rawHtml`#${d.bot.channelName}`}</span></span>`
          : html`<span class="muted">Вебхук: <span class="mono" style="color:var(--text)">${d.hook}</span></span>`}
        <span class="muted">Последнее обновление: <b style="color:var(--text)">${d.sentAt ? ago(d.sentAt) : 'ещё не было'}</b></span>
      </div>
      <${KindSwitch} s=${s} d=${d} f=${f} run=${run} />
      <${Toggle} on=${f.on} onChange=${v => setF({ ...f, on: v })} label="Обновлять табло в канале" />
      ${bot && html`<${ChannelPicker} s=${s} d=${d} value=${f.bot} onChange=${v => setF({ ...f, bot: v })} />`}
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
        <${Btn} kind="primary" icon="save" disabled=${busy || !dirty || (bot && !f.bot.channelId)} onClick=${() => put(body(), 'Сохранено')}>Сохранить</${Btn}>
        <${Btn} icon="refresh" disabled=${busy || !d.on || dirty} onClick=${resend} title="Удалить старое сообщение и отправить табло заново, например, чтобы закрепить его">Отправить заново</${Btn}>
        <span class="grow"></span>
        <${Btn} kind="danger ghost" icon="x" disabled=${busy} onClick=${drop}>Отключить</${Btn}>
      </div>
    </div>
    <${LookCard} s=${s} d=${d} f=${f} address=${addr} setF=${setF} />
    <${ProfileCard} s=${s} d=${d} f=${f} address=${addr} set=${set} />
  </div>`;
}

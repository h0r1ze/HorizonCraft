import { html, useState, Icon, Btn, Toggle, toast, askConfirm, plural, t } from './ui.js';
import { api } from './api.js';
import { FmtText } from './mcfmt.js';

/* Группы игроков: ADMIN, MODERATOR, VIP, FLY, HORIZON. Права выдаёт LuckPerms, команды /fly и /tp даёт EssentialsX. */

/** Значок группы в стиле игры: цветная приписка на тёмной плашке. */
export const GroupBadge = ({ g }) => html`<span class="mc-box mini mcreal gbadge"><${FmtText} real src=${g.prefix} /></span>`;

/** Выбор группы в форме приписки: пять групп и «Без группы». */
export function GroupPicker({ gs, value, onPick }) {
  const cur = gs.groups.find(g => g.id === value);
  return html`<div class="col" style="gap:8px">
    <span style="font-weight:580;font-size:13px">Группа игрока</span>
    <div class="gpick">
      <button type="button" class=${'gp none ' + (!value ? 'on' : '')} onClick=${() => onPick('')}><span>Без группы</span></button>
      ${gs.groups.map(g => html`<button type="button" key=${g.id} class=${'gp ' + (value === g.id ? 'on' : '')} title=${g.title} onClick=${() => onPick(g.id)}>
        <${GroupBadge} g=${g} /></button>`)}
    </div>
    <small class="muted">${cur ? html`<b style="color:var(--text)">${cur.name}.</b> ${cur.title}: ${cur.can.map(c => t(c).toLowerCase()).join('; ')}.`
      : 'Группа задаёт права игрока и ставит цветную приписку. Без группы игрок получает обычные права (как HORIZON).'}</small>
  </div>`;
}

const Row = ({ ok, children }) => html`<li class=${ok ? 'yes' : 'no'}><${Icon} n=${ok ? 'check' : 'x'} size=${14} /><span>${children}</span></li>`;

/** Карточка в разделе «Игроки»: включение групп и описание прав каждой группы. */
export function GroupsCard({ s, gs, reload }) {
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState(false);
  if (!gs) return null;
  const up = s.state === 'running' || s.state === 'starting';
  const counts = {};
  for (const g of Object.values(gs.members || {})) counts[g] = (counts[g] || 0) + 1;

  const toPaper = async () => {
    if (!(await askConfirm('Перевести сервер на Paper? Мир, настройки и игроки сохранятся. Сервер нужно будет перезапустить, это займёт около минуты.'))) return;
    setBusy('paper');
    try { await api(`/servers/${s.id}`, { method: 'PATCH', body: { type: 'PAPER' } }); toast('Сервер переведён на Paper. Перезапустите его, чтобы изменение вступило в силу.'); await reload(); }
    catch (x) { toast(x.message, 'err'); }
    setBusy('');
  };
  const enable = async () => {
    setBusy('enable');
    try {
      const r = await api(`/servers/${s.id}/groups/install`, { method: 'POST' });
      toast(r.downloaded?.length ? 'Плагины LuckPerms и EssentialsX скачаны' : 'Группы включены');
      await reload();
    } catch (x) { toast(x.message, 'err'); }
    setBusy('');
  };
  const chat = async on => {
    setBusy('chat');
    try {
      const r = await api(`/servers/${s.id}/groups/chat`, { method: 'POST', body: { on } });
      toast(r.restart ? 'Плагины чата скачаны. Перезапустите сервер, чтобы включить чат без скобок.' : on ? 'Чат без скобок включён' : 'Стандартный чат возвращён');
      await reload();
    } catch (x) { toast(x.message, 'err'); }
    setBusy('');
  };
  const apply = async () => {
    setBusy('apply');
    try { await api(`/servers/${s.id}/groups/apply`, { method: 'POST' }); toast('Права групп применены'); await reload(); }
    catch (x) { toast(x.message, 'err'); }
    setBusy('');
  };

  const status = !gs.supported ? null
    : !gs.on ? ['', 'Выключено']
    : gs.active ? ['ok', 'Права работают']
    : up ? ['warn', 'Нужен перезапуск']
    : ['', 'Применится при запуске'];

  return html`<div class="card col" id="groups-card">
    <div class="row wrap"><h2 class="grow" style="margin:0">Группы игроков <span class="sub">ADMIN · MODERATOR · VIP · FLY · HORIZON</span></h2>
      ${status && html`<span class=${'chip ' + status[0]}>${status[1]}</span>`}
      <${Btn} kind="sm ghost" onClick=${() => setOpen(!open)}>${open ? 'Скрыть права' : 'Что разрешено'}</${Btn}></div>

    ${!gs.supported && html`<div class="banner info flex" style="margin:0"><span class="grow">Права на полёт и телепорт работают через плагины, поэтому группы доступны на <b>Paper</b> и <b>Purpur</b>.
        Сейчас сервер на ${gs.type === 'VANILLA' ? 'Vanilla' : gs.type}. Переход сохраняет мир и настройки.</span>
        <${Btn} kind="primary" icon="rocket" disabled=${!!busy || !!s.busy} onClick=${toPaper}>${busy === 'paper' ? 'Переключаем…' : 'Перейти на Paper'}</${Btn}></div>`}

    ${gs.supported && !gs.on && html`<div class="banner info flex" style="margin:0"><span class="grow">Панель скачает плагины <b>LuckPerms</b> (права) и <b>EssentialsX</b> (команды /fly и /tpa),
        создаст пять групп и будет выдавать их игрокам. После включения сервер нужно перезапустить.</span>
        <${Btn} kind="primary" icon="download" disabled=${!!busy} onClick=${enable}>${busy === 'enable' ? 'Скачиваем плагины…' : 'Включить группы'}</${Btn}></div>`}

    ${gs.on && gs.fixedAt > 0 && (!s.startedAt || Date.parse(s.startedAt) < gs.fixedAt) && html`<div class="banner warn" style="margin:0">Папка plugins была недоступна серверу, из-за этого плагины не запускались. Права исправлены, перезапустите сервер.</div>`}
    ${gs.on && up && !gs.active && html`<div class="banner warn" style="margin:0">Плагины скачаны, но ещё не загружены. Перезапустите сервер: после запуска права применятся сами.</div>`}
    ${gs.on && !up && html`<div class="banner info" style="margin:0">Сервер остановлен. Группы и права применятся автоматически при запуске.</div>`}

    <div class="gcards">${gs.groups.map(g => html`<div class="gcard" key=${g.id}>
      <div class="row" style="gap:10px"><${GroupBadge} g=${g} /><span class="grow"></span>
        ${counts[g.id] ? html`<span class="chip">${counts[g.id]} ${plural(counts[g.id], 'игрок', 'игрока', 'игроков')}</span>` : ''}</div>
      <b>${g.title}</b>
      ${open ? html`<ul class="gperm">${g.can.map(t => html`<${Row} ok=${true}>${t}</${Row}>`)}${g.cant.map(t => html`<${Row} ok=${false}>${t}</${Row}>`)}</ul>`
        : html`<small class="muted">${g.can[0]}</small>`}
    </div>`)}</div>

    ${gs.on && html`<div class="col" style="gap:6px"><${Toggle} on=${gs.chat?.on} onChange=${chat} label="Чат без скобок «< >»: [ADMIN] Ник: сообщение" />
      <small class="muted">Скобки входят в стандартный формат чата Minecraft. Панель ставит модуль чата EssentialsX и Vault и передаёт приписки игроков в чат. После включения нужен перезапуск сервера.</small>
      ${gs.chat?.on && gs.active && !gs.chat.loaded && html`<div class="banner warn" style="margin:0">Модуль чата ещё не подключился. Перезапустите сервер.</div>`}</div>`}
    ${gs.on && html`<div class="row wrap"><small class="muted grow">Игрок получает группу при выборе в форме ниже. Не назначенные игроки получают обычные права (как HORIZON).</small>
      <${Btn} kind="sm" icon="refresh" disabled=${!!busy || !gs.active} title=${gs.active ? '' : 'Доступно, когда сервер запущен и плагины загружены'} onClick=${apply}>${busy === 'apply' ? 'Применяем…' : 'Применить права заново'}</${Btn}></div>`}
  </div>`;
}

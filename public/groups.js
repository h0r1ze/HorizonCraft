import { html, useState, Icon, Btn, Toggle, Modal, Field, toast, askConfirm, plural, t } from './ui.js';
import { api } from './api.js';
import { FmtText, McEditor } from './mcfmt.js';

/* Группы игроков: ADMIN, MODERATOR, VIP, FLY, HORIZON. Права выдаёт LuckPerms, команды /fly и /tp даёт EssentialsX. */

/** Значок группы в стиле игры: цветная приписка на тёмной плашке. */
export const GroupBadge = ({ g }) => html`<span class="mc-box mini mcreal gbadge"><${FmtText} real src=${g.prefix || '&7' + g.name} /></span>`;

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

/** Окно редактирования группы: название, приписка, приоритет, описание и права по каталогу (плюс свои узлы). */
function GroupEditor({ s, gs, group, onClose, onDone }) {
  const isNew = !group;
  const [f, setF] = useState(() => ({ name: group?.name || '', prefix: group?.prefix ?? '&7&l[]', weight: group?.weight ?? 10, title: group?.title || '', perms: new Set(group?.perms || []) }));
  const [node, setNode] = useState('');
  const [busy, setBusy] = useState(false);
  const set = p => setF(x => ({ ...x, ...p }));
  const known = new Set(gs.catalog.flatMap(c => c.items.flatMap(i => i.nodes)));
  const custom = [...f.perms].filter(n => !known.has(n));
  const on = it => it.nodes.every(n => f.perms.has(n));
  const toggle = it => setF(x => { const p = new Set(x.perms); const all = it.nodes.every(n => p.has(n)); for (const n of it.nodes) all ? p.delete(n) : p.add(n); return { ...x, perms: p }; });
  const addNode = () => {
    const n = node.trim();
    if (!n) return;
    if (!/^[A-Za-z0-9_.*:-]{1,100}$/.test(n)) return toast('Право записывается без пробелов: буквы, цифры и знаки . _ - * :', 'err');
    setF(x => ({ ...x, perms: new Set([...x.perms, n]) })); setNode('');
  };
  const dropNode = n => setF(x => { const p = new Set(x.perms); p.delete(n); return { ...x, perms: p }; });
  const body = () => ({ name: f.name, prefix: f.prefix, weight: Number(f.weight), title: f.title, perms: [...f.perms] });
  const save = async () => {
    setBusy(true);
    try {
      const r = isNew ? await api(`/servers/${s.id}/groups/defs`, { method: 'POST', body: body() })
        : await api(`/servers/${s.id}/groups/defs/${group.id}`, { method: 'PUT', body: body() });
      toast(r.applied ? 'Группа сохранена и применена' : 'Группа сохранена. Права применятся при запуске сервера.');
      await onDone();
    } catch (x) { toast(x.message, 'err'); setBusy(false); }
  };
  const remove = async () => {
    const n = Object.values(gs.members || {}).filter(g => g === group.id).length;
    const note = group.id === 'horizon' ? ' Права группы HORIZON получают и игроки без группы: после удаления у них не будет особых прав.' : group.builtin ? ' Стандартную группу можно будет вернуть кнопкой в карточке групп.' : '';
    if (!(await askConfirm((n ? `Удалить группу ${group.name}? Игроки из неё (${n}) перейдут в обычные права.` : `Удалить группу ${group.name}?`) + note, { danger: true }))) return;
    setBusy(true);
    try { await api(`/servers/${s.id}/groups/defs/${group.id}`, { method: 'DELETE' }); toast('Группа удалена'); await onDone(); }
    catch (x) { toast(x.message, 'err'); setBusy(false); }
  };
  const reset = async () => {
    if (!(await askConfirm(`Вернуть группе ${group.name} исходные название, приписку и права?`))) return;
    setBusy(true);
    try { await api(`/servers/${s.id}/groups/defs/${group.id}/reset`, { method: 'POST' }); toast('Группа сброшена'); await onDone(); }
    catch (x) { toast(x.message, 'err'); setBusy(false); }
  };
  const all = f.perms.has('*');
  return html`<${Modal} title=${isNew ? 'Новая группа' : 'Группа ' + group.name} onClose=${onClose} wide
    footer=${html`${!isNew && group.builtin && group.edited && html`<${Btn} kind="ghost" icon="refresh" disabled=${busy} onClick=${reset}>Сбросить к исходной</${Btn}>`}
      ${!isNew && html`<${Btn} kind="ghost danger" icon="trash" disabled=${busy} onClick=${remove}>Удалить группу</${Btn}>`}
      <span class="grow"></span><${Btn} kind="ghost" onClick=${onClose}>Отмена</${Btn}>
      <${Btn} kind="primary" icon="save" disabled=${busy || !f.name.trim()} onClick=${save}>${busy ? 'Сохраняем…' : 'Сохранить'}</${Btn}>`}>
    <div class="gedit">
      <div class="col" style="gap:14px">
        <${Field} label="Название"><input value=${f.name} maxlength="24" placeholder="Например, Строитель" onInput=${e => set({ name: e.target.value })} /></${Field}>
        <${Field} label="Приоритет" hint="От 1 до 999. Если у игрока несколько групп, права старшей группы главнее."><input type="number" min="1" max="999" value=${f.weight} onInput=${e => set({ weight: e.target.value })} /></${Field}>
        <${Field} label="Описание"><input value=${f.title} maxlength="60" placeholder="Коротко, что умеет группа" onInput=${e => set({ title: e.target.value })} /></${Field}>
        <div class="col" style="gap:6px"><span style="font-weight:580;font-size:13px">Приписка группы</span>
          <${McEditor} value=${f.prefix} onChange=${v => set({ prefix: v })} max=${24} compact placeholder="&c&l[ADMIN]" /></div>
        <div class="gprev"><small class="muted">Так группа выглядит у игрока</small>
          <div class="mc-box mcreal"><${FmtText} real src=${(f.prefix || '&7' + (f.name || '…')) + ' &fНик'} /></div></div>
      </div>
      <div class="col" style="gap:14px">
        <div class="row"><b class="grow">Права группы</b><small class="muted">${f.perms.size} выбрано</small></div>
        ${all && html`<div class="banner warn" style="margin:0">Выбрано право «Все права»: группе разрешено всё, остальные галочки ничего не добавят.</div>`}
        ${gs.catalog.map(c => html`<div class="gcat" key=${c.cat}><h4>${c.cat}</h4>
          ${c.items.map(it => html`<label class=${'gchk ' + (on(it) ? 'on' : '')} key=${it.title}>
            <input type="checkbox" checked=${on(it)} onChange=${() => toggle(it)} /><span class="box"><${Icon} n="check" size=${13} /></span><span>${it.title}</span></label>`)}</div>`)}
        <div class="gcat"><h4>Другие права</h4>
          <small class="muted">Любое право плагина, например <code>worldedit.*</code> или <code>essentials.sethome.multiple.vip</code>.</small>
          ${custom.length > 0 && html`<div class="gnodes">${custom.map(n => html`<span class="gnode" key=${n}><code>${n}</code><button type="button" title="Убрать" onClick=${() => dropNode(n)}>×</button></span>`)}</div>`}
          <div class="row" style="gap:8px"><input class="grow mono" value=${node} placeholder="plugin.permission" onInput=${e => setNode(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); addNode(); } }} />
            <${Btn} kind="sm" icon="plus" onClick=${addNode}>Добавить</${Btn}></div></div>
      </div>
    </div>
  </${Modal}>`;
}

const Row = ({ children }) => html`<li class="yes"><${Icon} n="check" size=${14} /><span>${children}</span></li>`;

/** Карточка в разделе «Игроки»: включение групп и описание прав каждой группы. */
export function GroupsCard({ s, gs, reload }) {
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);   // null: окно закрыто, 'new': новая группа, иначе описание группы
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
  const restore = async () => {
    setBusy('restore');
    try { await api(`/servers/${s.id}/groups/restore`, { method: 'POST' }); toast('Стандартные группы возвращены'); await reload(); }
    catch (x) { toast(x.message, 'err'); }
    setBusy('');
  };
  const hideLog = async hide => {
    setBusy('log');
    try {
      const r = await api(`/servers/${s.id}/groups/log`, { method: 'POST', body: { hide } });
      toast(!r.applied ? 'Настройка сохранена. Применится после первого запуска сервера.' : hide ? 'Строки «[LP] ЛОГ» скрыты' : 'Строки «[LP] ЛОГ» снова показываются');
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
    <div class="row wrap"><h2 class="grow" style="margin:0">Группы игроков <span class="sub">${gs.groups.map(g => g.name).join(' · ')}</span></h2>
      ${status && html`<span class=${'chip ' + status[0]}>${status[1]}</span>`}
      <${Btn} kind="sm ghost" onClick=${() => setOpen(!open)}>${open ? 'Скрыть права' : 'Что разрешено'}</${Btn}>
      ${gs.on && gs.deleted.length > 0 && html`<${Btn} kind="sm ghost" icon="refresh" disabled=${!!busy} onClick=${restore}>Вернуть стандартные группы (${gs.deleted.length})</${Btn}>`}
      ${gs.on && html`<${Btn} kind="sm" icon="plus" disabled=${gs.groups.length >= gs.limits.groups} onClick=${() => setEditing('new')}>Новая группа</${Btn}>`}</div>

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
        ${counts[g.id] ? html`<span class="chip">${counts[g.id]} ${plural(counts[g.id], 'игрок', 'игрока', 'игроков')}</span>` : ''}
        ${gs.on && html`<${Btn} kind="ghost icon sm" icon="edit" title="Изменить группу" onClick=${() => setEditing(g)} />`}</div>
      <b>${g.title || g.name}</b>
      ${open ? html`<ul class="gperm">${g.can.map(t => html`<${Row}>${t}</${Row}>`)}</ul>`
        : html`<small class="muted">${g.can[0]}</small>`}
    </div>`)}</div>

    ${gs.on && html`<div class="col" style="gap:6px"><${Toggle} on=${gs.chat?.on} onChange=${chat} label="Чат без скобок «< >»: [ADMIN] Ник: сообщение" />
      <small class="muted">Скобки входят в стандартный формат чата Minecraft. Панель ставит модуль чата EssentialsX и Vault и передаёт приписки игроков в чат. После включения нужен перезапуск сервера.</small>
      ${gs.chat?.on && gs.active && !gs.chat.loaded && html`<div class="banner warn" style="margin:0">Модуль чата ещё не подключился. Перезапустите сервер.</div>`}</div>`}
    ${editing && html`<${GroupEditor} s=${s} gs=${gs} group=${editing === 'new' ? null : editing} onClose=${() => setEditing(null)} onDone=${async () => { setEditing(null); await reload(); }} />`}
    ${gs.on && html`<div class="col" style="gap:6px"><${Toggle} on=${gs.hideLog} onChange=${hideLog} label="Скрыть уведомления LuckPerms в игровом чате" />
      <small class="muted">Администраторы видят в чате строки с пометкой «[LP] ЛОГ» при каждой смене прав, в том числе когда группу меняет сама панель. Переключатель отключает их (параметр log-notify в настройках LuckPerms).</small></div>`}
    ${gs.on && html`<div class="row wrap"><small class="muted grow">Игрок получает группу при выборе в форме ниже. Не назначенные игроки получают обычные права (как HORIZON).</small>
      <${Btn} kind="sm" icon="refresh" disabled=${!!busy || !gs.active} title=${gs.active ? '' : 'Доступно, когда сервер запущен и плагины загружены'} onClick=${apply}>${busy === 'apply' ? 'Применяем…' : 'Применить права заново'}</${Btn}></div>`}
  </div>`;
}

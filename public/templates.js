import { html, useState, useEffect, Icon, Btn, Field, Modal, Toggle, toast, askConfirm, askText, fmtBytes, plural, TYPE_NAMES } from './ui.js';
import { api } from './api.js';

/* Шаблоны серверов: сохранённые настройки и (по желанию) папки mods, plugins, config. */

export function useTemplates() {
  const [list, setList] = useState(null);
  const load = async () => { try { setList(await api('/templates')); } catch { setList([]); } };
  useEffect(() => { load(); }, []);
  return [list, load];
}

export const tplLine = t => [
  TYPE_NAMES[t.type] + (t.type !== 'AUTO_CURSEFORGE' && t.version ? ' ' + t.version : ''),
  t.memory,
  t.hasFiles ? `файлы ${fmtBytes(t.filesSize)}` : 'только настройки',
  t.from !== 'Эта машина' ? 'с ноды «' + t.from + '»' : '',
].filter(Boolean).join(' · ');

export function SaveTemplateDialog({ s, onClose }) {
  const canFiles = s.type !== 'VANILLA';
  const [name, setName] = useState(s.name);
  const [desc, setDesc] = useState('');
  const [withFiles, setWithFiles] = useState(canFiles);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const t = await api('/templates', { method: 'POST', body: { serverId: s.id, name, desc, withFiles } });
      toast(`Шаблон «${t.name}» сохранён`);
      onClose();
    } catch (x) { toast(x.message, 'err'); }
    setBusy(false);
  };
  const footer = html`<${Btn} onClick=${onClose}>Отмена</${Btn}>
    <${Btn} kind="primary" icon="save" disabled=${busy || !name.trim()} onClick=${save}>${busy ? 'Сохраняю…' : 'Сохранить шаблон'}</${Btn}>`;
  return html`<${Modal} title="Сохранить как шаблон" onClose=${onClose} footer=${footer}>
    <div class="col" style="gap:16px">
      <${Field} label="Название шаблона"><input value=${name} maxlength="40" onInput=${e => setName(e.target.value)} /></${Field}>
      <${Field} label="Описание (необязательно)"><input value=${desc} maxlength="200" placeholder="Например, выживание с плагинами защиты" onInput=${e => setDesc(e.target.value)} /></${Field}>
      <${Toggle} on=${withFiles} onChange=${setWithFiles} label="Сохранить также папки mods, plugins и config" />
      <small class="muted">В шаблон попадают тип и версия сервера, память, параметры server.properties, список модов Modrinth и CurseForge, расписание${withFiles ? ' и файлы из mods, plugins, config' : ''}. Мир, список игроков и домен не сохраняются.</small>
    </div>
  </${Modal}>`;
}

/** Раздел «Шаблоны» на странице настроек. */
export function TemplatesSettings() {
  const [list, load] = useTemplates();
  const rename = async t => {
    const r = await askText('Переименовать шаблон', { label: 'Название', value: t.name, required: true, ok: 'Сохранить' });
    if (!r) return;
    try { await api('/templates/' + t.id, { method: 'PUT', body: { name: r.value } }); load(); }
    catch (x) { toast(x.message, 'err'); }
  };
  const del = async t => {
    if (!(await askConfirm(`Удалить шаблон «${t.name}»? Уже созданные из него серверы не изменятся.`))) return;
    try { await api('/templates/' + t.id, { method: 'DELETE' }); load(); }
    catch (x) { toast(x.message, 'err'); }
  };
  return html`<div class="card col">
    <div class="row wrap"><h2 class="grow" style="margin:0">Шаблоны серверов</h2></div>
    <p class="muted" style="margin:0">Сохраните настроенный сервер как шаблон на его странице (меню «⋯» → «Сохранить как шаблон»), и новые серверы можно будет создавать по нему в один клик, в том числе на нодах.</p>
    ${list && !list.length && html`<div class="banner info" style="margin:0">Шаблонов пока нет.</div>`}
    ${(list || []).map(t => html`<div class="tplrow" key=${t.id}>
      <${Icon} n="layers" size=${20} />
      <div style="flex:1 1 240px;min-width:0"><div style="font-weight:650">${t.name}</div>
        <div class="muted" style="font-size:12.5px">${tplLine(t)}</div>
        ${t.desc && html`<div class="muted" style="font-size:12.5px">${t.desc}</div>`}</div>
      <div class="row wrap" style="gap:8px">
        <${Btn} kind="sm primary" icon="plus" onClick=${() => (location.hash = '#/new?tpl=' + t.id)}>Создать сервер</${Btn}>
        <${Btn} kind="sm" icon="sliders" onClick=${() => rename(t)}>Переименовать</${Btn}>
        <${Btn} kind="sm danger" icon="trash" onClick=${() => del(t)}>Удалить</${Btn}>
      </div></div>`)}
  </div>`;
}

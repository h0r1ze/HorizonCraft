import { html, rawHtml, useState, Icon, Btn, toast, askConfirm, fmtBytes } from './ui.js';
import { api } from './api.js';

const GROUPS = [
  ['server', 'Файлы удалённых серверов', 'folder'],
  ['backups', 'Резервные копии удалённых серверов', 'archive'],
  ['container', 'Контейнеры удалённых серверов', 'cube'],
  ['image', 'Ненужные образы Minecraft', 'disk'],
  ['crash', 'Отчёты о падениях Java', 'bolt'],
  ['import', 'Незавершённые загрузки и переносы', 'upload'],
  ['template', 'Файлы удалённых шаблонов', 'copy'],
  ['cover', 'Обложки и значки удалённых серверов', 'palette'],
  ['update', 'Остатки обновлений панели', 'refresh'],
];

/** Карточка «Очистка диска»: находит, что осталось от удалённых серверов и что накопилось, и удаляет выбранное. */
export function CleanupCard() {
  const [items, setItems] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [busy, setBusy] = useState('');
  const scan = async () => {
    setBusy('scan');
    try { const x = await api('/cleanup'); setItems(x); setSel(new Set(x.map(i => i.key))); }
    catch (e) { toast(e.message, 'err'); }
    setBusy('');
  };
  const total = (items || []).filter(i => sel.has(i.key)).reduce((a, i) => a + i.bytes, 0);
  const toggle = keys => setSel(s => { const n = new Set(s), on = keys.every(k => n.has(k)); keys.forEach(k => (on ? n.delete(k) : n.add(k))); return n; });
  const run = async () => {
    const n = sel.size;
    if (!(await askConfirm(`Удалить выбранное безвозвратно?\n\nЭлементов: ${n}${total ? ', освободится около ' + fmtBytes(total) : ''}. Серверы из списка панели не затрагиваются.`))) return;
    setBusy('clean');
    try {
      const r = await api('/cleanup', { method: 'POST', body: { keys: [...sel] } });
      setItems(r.items); setSel(new Set(r.items.map(i => i.key)));
      toast(r.failed.length ? 'Удалено не всё: ' + r.failed.join('; ') : `Готово, освобождено ${fmtBytes(r.freed)}`, r.failed.length ? 'err' : 'ok');
    } catch (e) { toast(e.message, 'err'); }
    setBusy('');
  };
  return html`<div class="card col" id="cleanup-card">
    <div class="row wrap"><h2 class="grow" style="margin:0">Очистка диска</h2>
      <${Btn} icon="search" disabled=${!!busy} onClick=${scan}>${busy === 'scan' ? 'Поиск…' : items ? 'Искать снова' : 'Найти лишнее'}</${Btn}></div>
    <p class="muted" style="margin:0">Находит то, что осталось от удалённых серверов (мир, резервные копии, контейнеры), образы с ненужной версией Java,
      отчёты о падениях и брошенные загрузки. Перед удалением список можно просмотреть. Серверы, которые есть в панели, не затрагиваются.</p>
    ${items && !items.length && html`<div class="banner info" style="margin:0">Лишнего не найдено.</div>`}
    ${items && items.length > 0 && html`<div class="col" style="gap:12px">
      ${GROUPS.map(([kind, name, icon]) => {
        const list = items.filter(i => i.kind === kind);
        if (!list.length) return null;
        const keys = list.map(i => i.key), all = keys.every(k => sel.has(k));
        const sum = list.reduce((a, i) => a + i.bytes, 0);
        return html`<div class="cgroup" key=${kind}>
          <label class="cghead"><input type="checkbox" checked=${all} onChange=${() => toggle(keys)} />
            <${Icon} n=${icon} size=${16} /><b class="grow">${name}</b><span class="muted">${sum ? fmtBytes(sum) : ''}</span></label>
          ${list.map(i => html`<label class="citem" key=${i.key}><input type="checkbox" checked=${sel.has(i.key)} onChange=${() => toggle([i.key])} />
            <span class="grow" style="min-width:0"><span class="trunc" style="display:block">${rawHtml`${i.title}`}</span><small class="muted trunc" style="display:block">${rawHtml`${i.detail}`}</small></span>
            <span class="muted mono" style="font-size:12.5px">${i.bytes ? fmtBytes(i.bytes) : ''}</span></label>`)}
        </div>`;
      })}
      <div class="row wrap"><${Btn} kind="danger" icon="trash" disabled=${!!busy || !sel.size} onClick=${run}>${busy === 'clean' ? 'Удаление…' : `Удалить выбранное${total ? ' · ' + fmtBytes(total) : ''}`}</${Btn}></div>
    </div>`}
  </div>`;
}

import { html, useState, useEffect, Icon, Btn, Modal, Toggle, toast, fmtBytes } from './ui.js';
import { api } from './api.js';

/* Очистка измерений: «Очистить Мир», «Очистить Незер», «Очистить Край». Удаляются только данные чанков выбранного
   измерения, при следующем запуске сервер создаст его заново. Перед очисткой по умолчанию делается резервная копия. */

const BTN = { overworld: 'Очистить Мир', nether: 'Очистить Незер', end: 'Очистить Край' };
const WHAT = {
  overworld: 'Постройки и рельеф Верхнего мира будут удалены, сервер создаст его заново.',
  nether: 'Постройки и рельеф Незера будут удалены, сервер создаст его заново.',
  end: 'Рельеф Края будет удалён, сервер создаст его заново (дракон появится снова).',
};

function ClearDialog({ s, dim, onClose, onDone }) {
  const [backup, setBackup] = useState(true);
  const [seed, setSeed] = useState(false);
  const [busy, setBusy] = useState(false);
  const up = s.state === 'running' || s.state === 'starting';
  const go = async () => {
    setBusy(true);
    try {
      await api(`/servers/${s.id}/worlds/clear`, { method: 'POST', body: { dim: dim.id, backup, newSeed: dim.id === 'overworld' && seed } });
      toast(`${BTN[dim.id]}: запущено`);
      onDone();
    } catch (x) { toast(x.message, 'err'); setBusy(false); }
  };
  return html`<${Modal} narrow title=${BTN[dim.id]} onClose=${onClose}
    footer=${html`<${Btn} onClick=${onClose}>Отмена</${Btn}>
      <${Btn} kind="danger" icon="trash" disabled=${busy} onClick=${go}>${busy ? 'Запускаем…' : BTN[dim.id]}</${Btn}>`}>
    <div class="col" style="gap:14px">
      <div class="banner warn" style="margin:0">${WHAT[dim.id]} Это нельзя отменить${backup ? ', но резервная копия останется' : ''}.</div>
      <div class="muted">Будет удалено: <b style="color:var(--text)">${fmtBytes(dim.bytes)}</b>. Инвентари, достижения, настройки и остальные измерения не затрагиваются.</div>
      ${up && html`<div class="banner info" style="margin:0">Сервер сейчас работает: он будет остановлен, а после очистки запущен снова автоматически.</div>`}
      <${Toggle} on=${backup} onChange=${setBackup} label="Сделать резервную копию перед очисткой (рекомендуется)" />
      ${dim.id === 'overworld' && html`<div class="col" style="gap:4px"><${Toggle} on=${seed} onChange=${setSeed} label="Новый мир с новым сидом (сбросит level.dat)" />
        <small class="muted">Без этого мир создастся заново с прежним сидом. С новым сидом также сбросятся время, погода и правила игры.</small></div>`}
    </div>
  </${Modal}>`;
}

/** Три кнопки очистки для блока «Быстрые действия». */
export function WorldButtons({ s }) {
  const [w, setW] = useState(null);
  const [dlg, setDlg] = useState(null);
  const load = async () => { try { setW(await api(`/servers/${s.id}/worlds`)); } catch { setW(null); } };
  useEffect(() => { load(); }, [s.id, !!s.busy]);
  if (!w) return null;
  return html`<div class="col" style="gap:8px"><h3 style="margin:0">Миры <span class="faint" style="font-weight:500">${w.level}</span></h3>
    <div class="row wrap">${w.dims.map(d => html`<${Btn} key=${d.id} kind="danger" icon="trash" disabled=${!!s.busy || !d.exists}
      title=${d.exists ? fmtBytes(d.bytes) : 'Это измерение ещё не создано'} onClick=${() => setDlg(d)}>${BTN[d.id]}</${Btn}>`)}</div>
    ${w.last && html`<small class="muted">Последняя очистка: ${BTN[w.last.dim].replace('Очистить ', '')}${w.last.backup ? ', копия ' + w.last.backup : ', без копии'}.</small>`}
    ${dlg && html`<${ClearDialog} s=${s} dim=${dlg} onClose=${() => setDlg(null)} onDone=${() => { setDlg(null); setTimeout(load, 1500); }} />`}
  </div>`;
}

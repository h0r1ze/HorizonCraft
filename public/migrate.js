import { html, useState, useEffect, Btn, Field, Modal, Toggle, toast, fmtBytes } from './ui.js';
import { api } from './api.js';

/* Перенос сервера на другую машину (на эту или на любую подключённую ноду). */

export function MigrateDialog({ s, nodes, onClose, onStarted }) {
  const cur = s.node?.id || 'local';
  const targets = [{ id: 'local', name: 'Эта машина', online: true }, ...nodes].filter(t => t.id !== cur);
  const [to, setTo] = useState(targets.find(t => t.online)?.id || '');
  const [del, setDel] = useState(false);
  const [start, setStart] = useState(true);
  const [busy, setBusy] = useState(false);
  const up = s.state === 'running' || s.state === 'starting';
  const go = async () => {
    setBusy(true);
    try {
      await api('/migrations', { method: 'POST', body: { serverId: s.id, to, deleteSource: del, start } });
      toast('Перенос запущен');
      onStarted();
    } catch (x) { toast(x.message, 'err'); }
    setBusy(false);
  };
  const footer = html`<${Btn} onClick=${onClose}>Отмена</${Btn}>
    <${Btn} kind="primary" icon="swap" disabled=${busy || !to} onClick=${go}>${busy ? 'Запускаю…' : 'Перенести'}</${Btn}>`;
  return html`<${Modal} title=${'Перенос «' + s.name + '»'} onClose=${onClose} footer=${footer}>
    <div class="col" style="gap:16px">
      <div class="banner info" style="margin:0">Мир, моды, плагины, настройки, расписание и обложка копируются на выбранную машину. ${up ? 'Сервер будет остановлен на время переноса.' : ''}
        <div style="margin-top:6px">Пока перенос не завершится успешно, исходный сервер остаётся нетронутым.</div></div>
      <${Field} label="Куда перенести">
        <select value=${to} onChange=${e => setTo(e.target.value)}>
          ${targets.map(t => html`<option key=${t.id} value=${t.id} disabled=${!t.online}>${t.name}${t.online ? '' : ' (недоступна)'}</option>`)}
        </select></${Field}>
      ${up && html`<${Toggle} on=${start} onChange=${setStart} label="Запустить сервер на новой машине после переноса" />`}
      <${Toggle} on=${del} onChange=${setDel} label="Удалить сервер с этой машины после успешного переноса" />
      <small class="muted">Порт сервера на новой машине сохраняется, если он свободен. Домен нужно привязать заново: он настраивается на каждой машине отдельно. Для Minecraft-портов нового места не забудьте проброс на роутере.</small>
    </div>
  </${Modal}>`;
}

const STAGES = ['prepare', 'stop', 'transfer', 'finish', 'cleanup'];

/** Показывает ход переноса и его итог на странице сервера. */
export function MigrationCard({ s }) {
  const [job, setJob] = useState(null);
  const [hidden, setHidden] = useState('');
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const list = await api('/migrations?server=' + s.id);
        if (!alive) return;
        const j = list[0] || null;
        setJob(prev => {
          if (j && j.done && j.newId && (!prev || !prev.done) && prev) { // только что завершился при открытой странице
            toast(`Сервер перенесён: ${j.to}`);
            if (j.deleteSource) location.hash = '#/s/' + j.newId;
          }
          return j;
        });
      } catch {}
    };
    load();
    const t = setInterval(load, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [s.id]);
  if (!job || hidden === job.id) return null;
  const running = !job.finishedAt;
  const idx = STAGES.indexOf(job.stage);
  if (running) {
    return html`<div class="card col" style="margin-bottom:16px">
      <div class="row"><h2 class="grow" style="margin:0">Перенос: ${job.from} → ${job.to}</h2><span class="chip warn">${job.text}</span></div>
      <div class="bar ind"><i></i></div>
      <div class="muted" style="font-size:13px">Шаг ${Math.max(1, idx + 1)} из ${STAGES.length}${job.bytes ? ` · передано ${fmtBytes(job.bytes)}` : ''}. Не закрывайте панель на сервере и не выключайте машины.</div>
    </div>`;
  }
  if (job.error) {
    return html`<div class="banner err flex" style="align-items:flex-start"><div class="grow"><b>Перенос не удался:</b> ${job.error}<div style="margin-top:4px">${job.note}</div></div>
      <${Btn} kind="sm" onClick=${() => setHidden(job.id)}>Скрыть</${Btn}></div>`;
  }
  if (Date.now() - job.finishedAt > 30 * 60e3) return null;
  return html`<div class="banner info flex" style="align-items:flex-start"><div class="grow"><b>Сервер перенесён: ${job.to}.</b> ${job.note}</div>
    <a class="btn sm primary" href=${'#/s/' + job.newId}>Открыть новый сервер</a>
    <${Btn} kind="sm" onClick=${() => setHidden(job.id)}>Скрыть</${Btn}></div>`;
}

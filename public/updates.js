import { html, useState, useEffect, useRef, Icon, Btn, Field, Toggle, toast, askConfirm, fmtBytes, ago, plural } from './ui.js';
import { api } from './api.js';

/* Обновления: новая версия Minecraft и свежие версии плагинов/модов (определяются по хэшу в Modrinth). */

const CHANNEL = { beta: 'бета', alpha: 'альфа' };

export function UpdatesTab({ s, reload, act }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState({});
  const [backup, setBackup] = useState(true);
  const [target, setTarget] = useState('');
  const [openLog, setOpenLog] = useState('');
  const up = s.state === 'running' || s.state === 'starting';

  const load = async force => {
    setLoading(true);
    try {
      const x = await api(`/servers/${s.id}/updates${force ? '?refresh=1' : ''}`);
      setD(x); setErr('');
      setSel(prev => Object.fromEntries(x.mods.filter(m => m.status === 'update').map(m => [m.file, m.file in prev ? prev[m.file] : !m.latest.channel || m.latest.channel === 'release'])));
      setTarget(t => (x.core.newer?.includes(t) ? t : x.core.latest || ''));
    } catch (e) { setErr(e.message); }
    setLoading(false);
  };
  useEffect(() => { load(false); }, [s.id]);
  const was = useRef(false);
  useEffect(() => { // когда установка закончилась, обновляем таблицу
    if (was.current && !s.busy) { load(false); reload(); }
    was.current = !!s.busy;
  }, [s.busy]);

  if (err && !d) return html`<div class="banner err">${err}</div>`;
  if (!d) return html`<div class="skeleton" style="height:240px"></div>`;

  const core = d.core;
  const updates = d.mods.filter(m => m.status === 'update');
  const chosen = updates.filter(m => sel[m.file]).map(m => m.file);
  const unknown = d.mods.filter(m => m.status === 'unknown');
  const okMods = d.mods.filter(m => m.status === 'ok');
  const recent = d.lastApply && Date.now() - d.lastApply.at < 15 * 60e3 ? d.lastApply.results : null;

  const applyMods = async () => {
    try {
      await api(`/servers/${s.id}/updates/apply`, { method: 'POST', body: { files: chosen, backup } });
      toast('Обновление запущено'); reload();
    } catch (x) { toast(x.message, 'err'); }
  };
  const applyCore = async () => {
    if (!(await askConfirm(`Сменить версию Minecraft с ${core.current} на ${target}?\n\nПеред этим ${backup ? 'создастся резервная копия' : 'копия НЕ создаётся'}. Мир, обновлённый в новой версии, нельзя будет открыть в старой: вернуться можно только из копии. Проверьте, что плагины и моды поддерживают ${target}.`))) return;
    try {
      await api(`/servers/${s.id}/updates/core`, { method: 'POST', body: { version: target, backup } });
      toast('Версия меняется…'); reload();
    } catch (x) { toast(x.message, 'err'); }
  };

  return html`<div class="col">
    <div class="row wrap">
      <div class="grow muted">Проверено ${ago(d.checkedAt)}. Версия Minecraft на сервере: <b style="color:var(--text)">${d.mc || '—'}</b></div>
      <${Btn} icon="refresh" disabled=${loading || !!s.busy} onClick=${() => load(true)}>${loading ? 'Проверяю…' : 'Проверить снова'}</${Btn}>
    </div>
    ${err && html`<div class="banner err" style="margin:0">${err}</div>`}
    ${recent && html`<div class=${'banner ' + (recent.every(r => r.ok) ? 'info' : 'warn')} style="margin:0">
      <b>Результат последней установки:</b>
      ${recent.map(r => html`<div key=${r.file}>${r.ok ? '✔' : '✘'} ${r.file}${r.ok && r.to !== r.file ? ' → ' + r.to : ''}${r.error ? ': ' + r.error : ''}</div>`)}
      ${recent.some(r => r.ok) && up && html`<div class="row" style="margin-top:8px"><span class="grow">Новые файлы подхватятся после перезапуска сервера.</span>
        <${Btn} kind="sm" icon="restart" disabled=${!!s.busy} onClick=${() => act('restart')}>Перезапустить сейчас</${Btn}></div>`}
    </div>`}

    <div class="card col">
      <h2>Ядро сервера</h2>
      ${core.kind === 'pack' && html`<div class="muted">${core.note}</div>`}
      ${core.kind === 'newer' && html`<div class="col" style="gap:12px">
        <div class="banner warn" style="margin:0">Доступна новая версия Minecraft: <b>${core.latest}</b>. На сервере ${core.current}, это позади на ${core.behind} ${plural(core.behind, 'версию', 'версии', 'версий')}.</div>
        ${core.compat && html`<div class="muted">Под ${core.compat.target} уже есть версии для <b style="color:var(--text)">${core.compat.ok} из ${core.compat.total}</b> ваших ${d.dir === 'plugins' ? 'плагинов' : 'модов'}${core.compat.ok < core.compat.total ? '. Остальные могут не заработать, прежде чем обновляться, проверьте их.' : '.'}</div>`}
        <div class="row wrap" style="gap:12px">
          <select style="max-width:180px" value=${target} onChange=${e => setTarget(e.target.value)}>${core.newer.map(v => html`<option key=${v} value=${v}>${v}</option>`)}</select>
          <${Btn} kind="primary" icon="arrowup" disabled=${up || !!s.busy || !target} title=${up ? 'Сначала остановите сервер' : ''} onClick=${applyCore}>Обновить до ${target}</${Btn}>
          ${up && html`<span class="muted" style="font-size:13px">Для смены версии сервер должен быть остановлен.</span>`}
        </div>
      </div>`}
      ${(core.kind === 'auto' || core.kind === 'current') && html`<div class="row wrap" style="gap:12px">
        <span class=${'chip ' + (core.kind === 'current' ? 'ok' : '')}>${core.kind === 'current' ? 'Актуальная версия' : 'Версия «последняя»'}</span>
        <span class="grow muted">${core.note}</span>
        ${core.kind === 'auto' && up && html`<${Btn} kind="sm" icon="restart" disabled=${!!s.busy} onClick=${() => act('restart')}>Перезапустить</${Btn}>`}
      </div>`}
    </div>

    <div class="card col pad0">
      <div class="row wrap" style="padding:16px 16px 4px"><h2 class="grow" style="margin:0">${d.dir === 'plugins' ? 'Плагины' : 'Моды'}
        ${d.supportsMods ? html`<span class="sub">${d.mods.length}</span>` : ''}</h2>
        ${updates.length > 0 && html`<span class="chip warn"><${Icon} n="arrowup" size=${12} />обновлений: ${updates.length}</span>`}</div>
      ${!d.supportsMods && html`<div class="muted" style="padding:0 16px 16px">Для этого типа сервера нет плагинов и модов, которые можно обновлять отсюда.</div>`}
      ${d.supportsMods && !d.mods.length && html`<div class="muted" style="padding:0 16px 16px">В папке ${d.dir}/ нет файлов .jar. Плагины и моды, которые ставятся автоматически через Modrinth или CurseForge (вкладка «Моды»), скачиваются заново при каждом запуске сервера и всегда свежие.</div>`}
      ${updates.map(m => html`<div class="upd" key=${m.file}>
        <input type="checkbox" checked=${!!sel[m.file]} onChange=${e => setSel(x => ({ ...x, [m.file]: e.target.checked }))} />
        <div style="min-width:0"><div class="nm">${m.name} ${m.latest.channel && m.latest.channel !== 'release' && html`<span class="chip warn">${CHANNEL[m.latest.channel] || m.latest.channel}</span>`}</div>
          <div class="ver">${m.current} → <b style="color:var(--text)">${m.latest.version}</b> · ${fmtBytes(m.latest.size)} · <span class="mono">${m.file}</span></div></div>
        ${m.latest.changelog ? html`<${Btn} kind="sm ghost" onClick=${() => setOpenLog(openLog === m.file ? '' : m.file)}>${openLog === m.file ? 'Скрыть' : 'Что нового'}</${Btn}>` : html`<span></span>`}
        ${openLog === m.file && html`<div class="chg">${m.latest.changelog}</div>`}
      </div>`)}
      ${updates.length > 0 && html`<div class="row wrap" style="padding:14px 16px;border-top:1px solid var(--line);gap:12px">
        <${Toggle} on=${backup} onChange=${setBackup} label="Резервная копия перед обновлением" />
        <span class="grow"></span>
        <${Btn} kind="sm" onClick=${() => setSel(Object.fromEntries(updates.map(m => [m.file, chosen.length < updates.length])))}>${chosen.length < updates.length ? 'Выбрать все' : 'Снять выбор'}</${Btn}>
        <${Btn} kind="primary" icon="arrowup" disabled=${!chosen.length || !!s.busy} onClick=${applyMods}>${s.busy && s.busy.includes('мод') ? 'Обновляю…' : `Обновить выбранные (${chosen.length})`}</${Btn}>
      </div>`}
      ${d.supportsMods && d.mods.length > 0 && !updates.length && html`<div style="padding:0 16px 14px"><span class="chip ok"><${Icon} n="check" size=${12} />Всё актуально</span></div>`}
      ${okMods.length > 0 && html`<details style="padding:8px 16px 12px;border-top:1px solid var(--line)"><summary class="muted" style="cursor:pointer">Актуальные (${okMods.length})</summary>
        <div class="list" style="margin-top:10px">${okMods.map(m => html`<span class="pill" key=${m.file} title=${m.file}><span>${m.name}</span><span class="faint" style="font-size:12px;padding-right:6px">${m.current}</span></span>`)}</div></details>`}
      ${unknown.length > 0 && html`<details style="padding:8px 16px 14px;border-top:1px solid var(--line)"><summary class="muted" style="cursor:pointer">Не найдены на Modrinth (${unknown.length})</summary>
        <div class="muted" style="font-size:13px;margin:8px 0">Эти файлы либо скачаны не с Modrinth, либо сделаны вручную. Проверить их на обновления нельзя, обновляйте сами.</div>
        <div class="list">${unknown.map(m => html`<span class="pill" key=${m.file}><span>${m.file}</span><span style="padding-right:6px"></span></span>`)}</div></details>`}
    </div>
    <small class="muted">Версии файлов сверяются по хэшу с каталогом Modrinth. Скачанный файл проверяется по контрольной сумме, старый заменяется новым. Обновления применяются при следующем запуске сервера.</small>
  </div>`;
}

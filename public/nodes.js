import { html, useState, useEffect, Icon, Btn, Field, Modal, Meter, toast, askConfirm, fmtBytes, copyText, plural } from './ui.js';
import { api } from './api.js';

/* Ноды: другие машины с HorizonCraft в режиме агента. Серверы на них создаются и управляются отсюда. */

const INSTALL_CMD = 'curl -fsSL https://raw.githubusercontent.com/h0r1ze/HorizonCraft/main/install.sh | bash -s -- --agent';

export function useNodes(poll = 0) {
  const [nodes, setNodes] = useState(null);
  const load = async () => { try { setNodes(await api('/nodes')); } catch {} };
  useEffect(() => {
    load();
    if (!poll) return;
    const t = setInterval(load, poll);
    return () => clearInterval(t);
  }, []);
  return [nodes, load];
}

/** Нагрузка нод на странице «Обзор». Если нод нет, ничего не показывает. */
export function NodesStrip() {
  const [nodes] = useNodes(6000);
  if (!nodes || !nodes.length) return null;
  return html`<div>
    <div class="row" style="margin:6px 0 14px"><h2 class="grow">Ноды</h2>
      <a href="#/settings/servers" class="muted" style="font-size:13px">Управление</a></div>
    <div class="tiles" style="grid-template-columns:repeat(auto-fill,minmax(min(270px,100%),1fr))">${nodes.map(n => {
      const h = n.hostInfo;
      return html`<div class="tile" key=${n.id}>
        <div class="l"><${Icon} n="server" size=${14} /><span class="trunc">${n.name}</span></div>
        ${n.online && h ? html`
          <div class="n">${h.cpu}<small>% CPU</small></div>
          <div class="s">${fmtBytes(h.memUsed)} / ${fmtBytes(h.memTotal)} · ${n.servers ?? 0} ${plural(n.servers ?? 0, 'сервер', 'сервера', 'серверов')}</div>
          <div style="margin-top:10px"><${Meter} pct=${(h.memUsed / h.memTotal) * 100} /></div>`
        : html`
          <div class="n" style="font-size:20px;color:var(--danger)">Недоступна</div>
          <div class="s trunc" title=${n.error || ''}>${n.error || 'Нет связи с нодой'}</div>`}
      </div>`;
    })}</div>
  </div>`;
}

function NodeForm({ node, onClose, onSaved }) {
  const [f, setF] = useState({ name: node?.name || '', url: node?.url || '', token: '', publicHost: node?.publicHost || '' });
  const [pin, setPin] = useState(node?.fingerprint || '');
  const [busy, setBusy] = useState(false);
  const set = o => setF(x => ({ ...x, ...o }));
  const save = async () => {
    setBusy(true);
    try {
      let fingerprint = pin;
      if (/^https:/i.test(f.url.trim())) {
        // самоподписанный сертификат ноды: показываем отпечаток и просим подтвердить
        const pr = await api('/nodes/probe', { method: 'POST', body: { url: f.url } });
        if (pr.error) throw new Error(pr.error);
        if (pr.trusted) fingerprint = '';
        else if (pr.fingerprint !== pin) {
          const okk = await askConfirm(`Нода отдаёт сертификат, который не подтверждён центром сертификации${pr.subject ? ' (' + pr.subject + ')' : ''}. Если вы только что включили HTTPS на ноде, это нормально. Сверьте отпечаток SHA-256 с тем, что показан в настройках ноды, и подтвердите:\n\n${pr.fingerprint}`, { ok: 'Доверять' });
          if (!okk) { setBusy(false); return; }
          fingerprint = pr.fingerprint;
        }
      } else fingerprint = '';
      const body = { name: f.name, url: f.url, publicHost: f.publicHost, fingerprint, ...(f.token ? { token: f.token } : {}) };
      if (node) await api('/nodes/' + node.id, { method: 'PUT', body });
      else await api('/nodes', { method: 'POST', body });
      setPin(fingerprint);
      toast(node ? 'Нода сохранена' : 'Нода подключена');
      onSaved();
    } catch (x) { toast(x.message, 'err'); }
    setBusy(false);
  };
  const ready = f.name.trim() && f.url.trim() && (node || f.token.trim());
  const footer = html`<${Btn} onClick=${onClose}>Отмена</${Btn}>
    <${Btn} kind="primary" disabled=${busy || !ready} onClick=${save}>${busy ? 'Проверяю связь…' : node ? 'Сохранить' : 'Подключить'}</${Btn}>`;
  return html`<${Modal} title=${node ? 'Нода «' + node.name + '»' : 'Подключить ноду'} onClose=${onClose} footer=${footer}>
    <div class="col" style="gap:16px">
      ${!node && html`<details open>
        <summary style="cursor:pointer;font-weight:600">Как подготовить машину</summary>
        <ol style="margin:10px 0 0;padding-left:20px;line-height:1.7">
          <li>На другой машине (Linux, нужен только Docker) выполните команду, нажмите на неё, чтобы скопировать:
            <div class="code cmd" style="margin-top:6px;white-space:pre-wrap;word-break:break-all" title="Скопировать" onClick=${() => copyText(INSTALL_CMD)}>${INSTALL_CMD}</div></li>
          <li>Скрипт покажет <b>адрес</b> и <b>токен</b> ноды. Вставьте их в поля ниже.</li>
          <li>Порт ноды должен быть доступен с этой машины. Токен даёт полный доступ к Docker на ноде, поэтому не открывайте порт в интернет без VPN или HTTPS.</li>
        </ol></details>`}
      <${Field} label="Название" hint="Так нода будет называться в панели, например «Дом» или «VPS в Германии»">
        <input value=${f.name} maxlength="40" onInput=${e => set({ name: e.target.value })} /></${Field}>
      <${Field} label="Адрес ноды" hint="Адрес и порт панели на ноде, например https://192.168.1.20:8443 или https://node.example.com. Если нода работает по HTTPS с самоподписанным сертификатом, при сохранении панель попросит подтвердить его отпечаток.">
        <input class="mono" placeholder="https://192.168.1.20:8443" value=${f.url} onInput=${e => set({ url: e.target.value })} /></${Field}>
      <${Field} label=${node ? 'Токен (оставьте пустым, чтобы не менять)' : 'Токен'} hint="AGENT_TOKEN из файла .env на ноде">
        <input class="mono" type="password" autocomplete="off" value=${f.token} onInput=${e => set({ token: e.target.value })} /></${Field}>
      <${Field} label="Адрес для игроков (необязательно)" hint="Домен или внешний IP ноды, который увидят игроки. Если пусто, берётся адрес из поля выше.">
        <input placeholder="например, mc.example.com" value=${f.publicHost} onInput=${e => set({ publicHost: e.target.value })} /></${Field}>
    </div>
  </${Modal}>`;
}

/** Раздел «Ноды» на странице настроек. */
export function NodesSettings() {
  const [nodes, reload] = useNodes(5000);
  const [form, setForm] = useState(null); // null, {} (новая) или нода
  const [busy, setBusy] = useState('');
  const act = async (id, label, fn) => {
    setBusy(id + label);
    try { await fn(); } catch (x) { toast(x.message, 'err'); }
    setBusy('');
  };
  const test = n => act(n.id, 'test', async () => {
    const r = await api(`/nodes/${n.id}/test`, { method: 'POST' });
    toast(r.online ? 'Связь есть' : r.error || 'Нода недоступна', r.online ? 'ok' : 'err');
    reload();
  });
  const images = n => act(n.id, 'img', async () => {
    await api('/images/update?node=' + n.id, { method: 'POST' });
    toast('Обновление образов на ноде запущено');
  });
  const remove = async n => {
    if (!(await askConfirm(`Удалить ноду «${n.name}»? Серверы на ней не удаляются и продолжают работать, но пропадут из этой панели.`))) return;
    act(n.id, 'rm', async () => { await api('/nodes/' + n.id, { method: 'DELETE' }); toast('Нода удалена'); reload(); });
  };
  return html`<div class="card col">
    <div class="row wrap"><h2 class="grow" style="margin:0">Ноды</h2>
      <${Btn} kind="primary" icon="plus" onClick=${() => setForm({})}>Подключить ноду</${Btn}></div>
    <p class="muted" style="margin:0">Подключите другие машины с Docker, и серверы Minecraft можно будет создавать и на них. Управление остаётся в этой панели: консоль, файлы, бэкапы и игроки работают так же, как на этой машине.</p>
    ${nodes && !nodes.length && html`<div class="banner info" style="margin:0">Нод пока нет. Нажмите «Подключить ноду» и следуйте инструкции.</div>`}
    ${(nodes || []).map(n => html`<div class="noderow" key=${n.id}>
      <span class=${'badge ' + (n.online ? 'running' : 'unreachable')}>${n.online ? 'Онлайн' : 'Недоступна'}</span>
      <div style="flex:1 1 260px;min-width:0"><div><span class="nm">${n.name}</span> <span class="mono muted" style="font-size:12.5px;word-break:break-all">${n.url}</span></div>
        <div class="muted" style="font-size:12.5px;margin-top:2px">
          ${n.online && n.hostInfo
            ? `${n.servers ?? 0} ${plural(n.servers ?? 0, 'сервер', 'сервера', 'серверов')} · ${n.hostInfo.cores} потоков · ОЗУ ${fmtBytes(n.hostInfo.memUsed)} из ${fmtBytes(n.hostInfo.memTotal)}${n.version ? ' · v' + n.version : ''}`
            : n.error || 'Проверяю…'}</div></div>
      <div class="row wrap" style="gap:8px">
        <${Btn} kind="sm" icon="refresh" disabled=${busy === n.id + 'test'} onClick=${() => test(n)}>Проверить</${Btn}>
        <${Btn} kind="sm" icon="download" disabled=${!n.online || busy === n.id + 'img'} onClick=${() => images(n)} title="Скачать свежие образы Java и ядер на ноде">Образы</${Btn}>
        <${Btn} kind="sm" icon="sliders" onClick=${() => setForm(n)}>Изменить</${Btn}>
        <${Btn} kind="sm danger" icon="trash" disabled=${busy === n.id + 'rm'} onClick=${() => remove(n)}>Удалить</${Btn}>
      </div></div>`)}
    ${form && html`<${NodeForm} node=${form.id ? form : null} onClose=${() => setForm(null)} onSaved=${() => { setForm(null); reload(); }} />`}
  </div>`;
}

/** Выбор машины при создании сервера. Если нод нет, не показывается. */
export function NodePicker({ nodes, value, onChange }) {
  if (!nodes || !nodes.length) return null;
  return html`<div class="card col">
    <h2>Где создать</h2>
    <${Field} label="Машина" hint="Файлы сервера, порт и Java будут на выбранной машине.">
      <select value=${value} onChange=${e => onChange(e.target.value)}>
        <option value="local">Эта машина</option>
        ${nodes.map(n => html`<option key=${n.id} value=${n.id} disabled=${!n.online}>${n.name}${n.online ? '' : ' (недоступна)'}</option>`)}
      </select></${Field}>
  </div>`;
}

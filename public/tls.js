import { html, useState, useEffect, Icon, Btn, Field, Toggle, toast, askConfirm, copyText, locale, plural, lang } from './ui.js';
import { api } from './api.js';

/* Настройки → Безопасность: HTTPS. Выбор способа получения сертификата, как в 3x-ui: Let's Encrypt по домену или по IP-адресу,
   самоподписанный (для локальной сети), свой сертификат или обычный HTTP. */

const MODES = [
  { id: 'letsencrypt-domain', icon: 'shield', name: 'Let\'s Encrypt: домен', desc: 'Доверенный сертификат для вашего домена, браузер не предупреждает. Нужны домен, который указывает на этот сервер, и свободный порт 80, открытый из интернета.' },
  { id: 'letsencrypt-ip', icon: 'globe', name: 'Let\'s Encrypt: IP-адрес', desc: 'Доверенный сертификат на публичный IP-адрес. Действует 6 суток и продлевается сам. Нужен порт 80, открытый из интернета.' },
  { id: 'selfsigned', icon: 'bolt', name: 'Самоподписанный', desc: 'Шифрование без внешнего центра сертификации. Подходит для локальной сети, браузер предупредит один раз.' },
  { id: 'custom', icon: 'file', name: 'Свой сертификат', desc: 'Вставьте сертификат и закрытый ключ, например от вашего центра сертификации.' },
  { id: 'off', icon: 'x', name: 'HTTP без шифрования', desc: 'Не рекомендуется: пароль и токены идут открытым текстом.' },
];
const KIND = { acme: 'Let\'s Encrypt', selfsigned: 'Самоподписанный', custom: 'Свой сертификат', fallback: 'Временный самоподписанный' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const when = ts => new Date(ts).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });

export function TlsCard() {
  const [st, setSt] = useState(null);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pport, setPport] = useState('');
  const [swap, setSwap] = useState(null);
  const set = p => setF(x => ({ ...x, ...p }));

  const load = async () => {
    try {
      const r = await api('/tls');
      setSt(r);
      setF(x => x || draftOf(r));
      return r;
    } catch { return null; }
  };
  const draftOf = r => ({ mode: r.mode === 'off' && !r.secure ? 'selfsigned' : r.mode, host: r.host || (/^(localhost|127\.)/.test(location.hostname) ? '' : location.hostname), hosts: (r.hosts || []).join(', '), email: r.email || '', staging: r.staging, acmePort: r.acmePort || 80, cert: '', key: '' });
  useEffect(() => { load(); }, []);
  const running = st?.job?.running;
  useEffect(() => { if (!running) return; const t = setInterval(load, 1500); return () => clearInterval(t); }, [running]);

  if (!st || !f) return html`<div class="card"><div class="skeleton" style="height:120px"></div></div>`;
  const le = f.mode === 'letsencrypt-domain' || f.mode === 'letsencrypt-ip';
  const cur = MODES.find(m => m.id === st.mode);
  const days = st.cert ? Math.floor((st.cert.notAfter - Date.now()) / 86400e3) : 0;

  const go = secure => { setTimeout(() => { location.href = `${secure ? 'https' : 'http'}://${location.hostname}${location.port ? ':' + location.port : ''}/#/settings/security`; }, 900); };

  const apply = async () => {
    if (f.mode === 'off' && !(await askConfirm('Отключить шифрование? Пароль и токены будут передаваться по сети открытым текстом.', { danger: true }))) return;
    if (f.mode === 'selfsigned' && st.mode !== 'selfsigned' && !(await askConfirm('Будет создан самоподписанный сертификат. При первом заходе по HTTPS браузер покажет предупреждение: это нормально, продолжите вход. Сертификат можно добавить в доверенные, он скачивается кнопкой ниже. Продолжить?'))) return;
    setBusy(true);
    try {
      if (f.mode === 'custom' && f.cert.trim()) await api('/tls/custom', { method: 'POST', body: { cert: f.cert, key: f.key } });
      const body = { mode: f.mode, host: f.host, hosts: f.hosts, email: f.email, staging: f.staging, acmePort: Number(f.acmePort) };
      let r = await api('/tls', { method: 'PUT', body });
      setSt(r);
      if (f.mode === 'letsencrypt-domain' || f.mode === 'letsencrypt-ip') {
        toast('Выпуск сертификата запущен');
        const t0 = Date.now();
        while (Date.now() - t0 < 240000) {
          await new Promise(x => setTimeout(x, 1500));
          r = await load() || r;
          if (!r.job?.running) break;
        }
        if (r.job?.error) { toast(r.job.error, 'err'); setBusy(false); return; }
        if (r.cert?.kind !== 'acme') { setBusy(false); return; }
        toast('Сертификат выпущен');
      } else toast(f.mode === 'off' ? 'Шифрование отключено' : 'Настройки сохранены');
      const secureNow = location.protocol === 'https:', want = f.mode !== 'off';
      if (secureNow !== want) go(want); else { setF(draftOf(r)); }
    } catch (x) { toast(x.message, 'err'); }
    setBusy(false);
  };
  const renew = async () => {
    setBusy(true);
    try { setSt(await api('/tls/renew', { method: 'POST' })); toast('Выпуск сертификата запущен'); } catch (x) { toast(x.message, 'err'); }
    setBusy(false);
  };
  const regen = async () => {
    setBusy(true);
    try { setSt(await api('/tls/selfsigned', { method: 'POST' })); toast('Создан новый сертификат. Обновите страницу, браузер запросит подтверждение заново.'); } catch (x) { toast(x.message, 'err'); }
    setBusy(false);
  };

  // Смена порта: панель пересоздаёт свой контейнер с новым портом. Ждём, пока она ответит на новом адресе, и переходим туда.
  const changePort = async () => {
    const n = Number(pport === '' ? st.port : pport);
    if (!Number.isInteger(n) || n < 1 || n > 65535) return toast('Порт должен быть числом от 1 до 65535', 'err');
    if (n === st.port) return toast('Панель уже работает на этом порту', 'err');
    if (!(await askConfirm(`Сменить порт панели с ${st.port} на ${n}? Панель перезапустится за несколько секунд, Minecraft-серверы продолжат работать. Если порт открыт на роутере или в файрволе, откройте и новый. Ноды, подключённые к этой панели, придётся указать заново.`))) return;
    setBusy(true);
    try { await api('/tls/port', { method: 'POST', body: { port: n } }); } catch (x) { toast(x.message, 'err'); setBusy(false); return; }
    const url = `${location.protocol}//${location.hostname}:${n}/`;
    setSwap({ port: n, url });
    for (let i = 0; i < 80; i++) {
      await sleep(1500);
      try { await fetch(url + 'api/me', { mode: 'no-cors', cache: 'no-store' }); location.href = url + '#/settings/security'; return; } catch {}
      if (i >= 4) {                                        // если порт занят, панель вернулась на старый порт и сообщает причину
        const r = await api('/tls').catch(() => null);
        if (r?.portChange?.port === n && !r.portChange.ok) { setSwap(null); setSt(r); setBusy(false); toast(r.portChange.error || 'Не удалось сменить порт', 'err'); return; }
      }
    }
    setBusy(false);
  };

  const banner = st.mode === 'off'
    ? html`<div class="banner warn flex" style="margin:0"><span class="grow"><b>Панель работает по HTTP без шифрования.</b> Пароль, токены нод и команды консоли идут по сети открытым текстом. Включите HTTPS ниже.</span></div>`
    : st.warnings.includes('fallback')
      ? html`<div class="banner warn" style="margin:0">Настоящий сертификат ещё не выпущен, сейчас используется временный самоподписанный. ${st.lastError ? 'Причина: ' + st.lastError : ''}</div>`
      : html`<div class="banner info" style="margin:0">Соединение защищено: ${cur?.name || ''}.${!st.secure ? ' Эта страница открыта без шифрования, откройте её по https://.' : ''}</div>`;

  return html`<div class="card col" id="tls-card">
    <div class="row wrap"><h2 class="grow" style="margin:0">Безопасность: HTTPS</h2>
      <span class=${'chip ' + (st.mode === 'off' ? 'warn' : 'ok')}>${st.mode === 'off' ? 'Без шифрования' : st.secure ? 'Защищено' : 'Включено'}</span></div>
    <p class="muted" style="margin:0">Панель управляет Docker, поэтому доступ к ней нужно шифровать. Выберите, откуда взять сертификат.</p>
    ${banner}
    ${st.portChange && !st.portChange.ok && Date.now() - st.portChange.at < 36e5 && html`<div class="banner warn" style="margin:0">Последняя смена порта на ${st.portChange.port} не удалась: ${st.portChange.error}</div>`}
    <div class="portrow">
      <${Field} label="Порт панели" hint="Панель перезапустится на несколько секунд, Minecraft-серверы продолжат работать. Если порт открыт на роутере или в файрволе, откройте и новый.">
        <div class="row" style="gap:8px"><input class="mono" type="number" min="1" max="65535" value=${pport === '' ? (st.port || '') : pport} onInput=${e => setPport(e.target.value)} disabled=${busy || !!swap} />
          <${Btn} icon="refresh" disabled=${busy || running || !!swap} onClick=${changePort}>Сменить порт</${Btn}></div>
      </${Field}>
      ${swap && html`<div class="banner info flex" style="margin:8px 0 0"><span class="spin"></span><span class="grow">Панель перезапускается на порту ${swap.port}. Страница откроется сама. Если этого не произошло, откройте <a href=${swap.url + '#/settings'}>${swap.url}</a> вручную.</span></div>`}
    </div>

    ${st.cert && st.mode !== 'off' && html`<div class="tlsinfo">
      <div><span class="muted">Тип</span><b>${KIND[st.cert.kind] || st.cert.kind}</b></div>
      <div><span class="muted">Выдан для</span><b class="mono">${st.cert.names.join(', ')}</b></div>
      <div><span class="muted">Издатель</span><b>${st.cert.issuer || '—'}</b></div>
      <div><span class="muted">Действует до</span><b>${when(st.cert.notAfter)} <small class=${days < 3 && st.cert.kind !== 'acme' ? 'warn-t' : 'muted'}>(${days} ${plural(days, 'день', 'дня', 'дней')})</small></b></div>
      <div class="fp"><span class="muted">Отпечаток SHA-256</span><button type="button" class="mono fpbtn" title="Скопировать" onClick=${() => copyText(st.cert.fingerprint).then(() => toast('Скопировано'))}>${st.cert.fingerprint}</button></div>
      ${st.nextRenewAt > 0 && html`<div><span class="muted">Продление</span><b>${when(st.nextRenewAt)}</b></div>`}
    </div>`}

    ${st.cert?.selfSigned && st.mode !== 'off' && html`<div class="tlstrust">
      <div class="row"><span class="ti"><${Icon} n="shield" size=${18} /></span><b class="grow">Убрать предупреждение браузера</b></div>
      <p class="muted" style="margin:0">Браузер не знает, кто выдал самоподписанный сертификат, поэтому пишет «не защищено». Установите сертификат как доверенный один раз на каждом устройстве: скачайте установщик для своей системы и запустите его.</p>
      <div class="trbtns">
        <a class="btn" href=${'/api/tls/trust/windows?lang=' + lang} download><${Icon} n="download" size=${17} />Для Windows</a>
        <a class="btn" href=${'/api/tls/trust/mac?lang=' + lang} download><${Icon} n="download" size=${17} />Для macOS</a>
        <a class="btn" href=${'/api/tls/trust/linux?lang=' + lang} download><${Icon} n="download" size=${17} />Для Linux</a>
        <a class="btn" href="/api/tls/cert.crt" download="horizoncraft.crt"><${Icon} n="download" size=${17} />Для телефона</a>
      </div>
      <small class="muted">В Windows запустите скачанный файл .bat и нажмите «Да» в окне подтверждения. Установщик предложит перезапустить браузеры и откроет панель заново, соглашайтесь, только если сохранили всё нужное. Можно и вручную: введите chrome://restart в Chrome или edge://restart в Edge. Android: откройте файл, затем Настройки → Безопасность → Установить сертификат → Сертификат ЦС. iPhone: откройте файл, разрешите профиль, затем включите доверие в Настройки → Основные → Об этом устройстве → Доверие сертификатов. Firefox хранит сертификаты отдельно: Настройки → Приватность и защита → Сертификаты → Импорт. После создания нового сертификата установку нужно повторить.</small>
    </div>`}

    <div class="tlsmodes" role="radiogroup">${MODES.map(m => html`<button type="button" key=${m.id} role="radio" aria-checked=${f.mode === m.id} class=${'tlsm' + (f.mode === m.id ? ' on' : '') + (m.id === 'off' ? ' danger' : '')} onClick=${() => set({ mode: m.id })}>
      <span class="ti"><${Icon} n=${m.icon} size=${18} /></span><b>${m.name}</b><small>${m.desc}</small>
      ${st.mode === m.id && html`<span class="cur">Сейчас</span>`}</button>`)}</div>

    ${f.mode === 'letsencrypt-domain' && html`<div class="tlsform">
      <${Field} label="Домен" hint="Запись A (и AAAA) домена должна указывать на этот сервер."><input class="mono" placeholder="panel.example.com" value=${f.host} onInput=${e => set({ host: e.target.value })} /></${Field}>
      <${Field} label="Дополнительные домены" hint="Через запятую, необязательно."><input class="mono" placeholder="www.example.com" value=${f.hosts} onInput=${e => set({ hosts: e.target.value })} /></${Field}>
    </div>`}
    ${f.mode === 'letsencrypt-ip' && html`<div class="tlsform">
      <${Field} label="Публичный IP-адрес" hint="Адрес, по которому панель видна из интернета. Локальные адреса (192.168.x.x, 10.x.x.x) Let's Encrypt не принимает."><input class="mono" placeholder="203.0.113.10" value=${f.host} onInput=${e => set({ host: e.target.value })} /></${Field}>
    </div>`}
    ${f.mode === 'selfsigned' && html`<div class="tlsform">
      <${Field} label="Адрес панели" hint="IP или имя, по которому вы открываете панель. Оно попадёт в сертификат, иначе браузер заметит несовпадение."><input class="mono" placeholder="192.168.0.10" value=${f.host} onInput=${e => set({ host: e.target.value })} /></${Field}>
      <${Field} label="Другие имена и адреса" hint="Через запятую, необязательно. localhost добавляется сам."><input class="mono" placeholder="panel.lan, 10.0.0.5" value=${f.hosts} onInput=${e => set({ hosts: e.target.value })} /></${Field}>
    </div>`}
    ${f.mode === 'custom' && html`<div class="tlsform one">
      ${st.customLoaded && html`<div class="banner info" style="margin:0">Свой сертификат уже загружен. Чтобы заменить его, вставьте новый ниже.</div>`}
      <${Field} label="Сертификат (PEM, вместе с цепочкой)"><textarea class="mono" rows="5" placeholder="-----BEGIN CERTIFICATE-----" value=${f.cert} onInput=${e => set({ cert: e.target.value })}></textarea></${Field}>
      <${Field} label="Закрытый ключ (PEM, без пароля)" hint="Ключ хранится только на этом сервере в папке данных и не попадает в резервные копии настроек."><textarea class="mono" rows="4" placeholder="-----BEGIN PRIVATE KEY-----" value=${f.key} onInput=${e => set({ key: e.target.value })}></textarea></${Field}>
    </div>`}
    ${le && html`<div class="tlsform">
      <${Field} label="Почта (необязательно)" hint="Let's Encrypt использует её для связи по вашей учётной записи."><input type="email" placeholder="admin@example.com" value=${f.email} onInput=${e => set({ email: e.target.value })} /></${Field}>
      <${Field} label="Порт проверки на этом сервере" hint="Let's Encrypt всегда стучится на порт 80. Меняйте, только если пробросили 80 на другой порт."><input type="number" min="1" max="65535" value=${f.acmePort} onInput=${e => set({ acmePort: e.target.value })} /></${Field}>
      <div style="grid-column:1/-1"><${Toggle} on=${f.staging} onChange=${v => set({ staging: v })} label="Тестовый сервер Let's Encrypt (сертификат не будет доверенным)" /></div>
    </div>`}

    ${(st.job || st.lastError) && html`<div class=${'tlslog' + (st.job?.error ? ' err' : '')}>
      <div class="row"><b class="grow">${running ? 'Выпуск сертификата…' : st.job?.error ? 'Выпуск не удался' : 'Журнал выпуска'}</b>${running && html`<span class="spin"></span>`}</div>
      ${st.job?.steps?.map((s, i) => html`<div key=${i} class="mono"><span class="muted">${new Date(s.at).toLocaleTimeString(locale)}</span> ${s.text}</div>`)}
      ${!st.job && st.lastError && html`<div class="mono">${st.lastError}</div>`}
    </div>`}

    <div class="row wrap">
      <${Btn} kind="primary" icon="shield" disabled=${busy || running} onClick=${apply}>${busy || running ? 'Применяем…' : f.mode === 'off' ? 'Отключить шифрование' : 'Применить и перейти на HTTPS'}</${Btn}>
      ${(st.mode === 'letsencrypt-domain' || st.mode === 'letsencrypt-ip') && html`<${Btn} icon="refresh" disabled=${busy || running} onClick=${renew}>Обновить сейчас</${Btn}>`}
      ${st.mode === 'selfsigned' && html`<${Btn} icon="refresh" disabled=${busy} onClick=${regen}>Создать новый сертификат</${Btn}>`}
      ${st.cert && st.mode !== 'off' && html`<a class="btn" href="/api/tls/cert.pem" download="horizoncraft.pem"><${Icon} n="download" size=${17} />Скачать сертификат</a>`}
    </div>
  </div>`;
}

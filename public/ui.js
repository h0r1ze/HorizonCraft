import { html, useState, useEffect, useRef } from '/vendor/htm-preact.js';
export * from '/vendor/htm-preact.js';

export const appState = { settings: {} };

const P = {
  server: 'M3 4h18v6H3zM3 14h18v6H3zM7 7h.01M7 17h.01',
  plus: 'M12 5v14M5 12h14',
  play: 'M7 4l13 8-13 8z',
  stop: 'M6 6h12v12H6z',
  restart: 'M20 11a8 8 0 10-2.3 5.7M20 4v7h-7',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4v6M9 14v6',
  terminal: 'M3 5h18v14H3zM7 9l3 3-3 3M12 15h5',
  users: 'M16 20v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7M21 20v-1a4 4 0 00-3-3.9M15 4.2a3.5 3.5 0 010 6.6',
  folder: 'M3 6h6l2 2h10v11H3z',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  puzzle: 'M10 4h4v3a2 2 0 104 0h2v6h-3a2 2 0 100 4h3v3H4v-5h3a2 2 0 100-4H4V7h6z',
  save: 'M5 4h12l3 3v13H5zM8 4v5h8V4M8 20v-6h8v6',
  x: 'M6 6l12 12M18 6L6 18',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  logout: 'M9 4H4v16h5M16 8l4 4-4 4M20 12H9',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6z',
  cube: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-1-3-2 .5-1.5-1.5.5-2-3-1-1 2h-2l-1-2-3 1 .5 2L6 8.5 4 8l-1 3 2 1v2l-2 1 1 3 2-.5L7.5 19l-.5 2 3 1 1-2h2l1 2 3-1-.5-2 1.5-1.5 2 .5 1-3-2-1z',
  folderplus: 'M3 6h6l2 2h10v11H3zM12 11v6M9 14h6',
  back: 'M15 5l-7 7 7 7',
  palette: 'M12 3a9 9 0 100 18c1.5 0 2-1 2-2s-.7-1.6-.7-2.6c0-1 .8-1.4 1.7-1.4H17a4 4 0 004-4c0-4.4-4-8-9-8zM7.5 11h.01M10 7.5h.01M14 7.5h.01M16.5 11h.01',
  unpack: 'M4 8h16v12H4zM9 8V4h6v4M12 11v6M9.5 14.5L12 17l2.5-2.5',
  home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
  chart: 'M4 20V4M4 20h16M8 15l3-4 3 3 5-7',
  archive: 'M3 4h18v5H3zM5 9v11h14V9M10 13h4',
  clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
  cpu: 'M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4',
  ram: 'M3 8h18v8H3zM7 8v8M11 8v8M15 8v8M19 8v8M6 16v2M18 16v2',
  disk: 'M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  copy: 'M9 9h11v11H9zM5 15V4h11',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z',
  msg: 'M4 5h16v11H9l-5 4z',
  clone: 'M8 8h12v12H8zM4 16V4h12',
  refresh: 'M4 12a8 8 0 0114-5.3L20 9M20 4v5h-5M20 12a8 8 0 01-14 5.3L4 15M4 20v-5h5',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  check: 'M5 12l5 5 9-10',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  rocket: 'M5 15c-1 1-2 4-2 6 2 0 5-1 6-2M14 4c4-1 6-1 6-1s0 2-1 6l-6 6-5-5zM9 15l-3-3 3-1M15 14l1 3-3 1',
};
export const Icon = ({ n, size = 17 }) => html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="flex:none"><path d=${P[n] || ''} /></svg>`;

export const Btn = ({ kind = '', icon, children, ...rest }) =>
  html`<button class=${'btn ' + kind} ...${rest}>${icon && html`<${Icon} n=${icon} size=${kind.includes('sm') ? 15 : 17} />`}${children}</button>`;

export const Field = ({ label, hint, children }) =>
  html`<label class="f"><span>${label}</span>${children}${hint && html`<small>${hint}</small>`}</label>`;

export const Toggle = ({ on, onChange, label }) =>
  html`<div class=${'toggle ' + (on ? 'on' : '')} onClick=${() => onChange(!on)}><i></i><span>${label}</span></div>`;

export function Modal({ title, onClose, children, footer, wide, narrow }) {
  return html`<div class="overlay" onMouseDown=${e => e.target === e.currentTarget && onClose()}>
    <div class="modal" style=${wide ? 'width:min(1000px,100%)' : narrow ? 'width:min(460px,100%)' : ''}>
      <header><h2 class="grow">${title}</h2><${Btn} kind="ghost icon" icon="x" onClick=${onClose} /></header>
      <div class="body">${children}</div>
      ${footer && html`<footer>${footer}</footer>`}
    </div>
  </div>`;
}

const STATE = { running: 'Работает', starting: 'Запускается', stopped: 'Остановлен', missing: 'Не запускался', unreachable: 'Нода недоступна' };
export const StateBadge = ({ s }) => {
  const key = s.busy ? 'busy' : s.state;
  return html`<span class=${'badge ' + key}>${s.busy || STATE[s.state]}</span>`;
};

/* ---------- toasts ---------- */
const subs = new Set();
let nid = 1;
export function toast(msg, kind = 'ok') {
  const t = { id: nid++, msg, kind };
  subs.forEach(f => f({ add: t }));
  setTimeout(() => subs.forEach(f => f({ rm: t.id })), 4500);
}
export function Toasts() {
  const [list, setList] = useState([]);
  useEffect(() => {
    const f = e => setList(l => (e.add ? [...l, e.add] : l.filter(x => x.id !== e.rm)));
    subs.add(f);
    return () => subs.delete(f);
  }, []);
  return html`<div class="toasts">${list.map(t => html`<div key=${t.id} class=${'toast ' + t.kind}>${t.msg}</div>`)}</div>`;
}

/* ---------- графики ---------- */
let gid = 0;
export function Spark({ data, max, color = 'var(--accent)', height = 60, stroke = 2 }) {
  const [id] = useState(() => 'g' + ++gid);
  const W = 300, H = height;
  const pts = data.length ? data : [0];
  const top = max || Math.max(1, ...pts) * 1.15;
  const step = pts.length > 1 ? W / (pts.length - 1) : W;
  const y = v => H - 3 - Math.min(1, v / top) * (H - 8);
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${((pts.length - 1) * step).toFixed(1)} ${H} L0 ${H} Z`;
  const last = pts[pts.length - 1];
  return html`<svg class="spark" viewBox=${`0 0 ${W} ${H}`} preserveAspectRatio="none" style=${`height:${H}px`}>
    <defs><linearGradient id=${id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color=${color} stop-opacity=".35" /><stop offset="1" stop-color=${color} stop-opacity="0" /></linearGradient></defs>
    <path d=${area} fill=${`url(#${id})`} />
    <path d=${line} fill="none" stroke=${color} stroke-width=${stroke} vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round" />
    ${pts.length > 1 && html`<circle cx=${(pts.length - 1) * step} cy=${y(last)} r="3.5" fill=${color} vector-effect="non-scaling-stroke" />`}
  </svg>`;
}

export const Meter = ({ pct }) => html`<div class=${'bar ' + (pct > 90 ? 'hot' : pct > 75 ? 'warn' : '')}><i style=${'width:' + Math.max(1, Math.min(100, pct)) + '%'}></i></div>`;

/* ---------- темы ---------- */
export const THEMES = [
  { id: 'dark', name: 'Тёмная', mode: 'dark', sw: { bg: '#080b11', panel: '#141a26', accent: '#4ade80', text: '#eef1f7' } },
  { id: 'light', name: 'Светлая', mode: 'light', sw: { bg: '#f3f5f9', panel: '#ffffff', accent: '#15803d', text: '#141926' } },
  { id: 'neon', name: 'Неон', mode: 'dark', sw: { bg: '#09050f', panel: '#1a1030', accent: '#c084fc', text: '#f3ecff' } },
  { id: 'pink', name: 'Розовая', mode: 'light', sw: { bg: '#fff1f6', panel: '#ffffff', accent: '#be185d', text: '#3a0d24' } },
  { id: 'blue', name: 'Синяя', mode: 'dark', sw: { bg: '#060d1a', panel: '#112245', accent: '#60a5fa', text: '#e9f1ff' } },
  { id: 'beige', name: 'Мягкий беж', mode: 'light', sw: { bg: '#f5efe5', panel: '#fffaf1', accent: '#8a5a2b', text: '#33291f' } },
  { id: 'sunset', name: 'Закат', mode: 'dark', sw: { bg: '#130909', panel: '#2a1616', accent: '#fb923c', text: '#fff0e8' } },
  { id: 'ocean', name: 'Океан', mode: 'dark', sw: { bg: '#031318', panel: '#0d2f37', accent: '#22d3ee', text: '#e2fbff' } },
  { id: 'graphite', name: 'Графит', mode: 'dark', sw: { bg: '#0d0e10', panel: '#1e2024', accent: '#e5e7eb', text: '#f3f4f6' } },
  { id: 'rei', name: 'Аянами Рей', mode: 'light', sw: { bg: '#edf2f8', panel: '#fbfdff', accent: '#2d639c', text: '#1b2940', hl: '#c8202f' } },
];
export function getTheme() {
  try { const t = localStorage.getItem('hc-theme'); if (THEMES.some(x => x.id === t)) return t; } catch {}
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
export function setTheme(t) {
  const th = THEMES.find(x => x.id === t) || THEMES[0];
  document.documentElement.dataset.theme = th.id;
  document.documentElement.dataset.mode = th.mode;
  try { localStorage.setItem('hc-theme', th.id); } catch {}
}

/* ---------- утилиты ---------- */
export const fmtBytes = n => {
  if (!n) return '0 Б';
  const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return (n / 1024 ** i).toFixed(i > 1 ? 1 : 0) + ' ' + u[i];
};
export const TYPE_NAMES = {
  VANILLA: 'Vanilla', PAPER: 'Paper', PURPUR: 'Purpur', FABRIC: 'Fabric', FORGE: 'Forge',
  NEOFORGE: 'NeoForge', AUTO_CURSEFORGE: 'CurseForge',
};
export const TYPE_COLOR = {
  VANILLA: '#4ade80', PAPER: '#60a5fa', PURPUR: '#c084fc', FABRIC: '#e0b863',
  FORGE: '#fb923c', NEOFORGE: '#f59e0b', AUTO_CURSEFORGE: '#f16436',
};
export const logoUrl = s => (s.logo ? `/api/servers/${s.id}/logo?v=${s.logo.v}` : null);
/** Значок сервера: свой логотип со свечением из его цветов, иначе буква на цвете типа сервера. */
export const Avatar = ({ s, lg }) => s.logo
  ? html`<div class=${'avatar logo ' + (lg ? 'lg' : '')} style=${`--gc:${s.logo.glow};background-image:url(${logoUrl(s)})`}></div>`
  : html`<div class=${'avatar ' + (lg ? 'lg' : '')} style=${`--tc:${TYPE_COLOR[s.type] || '#4ade80'}`}>${(s.name || '?').trim().charAt(0).toUpperCase()}</div>`;
export const isRemote = s => !!s.node && s.node.id !== 'local';
/** Адрес, по которому игроки заходят на машину: у сервера на ноде это адрес ноды. */
export const hostOfServer = s => (isRemote(s) ? s.node.host : appState.settings.publicHost || location.hostname);
export const addrOf = s => {
  const host = hostOfServer(s);
  const d = (s.domain || '').split(',')[0];
  return d ? d : `${host}:${s.port}`;
};
export const uptime = iso => {
  if (!iso) return '';
  const sec = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  return d ? `${d} д ${h} ч` : h ? `${h} ч ${m} мин` : `${m} мин`;
};
export const fmtUptime = sec => {
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600);
  return d ? `${d} д ${h} ч` : `${h} ч ${Math.floor(sec % 3600 / 60)} мин`;
};
export const ago = ms => {
  if (!ms) return 'никогда';
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'только что';
  if (s < 3600) return Math.floor(s / 60) + ' мин назад';
  if (s < 86400) return Math.floor(s / 3600) + ' ч назад';
  return Math.floor(s / 86400) + ' д назад';
};
export const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
};
/* Копирование сразу в буфер. По http с IP-адресом navigator.clipboard недоступен, поэтому есть запасной путь через execCommand. */
export const copyText = async t => {
  let ok = false;
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(t); ok = true; } catch {}
  }
  if (!ok) {
    const ta = document.createElement('textarea');
    ta.value = t;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.focus(); ta.select(); ta.setSelectionRange(0, t.length);
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
  }
  if (ok) toast('Скопировано: ' + t);
  else toast('Не удалось скопировать автоматически: выделите адрес и нажмите Ctrl+C', 'err');
};

/* ---------- диалоги внутри панели вместо системных окон confirm и prompt ---------- */
const dlgSubs = new Set();
let did = 1;
const openDialog = d => new Promise(res => dlgSubs.forEach(f => f({ ...d, id: did++, res })));
/** Подтверждение. Возвращает false при отмене, иначе { checked }. */
export const askConfirm = (message, o = {}) => openDialog({ kind: 'confirm', message, ...o });
/** Ввод текста. Возвращает null при отмене, иначе { value, checked }. */
export const askText = (title, o = {}) => openDialog({ kind: 'text', title, ...o });

function DialogView({ d, done }) {
  const [val, setVal] = useState(d.value ?? '');
  const [chk, setChk] = useState(!!d.checked);
  const ref = useRef(null);
  const cancel = () => done(d.kind === 'confirm' ? false : null);
  const ok = () => {
    if (d.kind === 'text') { if (d.required && !val.trim()) return; done({ value: val.trim(), checked: chk }); }
    else done({ checked: chk });
  };
  useEffect(() => {
    ref.current?.focus(); ref.current?.select?.();
    const f = e => e.key === 'Escape' && cancel();
    addEventListener('keydown', f);
    return () => removeEventListener('keydown', f);
  }, []);
  const danger = d.danger ?? /^(Удалить|Принудительно|Восстановить)/.test(d.message || '');
  const okText = d.ok || (d.kind === 'text' ? 'OK' : /^Удалить/.test(d.message || '') ? 'Удалить' : 'Подтвердить');
  const footer = html`<${Btn} onClick=${cancel}>${d.cancel || 'Отмена'}</${Btn}>
    <${Btn} kind=${danger ? 'danger' : 'primary'} disabled=${d.kind === 'text' && d.required && !val.trim()} onClick=${ok}>${okText}</${Btn}>`;
  return html`<${Modal} narrow=${true} title=${d.title || (d.kind === 'confirm' ? 'Подтвердите действие' : '')} onClose=${cancel} footer=${footer}>
    <div class="col" style="gap:14px">
      ${d.kind === 'confirm' && html`<div class="dlg-msg">${d.message}</div>`}
      ${d.kind === 'text' && html`<label class="f"><span>${d.label || ''}</span>
        ${d.multiline ? html`<textarea ref=${ref} value=${val} placeholder=${d.placeholder} onInput=${e => setVal(e.target.value)}></textarea>`
          : html`<input ref=${ref} value=${val} placeholder=${d.placeholder} onInput=${e => setVal(e.target.value)} onKeyDown=${e => e.key === 'Enter' && ok()} />`}
        ${d.hint && html`<small>${d.hint}</small>`}</label>`}
      ${d.checkbox && html`<${Toggle} label=${d.checkbox} on=${chk} onChange=${setChk} />`}
    </div>
  </${Modal}>`;
}
export function Dialogs() {
  const [q, setQ] = useState([]);
  useEffect(() => { const f = d => setQ(l => [...l, d]); dlgSubs.add(f); return () => dlgSubs.delete(f); }, []);
  const d = q[0];
  if (!d) return null;
  return html`<${DialogView} key=${d.id} d=${d} done=${v => { d.res(v); setQ(l => l.slice(1)); }} />`;
}

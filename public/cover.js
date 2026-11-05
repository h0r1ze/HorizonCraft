import { askConfirm, html, useState, useEffect, useRef, Icon, Btn, Modal, Toggle, Avatar, toast, fmtBytes } from './ui.js';
import { api } from './api.js';

export const coverUrl = (s, sm) => (s.cover ? `/api/servers/${s.id}/cover?size=${sm ? 'sm' : 'lg'}&v=${s.cover.v}` : null);

const CARD_RATIO = 2.4;                       // пропорции обложки на карточке сервера
const PRESETS = [['Высокое', 0.9], ['Оптимальное', 0.8], ['Экономное', 0.6]];
const Field2 = ({ label, hint, children }) => html`<label class="f"><span>${label}</span>${children}${hint && html`<small>${hint}</small>`}</label>`;

/** Редактор: выбор файла, кадрирование, масштаб и сжатие. kind: 'cover' (16:9) или 'logo' (квадрат). */
export function CoverEditor({ s, kind = 'cover', onClose, onSaved }) {
  const logo = kind === 'logo';
  const W = logo ? 512 : 1280, H = logo ? 512 : 720;
  const [img, setImg] = useState(null);
  const [orig, setOrig] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [q, setQ] = useState(0.8);
  const [blob, setBlob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [asIcon, setAsIcon] = useState(!s.logo);
  const canvas = useRef(null), drag = useRef(null), input = useRef(null);
  const has = logo ? s.logo : s.cover;

  const geom = (i, z, o) => {
    const base = Math.max(W / i.width, H / i.height) * z;
    const dw = i.width * base, dh = i.height * base;
    const mx = (dw - W) / 2, my = (dh - H) / 2;
    return { dw, dh, x: Math.max(-mx, Math.min(mx, o.x)), y: Math.max(-my, Math.min(my, o.y)) };
  };

  const load = file => {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp|gif|bmp|avif)$/.test(file.type)) return toast('Нужен файл JPEG, PNG, WebP, GIF или BMP', 'err');
    if (file.size > 40 * 1024 * 1024) return toast('Файл больше 40 МБ', 'err');
    const i = new Image();
    i.onload = () => {
      if (i.width < (logo ? 128 : 320) || i.height < (logo ? 128 : 180)) toast('Изображение маленькое, на экране оно будет размытым', 'err');
      setImg(i); setOrig(file.size); setZoom(1); setOff({ x: 0, y: 0 });
    };
    i.onerror = () => toast('Не удалось открыть изображение', 'err');
    i.src = URL.createObjectURL(file);
  };

  // Перерисовка кадра и подготовка сжатого файла
  useEffect(() => {
    if (!img || !canvas.current) return;
    const c = canvas.current, ctx = c.getContext('2d');
    const g = geom(img, zoom, off);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, W / 2 + g.x - g.dw / 2, H / 2 + g.y - g.dh / 2, g.dw, g.dh);
    const t = setTimeout(() => {
      c.toBlob(b => {
        if (b && b.type === 'image/webp') setBlob(b);
        else c.toBlob(j => setBlob(j), 'image/jpeg', q);
      }, 'image/webp', q);
    }, 200);
    return () => clearTimeout(t);
  }, [img, zoom, off, q]);

  const clampOff = o => { const g = geom(img, zoom, o); return { x: g.x, y: g.y }; };
  const down = e => { drag.current = { x: e.clientX, y: e.clientY, o: off }; e.currentTarget.setPointerCapture(e.pointerId); };
  const move = e => {
    if (!drag.current) return;
    const k = W / e.currentTarget.getBoundingClientRect().width;
    setOff(clampOff({ x: drag.current.o.x + (e.clientX - drag.current.x) * k, y: drag.current.o.y + (e.clientY - drag.current.y) * k }));
  };
  const up = () => { drag.current = null; };
  const wheel = e => { e.preventDefault(); const z = Math.max(1, Math.min(4, zoom - e.deltaY * 0.002)); setZoom(z); setOff(o => clampOff(o)); };
  const setZ = z => { setZoom(z); setOff(o => { const g = geom(img, z, o); return { x: g.x, y: g.y }; }); };

  const url = logo ? `/api/servers/${s.id}/logo` : `/api/servers/${s.id}/cover${asIcon ? '?icon=1' : ''}`;
  const save = async () => {
    if (!blob) return;
    setBusy(true);
    try {
      const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': blob.type }, body: blob });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Не удалось сохранить');
      toast(logo ? 'Значок сохранён' : 'Обложка сохранена');
      onSaved(d);
    } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  const remove = async () => {
    if (!(await askConfirm(logo ? 'Удалить значок сервера?' : 'Удалить обложку?'))) return;
    try { onSaved(await api(`/servers/${s.id}/${logo ? 'logo' : 'cover'}`, { method: 'DELETE' })); toast('Удалено'); }
    catch (e) { toast(e.message, 'err'); }
  };

  const bandH = (100 / (H / (W / CARD_RATIO))).toFixed(1);   // высота видимой на карточке полосы в процентах кадра
  return html`<${Modal} wide title=${logo ? 'Значок сервера' : 'Обложка сервера'} onClose=${onClose}
    footer=${html`${has && html`<${Btn} kind="danger" icon="trash" onClick=${remove}>${logo ? 'Удалить значок' : 'Удалить обложку'}</${Btn}><span class="grow"></span>`}
      <${Btn} onClick=${onClose}>Отмена</${Btn}>
      <${Btn} kind="primary" icon="save" disabled=${!blob || busy} onClick=${save}>${busy ? 'Сохранение…' : 'Сохранить'}</${Btn}>`}>
    <input type="file" hidden ref=${input} accept="image/*" onChange=${e => { load(e.target.files[0]); e.target.value = ''; }} />
    ${!img ? html`<div class="col">
      ${!logo && s.cover && html`<div class="hero" style=${`background-image:url(${coverUrl(s)});height:180px`}></div>`}
      ${logo && s.logo && html`<div class="logo-prev"><${Avatar} s=${s} lg=${true} /><span class="muted">Текущий значок. Свечение подобрано по его цветам.</span></div>`}
      <div class=${'drop ' + (over ? 'over' : '')} onClick=${() => input.current.click()}
        onDragOver=${e => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)}
        onDrop=${e => { e.preventDefault(); setOver(false); load(e.dataTransfer.files[0]); }}>
        <${Icon} n="upload" size=${30} /><b>Перетащите фото сюда или нажмите, чтобы выбрать</b>
        <span class="muted">JPEG, PNG, WebP, GIF. Любого размера: фото будет сжато автоматически</span></div></div>`
    : html`<div class="col">
      <div class=${'crop ' + (logo ? 'sq' : '')} onWheel=${wheel}>
        <canvas ref=${canvas} width=${W} height=${H} onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}></canvas>
        ${logo ? html`<div class="mask"></div>` : html`<div class="band" style=${`height:${bandH}%`}><span>видно на карточке сервера</span></div>`}</div>
      <div class="fields">
        <${Field2} label="Масштаб" hint="Перетаскивайте кадр мышью, колесо мыши тоже меняет масштаб.">
          <input type="range" min="1" max="4" step="0.01" value=${zoom} onInput=${e => setZ(+e.target.value)} /></${Field2}>
        <${Field2} label="Качество сжатия">
          <div class="seg" style="width:fit-content">${PRESETS.map(([n, v]) => html`<button key=${n} class=${q === v ? 'on' : ''} onClick=${() => setQ(v)}>${n}</button>`)}</div></${Field2}>
      </div>
      ${!logo && html`<${Toggle} on=${asIcon} onChange=${setAsIcon} label=${s.logo ? 'Заменить значок сервера центром этого кадра' : 'Сделать значок сервера из центра этого кадра'} />`}
      <div class="row wrap" style="gap:18px">
        <span class="muted">Исходный файл: <b style="color:var(--text)">${fmtBytes(orig)}</b></span>
        <span class="muted">После сжатия: <b style="color:var(--accent)">${blob ? fmtBytes(blob.size) : '…'}</b> · ${W}×${H}</span>
        <${Btn} kind="sm ghost" icon="upload" onClick=${() => input.current.click()}>Другое фото</${Btn}></div>
    </div>`}
  </${Modal}>`;
}

/** Карточка в настройках сервера: обложка и значок. */
export function CoverCard({ s, reload }) {
  const [open, setOpen] = useState(null);
  const done = () => { setOpen(null); reload(); };
  return html`<div class="card col"><h2 style="margin:0">Оформление сервера</h2>
    <div class="col" style="gap:10px"><div class="row wrap"><h3 class="grow">Значок</h3>
        <${Btn} kind="sm" icon="upload" onClick=${() => setOpen('logo')}>${s.logo ? 'Изменить' : 'Загрузить'}</${Btn}></div>
      <div class="logo-prev"><${Avatar} s=${s} lg=${true} />
        <span class="muted">${s.logo ? 'Показывается вместо буквы на карточке и в заголовке сервера. Свечение подобрано автоматически по цветам изображения.'
          : 'Пока используется стандартный значок. Загрузите логотип сервера, и он заменит его.'}</span></div></div>
    <div class="col" style="gap:10px"><div class="row wrap"><h3 class="grow">Обложка</h3>
        <${Btn} kind="sm" icon="upload" onClick=${() => setOpen('cover')}>${s.cover ? 'Изменить' : 'Загрузить фото'}</${Btn}></div>
      ${s.cover ? html`<div class="hero" style=${`background-image:url(${coverUrl(s)});height:150px`}></div>
          <small class="muted">Размер на диске: ${fmtBytes(s.cover.bytes || 0)}. Показывается на карточке сервера и в его заголовке.</small>`
        : html`<span class="muted">Широкое фото для карточки сервера. Его можно обрезать, увеличить и сжать прямо здесь.</span>`}</div>
    ${open && html`<${CoverEditor} s=${s} kind=${open} onClose=${() => setOpen(null)} onSaved=${done} />`}
  </div>`;
}

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const ls = p => { try { return fs.readdirSync(p); } catch { return []; } };
const exists = p => { try { fs.accessSync(p); return true; } catch { return false; } };
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const read = (p, max = 262144) => {
  try {
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(Math.min(max, fs.fstatSync(fd).size));
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch { return null; }
};
const MC = /^(?:1\.\d{1,2}(?:\.\d{1,2})?|\d{2}\.\d{1,2}(?:\.\d{1,2})?)$/;
const cmpVer = (a, b) => {
  const x = a.split(/[.-]/).map(n => parseInt(n) || 0), y = b.split(/[.-]/).map(n => parseInt(n) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};
const highest = names => [...names].sort(cmpVer).pop();

/* Минимальный разбор NBT (level.dat), нужен только для поля Version.Name. */
export function parseNbt(buf) {
  let o = 0;
  const s = () => { const n = buf.readUInt16BE(o); o += 2; const v = buf.toString('utf8', o, o + n); o += n; return v; };
  const payload = t => {
    switch (t) {
      case 1: return buf.readInt8(o++);
      case 2: { const v = buf.readInt16BE(o); o += 2; return v; }
      case 3: { const v = buf.readInt32BE(o); o += 4; return v; }
      case 4: { const v = buf.readBigInt64BE(o); o += 8; return String(v); }
      case 5: { const v = buf.readFloatBE(o); o += 4; return v; }
      case 6: { const v = buf.readDoubleBE(o); o += 8; return v; }
      case 7: { const n = buf.readInt32BE(o); o += 4 + n; return null; }
      case 8: return s();
      case 9: {
        const it = buf.readInt8(o++), n = buf.readInt32BE(o); o += 4;
        const a = [];
        for (let i = 0; i < n; i++) a.push(payload(it));
        return a;
      }
      case 10: {
        const c = {};
        for (;;) {
          const tt = buf.readInt8(o++);
          if (tt === 0) return c;
          const k = s();
          c[k] = payload(tt);
        }
      }
      case 11: { const n = buf.readInt32BE(o); o += 4 + 4 * n; return null; }
      case 12: { const n = buf.readInt32BE(o); o += 4 + 8 * n; return null; }
      default: throw new Error('bad nbt');
    }
  };
  if (buf.readInt8(o++) !== 10) throw new Error('bad nbt');
  s();
  return payload(10);
}

function levelVersion(dir) {
  let level = 'world';
  const props = read(path.join(dir, 'server.properties'), 65536);
  const m = props && /^level-name=(.*)$/m.exec(props);
  if (m && m[1].trim() && !/[\\/]|\.\./.test(m[1])) level = m[1].trim();
  const f = path.join(dir, level, 'level.dat');
  if (!exists(f)) return { hasWorld: false, level };
  try {
    const st = fs.statSync(f);
    if (st.size > 5 * 1024 * 1024) return { hasWorld: true, level };
    const data = parseNbt(zlib.gunzipSync(fs.readFileSync(f))).Data || {};
    return { hasWorld: true, level, name: data.Version?.Name || null, levelName: data.LevelName || null };
  } catch { return { hasWorld: true, level }; }
}

export function detect(dir) {
  const ev = [];
  const out = { type: null, version: null, loaderVersion: '', evidence: ev, warnings: [] };
  const setVersion = (v, src) => {
    if (!v || !MC.test(v)) return;
    ev.push(`${src}: Minecraft ${v}`);
    if (!out.version) out.version = v;
  };
  const setType = (t, src, extra = '') => {
    ev.push(`${src}: ${t}${extra ? ' ' + extra : ''}`);
    if (!out.type) out.type = t;
  };
  const root = ls(dir);
  const rootJars = root.filter(n => /\.jar$/i.test(n));

  // 1. manifest.json сборки CurseForge
  const man = root.includes('manifest.json') ? read(path.join(dir, 'manifest.json')) : null;
  if (man) {
    try {
      const j = JSON.parse(man);
      if (j.minecraft?.version && j.manifestType === 'minecraftModpack') {
        const ld = (j.minecraft.modLoaders || []).find(l => l.primary) || j.minecraft.modLoaders?.[0];
        const [lt, ...lv] = String(ld?.id || '').split('-');
        const T = { forge: 'FORGE', fabric: 'FABRIC', neoforge: 'NEOFORGE' }[lt];
        if (T) { setType(T, 'manifest.json'); out.loaderVersion = lv.join('-'); }
        setVersion(j.minecraft.version, 'manifest.json');
        if (!ls(path.join(dir, 'mods')).some(n => /\.jar$/i.test(n))) {
          out.warnings.push('Это клиентская сборка CurseForge: в ней нет самих модов, только список. Для сервера нужен «Server Pack» со страницы сборки.');
        }
      }
    } catch {}
  }

  // 2. NeoForge
  const neo = ls(path.join(dir, 'libraries/net/neoforged/neoforge'));
  if (neo.length) {
    const v = highest(neo);
    const p = v.split('.');
    const major = +p[0], minor = +p[1];
    const mc = major >= 26 ? `${major}.${minor}` : minor ? `1.${major}.${minor}` : `1.${major}`;
    setType('NEOFORGE', 'libraries/neoforge', v);
    if (!out.loaderVersion) out.loaderVersion = v;
    setVersion(mc, 'версия NeoForge ' + v);
  }
  // 3. Forge
  const forgeDirs = ls(path.join(dir, 'libraries/net/minecraftforge/forge'));
  if (forgeDirs.length) {
    const d = [...forgeDirs].sort().pop();
    const i = d.indexOf('-');
    if (i > 0) {
      setType('FORGE', 'libraries/forge', d.slice(i + 1));
      if (!out.loaderVersion) out.loaderVersion = d.slice(i + 1).split('-')[0];
      setVersion(d.slice(0, i), 'libraries/forge');
    }
  }
  for (const n of rootJars) {
    const m = /^forge-(\d\.\d{1,2}(?:\.\d{1,2})?)-(\d+(?:\.\d+)*)/i.exec(n);
    if (m) { setType('FORGE', n); if (!out.loaderVersion) out.loaderVersion = m[2]; setVersion(m[1], n); }
  }
  // 4. Fabric
  const fabLoader = ls(path.join(dir, 'libraries/net/fabricmc/fabric-loader'));
  if (fabLoader.length || exists(path.join(dir, '.fabric')) || exists(path.join(dir, 'fabric-server-launch.jar')) ||
      exists(path.join(dir, 'fabric-server-launcher.properties'))) {
    setType('FABRIC', 'признаки Fabric');
    if (fabLoader.length && !out.loaderVersion) out.loaderVersion = highest(fabLoader);
    const inter = ls(path.join(dir, 'libraries/net/fabricmc/intermediary'));
    if (inter.length) setVersion(highest(inter), 'libraries/fabric intermediary');
  }
  // 5. Paper / Purpur
  for (const n of rootJars) {
    const m = /^(paper|purpur|folia)-(\d[\w.]*?)-\d+\.jar$/i.exec(n);
    if (m) { setType(m[1].toLowerCase() === 'purpur' ? 'PURPUR' : 'PAPER', n); setVersion(m[2], n); }
  }
  const vh = read(path.join(dir, 'version_history.json'), 8192);
  if (vh) {
    const m = /MC:\s*(\d[\w.]*)\)/.exec(vh);
    if (m) { setVersion(m[1], 'version_history.json'); setType('PAPER', 'version_history.json'); }
  }
  if (exists(path.join(dir, 'purpur.yml'))) setType('PURPUR', 'purpur.yml');
  if (exists(path.join(dir, 'config/paper-global.yml')) || exists(path.join(dir, 'paper.yml'))) setType('PAPER', 'конфиг Paper');
  if (exists(path.join(dir, 'spigot.yml')) && exists(path.join(dir, 'bukkit.yml'))) {
    ev.push('spigot.yml и bukkit.yml: плагинный сервер (будет Paper)');
    if (!out.type) out.type = 'PAPER';
  }
  // 6. Vanilla и общие имена jar
  for (const n of rootJars) {
    const m = /(?:minecraft[_-]server|server)[._-](\d[\w.]*?)\.jar$/i.exec(n);
    if (m) setVersion(m[1], n);
  }
  const vdirs = ls(path.join(dir, 'versions')).filter(n => MC.test(n));
  if (vdirs.length) setVersion(highest(vdirs), 'папка versions');
  if (!out.type && (root.includes('server.jar') || rootJars.some(n => /minecraft[_-]server/i.test(n)) || vdirs.length)) {
    setType('VANILLA', 'файл сервера Mojang');
  }
  // 7. Журнал
  const log = read(path.join(dir, 'logs/latest.log'), 65536);
  if (log) {
    const m = /Starting minecraft server version (\S+)/.exec(log);
    if (m) setVersion(m[1], 'logs/latest.log');
    const f = /Loading Minecraft (\S+) with Fabric Loader (\S+)/.exec(log);
    if (f) { setVersion(f[1], 'logs/latest.log'); setType('FABRIC', 'logs/latest.log'); if (!out.loaderVersion) out.loaderVersion = f[2]; }
  }
  // 8. level.dat
  const lv = levelVersion(dir);
  if (lv.name) setVersion(lv.name, `${lv.level}/level.dat`);

  const count = d => ls(path.join(dir, d)).filter(n => /\.jar$/i.test(n)).length;
  out.hasWorld = !!lv.hasWorld;
  out.modsCount = count('mods');
  out.pluginsCount = count('plugins');
  if (!out.type && out.modsCount) {
    ev.push(`в папке mods ${out.modsCount} файлов, загрузчик определить не удалось`);
  }
  if (!out.type && out.pluginsCount) { out.type = 'PAPER'; ev.push(`в папке plugins ${out.pluginsCount} файлов: плагинный сервер`); }
  if (!out.version) out.warnings.push('Версию Minecraft определить не удалось. Укажите её вручную.');
  if (!out.type) out.warnings.push('Тип сервера определить не удалось. Выберите его вручную.');
  return out;
}

import fs from 'fs';
import path from 'path';
import * as dk from './dock.js';
import * as M from '../public/mc.js';

/* Чат сервера. Реплики игроков берём из журнала контейнера, а сообщения, отправленные из панели
   командой tellraw, в журнал не попадают: их запоминаем отдельно. */

const sent = new Map();           // id -> [{ t, k:'chat', name, text, fmt:true }]
const MAX_SENT = 200;

function demux(buf) {
  let o = 0, out = '';
  while (o + 8 <= buf.length) {
    const n = buf.readUInt32BE(o + 4);
    out += buf.subarray(o + 8, o + 8 + n).toString('utf8');
    o += 8 + n;
  }
  return out;
}

const LINE = /^(\d{4}-\d\d-\d\dT[\d:.]+Z) (?:\[[^\]]*\] )?\[([^\]/]*)\/INFO\](?: \[[^\]]*\])?: (.*)$/;
const NICK = '[A-Za-z0-9_.]{1,32}';
const DEATH = new RegExp(`^(.{1,80}?) (was |fell |drowned|died|starved to death|suffocated|burned to death|blew up|hit the ground|tried to swim|went up in flames|withered away|experienced kinetic energy|discovered the floor|walked into|got finished|didn't want to live|froze to death|left the confines|walked on danger|was killed|was slain|was shot|was pricked|was squashed|was fireballed|was impaled|was skewered|was stung|was blown|was struck|was obliterated|was poked|was roasted|was doomed|was burned|was pummeled|was squished|was killed|was killed)`);

// Paper и Purpur пишут строки без имени потока: «[12:32:20 INFO]: …»
const PAPER = /^(\d{4}-\d\d-\d\dT[\d:.]+Z) \[\d\d:\d\d:\d\d INFO\]: (.*)$/;
const tokens = s => String(s).split(/[^A-Za-z0-9_.]+/).filter(Boolean).map(x => x.toLowerCase());

/** Разбор текста журнала в события чата. known: ники игроков, которых сервер уже видел (нужны, чтобы отличить реплику
    чата без скобок «[ADMIN] Ник: текст» от обычных строк журнала на Paper). */
export function parseLog(text, known = []) {
  const out = [], seen = new Set(known.map(n => String(n).toLowerCase()));
  for (const raw of text.split('\n')) {
    const clean = raw.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r$/, '');
    let m = LINE.exec(clean), ts, thread, msgRaw;
    if (m) {
      [, ts, thread, msgRaw] = m;
      if (!/^(Server thread|Async Chat Thread.*|Worker-Main.*)$/.test(thread)) continue;
    } else if ((m = PAPER.exec(clean))) { ts = m[1]; thread = ''; msgRaw = m[2]; }
    else continue;
    const t = Date.parse(ts);
    if (!t) continue;
    const msg = msgRaw.replace(/^\[Not Secure\] /, '');
    let x;
    if ((x = /^<(.+?)> (.*)$/.exec(msg))) out.push({ t, k: 'chat', name: x[1], text: x[2] });
    // «[ADMIN] Ник (строитель): сообщение» — формат чата без скобок (EssentialsX Chat); такие строки пишет поток чата
    else if ((x = /^(.+?): (.*)$/.exec(msg)) && (/^Async Chat Thread/.test(thread) || (thread === '' && tokens(x[1]).some(w => seen.has(w))))) out.push({ t, k: 'chat', name: x[1], text: x[2] });
    else if ((x = /^\[(Server|Rcon)\] (.*)$/.exec(msg))) out.push({ t, k: 'say', name: x[1] === 'Rcon' ? 'Сервер' : 'Сервер', text: x[2] });
    else if ((x = new RegExp(`^(.{1,80}) joined the game$`).exec(msg))) { seen.add(x[1].toLowerCase()); out.push({ t, k: 'join', name: x[1], text: msg }); }
    else if ((x = new RegExp(`^(.{1,80}) left the game$`).exec(msg))) out.push({ t, k: 'leave', name: x[1], text: msg });
    else if ((x = new RegExp(`^(.{1,80}?) has (made the advancement|completed the challenge|reached the goal) \\[(.+)\\]$`).exec(msg))) out.push({ t, k: 'adv', name: x[1], text: msg });
    else if ((x = DEATH.exec(msg))) out.push({ t, k: 'death', name: x[1], text: msg });
  }
  return out;
}

/** Настоящий ник по отображаемому имени «[Админ] Steve (строитель)»: команда list и чат показывают имя вместе с припиской команды. */
export function resolveNick(display, tags, sample = []) {
  const d = String(display ?? '').trim();
  if (/^[A-Za-z0-9_.]{1,32}$/.test(d)) return d;
  const low = d.toLowerCase();
  const isCh = c => /[A-Za-z0-9_.]/.test(c || ' ');
  const names = [...new Set([...sample, ...Object.keys(tags || {})])].sort((a, b) => b.length - a.length);
  for (const n of names) {
    const nl = n.toLowerCase();
    for (let i = low.indexOf(nl); i !== -1; i = low.indexOf(nl, i + 1)) {
      if (!isCh(d[i - 1]) && !isCh(d[i + n.length])) return d.slice(i, i + n.length);
    }
  }
  const tok = d.split(/\s+/).filter(t => /^[A-Za-z0-9_.]{3,32}$/.test(t));
  return tok.length === 1 ? tok[0] : null;
}

/** Ники, которые сервер уже видел: файл usercache.json и приписки панели. */
function knownNicks(cfg) {
  const names = new Set(Object.keys(cfg.tags || {}));
  try {
    for (const e of JSON.parse(fs.readFileSync(path.join(dk.serverDir(cfg.id), 'usercache.json'), 'utf8'))) if (e?.name) names.add(e.name);
  } catch {}
  return [...names];
}

export async function history(cfg, after) {
  const opts = { stdout: true, stderr: true, timestamps: true };
  if (after) opts.since = Math.max(0, Math.floor(after / 1000) - 1);
  else opts.tail = 20000;
  let events = [];
  try {
    const buf = await dk.docker.getContainer(dk.cname(cfg.id)).logs(opts);
    events = parseLog(Buffer.isBuffer(buf) ? demux(buf) : String(buf), knownNicks(cfg));
  } catch (e) { if (e.statusCode !== 404) throw e; }
  const keep = [];
  for (const e of events) {
    if (e.k === 'chat') e.nick = resolveNick(e.name, cfg.tags) || undefined;
    else if (e.k !== 'say') { e.nick = resolveNick(e.name, cfg.tags) || undefined; if (!e.nick) continue; }   // входы, выходы, достижения и смерти показываем только для игроков
    keep.push(e);
  }
  events = keep;
  const mine = sent.get(cfg.id) || [];
  const all = [...events, ...mine].sort((a, b) => a.t - b.t);
  return (after ? all.filter(e => e.t > after) : all).slice(-500);
}

const SPACE = { text: ' ' };
export async function send(cfg, nameSrc, textSrc) {
  const name = String(nameSrc || '').replace(/[\r\n§]/g, ' ').trim() || 'Сервер';
  const text = String(textSrc || '').replace(/[\r\n§]/g, ' ').trim();
  if (!text) throw Object.assign(new Error('Введите сообщение'), { status: 400 });
  if (text.length > 240 || M.strip(name).length > 24) throw Object.assign(new Error('Слишком длинное сообщение или имя'), { status: 400 });
  // при чате без скобок сообщение из панели выглядит так же, как остальные: «Имя: текст»
  const json = cfg.groups?.chat
    ? [...M.toComponents(name), { text: ': ', color: 'gray' }, ...M.toComponents(text)]
    : [{ text: '<', color: 'white' }, ...M.toComponents(name), { text: '> ', color: 'white' }, ...M.toComponents(text)];
  const out = await dk.rcon(cfg.id, `tellraw @a ${JSON.stringify(json)}`);
  if (/unknown or incomplete|incorrect argument|expected|invalid/i.test(out)) throw Object.assign(new Error(out.split('\n')[0]), { status: 400 });
  const list = sent.get(cfg.id) || [];
  list.push({ t: Date.now(), k: 'chat', name, text, fmt: true });
  if (list.length > MAX_SENT) list.shift();
  sent.set(cfg.id, list);
}

import crypto from 'crypto';
import { pipeline } from 'stream';
import * as store from './store.js';
import * as dk from './dock.js';
import * as nodes from './nodes.js';
import * as transfer from './transfer.js';

/* Перенос сервера между машинами (эта машина ↔ нода ↔ нода).
   Главная панель ведёт процесс и сама ничего не хранит: останавливает сервер, берёт поток tar.gz у источника
   и сразу отдаёт его цели, потом цель создаёт сервер. Исходный сервер остаётся нетронутым (остановленным),
   пока перенос не завершится успешно; удалить его после переноса можно по желанию. */

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LOCAL = 'Эта машина';

const jobs = new Map();
const pub = j => ({
  id: j.id, serverId: j.serverId, name: j.name, from: j.from, to: j.to, stage: j.stage, text: j.text,
  bytes: j.bytes, error: j.error, done: j.done, newId: j.newId, note: j.note,
  deleteSource: j.deleteSource, startedAt: j.startedAt, finishedAt: j.finishedAt,
});

export function register(r, ctx) {
  const { h, view, finishStaged, portable, removeServer, busy } = ctx;
  const localCfg = id => store.get().servers.find(s => s.id === id) || null;

  /* Одинаковый набор действий для обеих сторон: n === null означает «эта машина». */
  const side = {
    portable: async (n, id) => (n ? nodes.json(n, 'GET', `/servers/${id}/portable`, undefined, 30000) : portable(localCfg(id))),
    state: async (n, id) => (n ? (await nodes.json(n, 'GET', `/servers/${id}`)).state : dk.stateOf(await dk.inspect(id))),
    async stop(n, id) {
      if (!n) return dk.stop(id);
      await nodes.json(n, 'POST', `/servers/${id}/action`, { action: 'stop' });
      for (let i = 0; i < 90; i++) {
        await sleep(2000);
        const st = await side.state(n, id);
        if (st === 'stopped' || st === 'missing') return;
      }
      throw bad('Сервер не остановился за 3 минуты');
    },
    async start(n, id) {
      if (n) return nodes.json(n, 'POST', `/servers/${id}/action`, { action: 'start' });
      return dk.start(localCfg(id));
    },
    async open(n, id) {
      if (!n) {
        const x = transfer.exportStream(id);
        if (!x) throw bad('Папка сервера на этой машине не найдена');
        x.done.then(d => { if (!d.ok) x.stream.destroy(new Error('Не удалось упаковать сервер: ' + d.err.slice(0, 200))); });
        return { stream: x.stream, abort: x.kill };
      }
      const res = await nodes.raw(n, 'GET', `/servers/${id}/export`, { timeout: 600e3 });
      return { stream: res.body, abort: () => res.body.destroy() };
    },
    begin: async (n, config) => (n ? (await nodes.json(n, 'POST', '/migrate/begin', { config }, 60000)).token : transfer.begin(config)),
    async send(n, token, stream) {
      if (!n) return transfer.receive(token, stream);
      const res = await nodes.raw(n, 'PUT', `/migrate/${token}/data`, {
        body: stream, headers: { 'content-type': 'application/gzip' }, timeout: 6 * 3600e3,
      });
      try { return JSON.parse(await res.body.text() || '{}'); } catch { return {}; }
    },
    finish: async (n, token, opts) => (n ? nodes.json(n, 'POST', `/migrate/${token}/finish`, opts, 120000) : finishStaged(token, opts)),
    abort: async (n, token) => { try { if (n) await nodes.json(n, 'DELETE', '/import/' + token); else transfer.discard(token); } catch {} },
    remove: async (n, id) => { if (n) await nodes.json(n, 'DELETE', `/servers/${id}?data=1`, undefined, 120000); else await removeServer(localCfg(id), true); },
  };

  async function runJob(job, src, dst, opts) {
    const id = job.serverId;
    const set = (stage, text) => { job.stage = stage; job.text = text; };
    let token = null, stopped = false, wasRunning = false;
    if (!src) busy.set(id, 'Перенос на другую машину…');
    try {
      set('prepare', 'Подготовка');
      const pf = await side.portable(src, id);
      job.name = pf.name;
      const st = await side.state(src, id);
      wasRunning = st === 'running' || st === 'starting';
      if (wasRunning) { set('stop', 'Остановка сервера'); await side.stop(src, id); stopped = true; }

      set('transfer', 'Передача файлов');
      token = await side.begin(dst, pf);
      const { stream, abort } = await side.open(src, id);
      const counted = transfer.counter(n => { job.bytes += n; });
      pipeline(stream, counted, err => { if (err) counted.destroy(err); });
      try { await side.send(dst, token, counted); }
      catch (e) { abort(); throw e; }

      set('finish', 'Создание сервера на новой машине');
      const created = await side.finish(dst, token, { start: wasRunning && opts.start });
      token = null;
      job.newId = created.id;
      if (dst) { nodes.place(created.id, dst.id); await nodes.refresh(dst); }

      if (opts.deleteSource) {
        set('cleanup', 'Удаление исходного сервера');
        try { await side.remove(src, id); if (src) { nodes.unplace(id); await nodes.refresh(src); } }
        catch (e) { job.note = 'Сервер перенесён, но исходный удалить не удалось: ' + e.message; }
      } else job.note = 'Исходный сервер остановлен и сохранён на прежней машине. Удалите его, когда убедитесь, что всё работает.';
      job.done = true;
      set('done', 'Готово');
    } catch (e) {
      job.error = e.message || 'Ошибка переноса';
      set('failed', 'Ошибка');
      if (token) await side.abort(dst, token);
      if (stopped && wasRunning) {
        try { await side.start(src, id); job.note = 'Исходный сервер запущен обратно, данные не затронуты.'; }
        catch { job.note = 'Исходный сервер остановлен, данные не затронуты. Запустите его вручную.'; }
      } else job.note = 'Исходный сервер не изменён.';
    } finally {
      if (!src) busy.delete(id);
      job.finishedAt = Date.now();
    }
  }

  r.post('/migrations', h(async (req, res) => {
    const { serverId, to, deleteSource, start } = req.body || {};
    if (!/^[a-f0-9]{8}$/.test(String(serverId))) throw bad('Не указан сервер');
    for (const [k, j] of jobs) if (j.finishedAt && Date.now() - j.finishedAt > 3600e3) jobs.delete(k);
    if ([...jobs.values()].some(j => j.serverId === serverId && !j.finishedAt)) throw bad('Этот сервер уже переносится', 409);

    let src = null;
    if (!localCfg(serverId)) {
      src = await nodes.locate(serverId);
      if (!src) throw bad('Сервер не найден', 404);
    }
    let dst = null;
    if (to && to !== 'local') {
      dst = nodes.get(String(to));
      if (!dst) throw bad('Нода назначения не найдена', 404);
    }
    if ((src ? src.id : 'local') === (dst ? dst.id : 'local')) throw bad('Сервер уже находится на этой машине');
    for (const n of [src, dst].filter(Boolean)) {
      const st = await nodes.refresh(n);
      if (!st.online) throw bad(`Нода «${n.name}» недоступна`, 502);
      nodes.requireNew(n);
    }
    if (localCfg(serverId) && busy.has(serverId)) throw bad('Сервер занят: ' + busy.get(serverId), 409);

    const job = {
      id: crypto.randomBytes(6).toString('hex'), serverId, name: '', from: src ? src.name : LOCAL, to: dst ? dst.name : LOCAL,
      stage: 'prepare', text: 'Подготовка', bytes: 0, error: null, done: false, newId: null, note: '',
      deleteSource: !!deleteSource, startedAt: Date.now(), finishedAt: null,
    };
    jobs.set(job.id, job);
    runJob(job, src, dst, { deleteSource: !!deleteSource, start: start !== false });
    res.json(pub(job));
  }));

  r.get('/migrations', h(async (req, res) => {
    const list = [...jobs.values()].filter(j => !req.query.server || j.serverId === req.query.server);
    res.json(list.sort((a, b) => b.startedAt - a.startedAt).map(pub));
  }));
  r.get('/migrations/:jid', h(async (req, res) => {
    const j = jobs.get(req.params.jid);
    if (!j) throw bad('Перенос не найден', 404);
    res.json(pub(j));
  }));
}

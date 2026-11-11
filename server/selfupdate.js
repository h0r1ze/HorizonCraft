import fs from 'fs';
import os from 'os';
import path from 'path';
import { docker, DATA_DIR } from './dock.js';
import { VERSION } from './agent.js';
import { proxyFetch, panelEndpoint } from './net.js';

/* Обновление самой панели с GitHub. Панель раз в 6 часов (и по кнопке) смотрит последний коммит ветки main и версию
   в его package.json. Обновление выполняет вспомогательный контейнер из образа панели (server/updater.js): скачивает код,
   собирает новый образ, пересоздаёт контейнер панели и при неудаче возвращает прежний. */

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
export const REPO = process.env.HC_REPO || 'h0r1ze/HorizonCraft';
const BRANCH = process.env.HC_BRANCH || 'main';
// адреса GitHub подменяются только в автотестах
const API = process.env.HC_GITHUB_API || 'https://api.github.com';
const RAW = process.env.HC_GITHUB_RAW || 'https://raw.githubusercontent.com';
const TARBALL = sha => (process.env.HC_TARBALL ? process.env.HC_TARBALL.replace('{sha}', sha) : `https://codeload.github.com/${REPO}/tar.gz/${sha}`);
const DIR = path.join(DATA_DIR, 'update');
const INSTALLED = path.join(DIR, 'installed.json');   // { sha, version, at } — что стоит сейчас (пишет обновление)
const STATUS = path.join(DIR, 'status.json');         // ход и итог последнего обновления (пишет вспомогательный контейнер)
const EVERY = 6 * 3600e3;

/** Сравнение версий вида 1.2.0: -1, 0 или 1. */
export function cmpVer(a, b) {
  const pa = String(a || '').split(/[.+-]/).map(n => parseInt(n, 10) || 0), pb = String(b || '').split(/[.+-]/).map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  return 0;
}
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
export const installed = () => readJson(INSTALLED) || {};
export const status = () => readJson(STATUS);

let latest = null, checkedAt = 0, checkError = '', checking = null, starting = false;

async function gh(url) {
  const r = await proxyFetch(panelEndpoint(), url, { headers: { 'User-Agent': `HorizonCraft/${VERSION}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
  if (r.status === 403 || r.status === 429) throw new Error('GitHub временно ограничил запросы, проверка повторится позже');
  if (!r.ok) throw new Error(`GitHub ответил ${r.status}`);
  return r.json();
}

/** Узнаёт последнюю версию на GitHub. force: проверить сейчас, иначе не чаще раза в 6 часов. */
export function check(force = false) {
  if (checking) return checking;
  if (!force && checkedAt && Date.now() - checkedAt < EVERY) return Promise.resolve();
  checking = (async () => {
    try {
      const c = await gh(`${API}/repos/${REPO}/commits/${BRANCH}`);
      if (!/^[0-9a-f]{40}$/.test(c?.sha || '')) throw new Error('GitHub вернул неожиданный ответ');
      const pkg = await gh(`${RAW}/${REPO}/${c.sha}/package.json`);
      latest = {
        sha: c.sha, version: String(pkg.version || ''), date: c.commit?.committer?.date || c.commit?.author?.date || '',
        message: String(c.commit?.message || '').split('\n')[0].slice(0, 200), url: `https://github.com/${REPO}/commit/${c.sha}`,
      };
      checkError = '';
    } catch (e) {
      checkError = e.name === 'TimeoutError' ? 'GitHub не ответил вовремя' : e.cause?.code ? 'Нет связи с GitHub' : e.message;
    }
    checkedAt = Date.now();
  })().finally(() => { checking = null; });
  return checking;
}

/** Описание для интерфейса. */
export function info() {
  const inst = installed(), st = status();
  const newer = !!latest && cmpVer(latest.version, VERSION) > 0;
  // установленный коммит известен (после обновления из панели): новый коммит той же версии тоже считается обновлением
  const changed = !!latest && !!inst.sha && latest.sha !== inst.sha && cmpVer(latest.version, VERSION) >= 0;
  const running = starting || (st?.state === 'running' && Date.now() - (st.at || 0) < 30 * 60e3);
  return {
    version: VERSION, sha: inst.sha || '', installedAt: inst.at || null, latest, available: newer || changed, checkedAt: checkedAt || null, error: checkError,
    repo: `https://github.com/${REPO}`, running, step: running ? st?.step || '' : '', last: st && st.state !== 'running' ? st : null,
  };
}

/** Запускает обновление: вспомогательный контейнер скачает код, соберёт образ и пересоздаст панель. */
export async function start() {
  if (info().running) throw bad('Обновление уже выполняется');
  if (!latest) await check(true);
  if (!latest) throw bad(checkError || 'Не удалось узнать последнюю версию на GitHub', 502);
  let self;
  try { self = await docker.getContainer(os.hostname()).inspect(); }
  catch { throw bad('Обновление из панели работает только в установке через Docker: панель не нашла свой контейнер. Обновите её командой ./update.sh'); }
  const dir = self.Config?.Labels?.['com.docker.compose.project.working_dir'];
  const prefix = process.env.NAME_PREFIX || 'mcpanel';
  const binds = ['/var/run/docker.sock:/var/run/docker.sock', `${DATA_DIR}:${DATA_DIR}`];
  if (dir) binds.push(`${dir}:${dir}`);
  const proxy = panelEndpoint()?.http || '';
  starting = true;
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(STATUS, JSON.stringify({ state: 'running', step: 'Подготовка…', at: Date.now(), sha: latest.sha, version: latest.version, from: VERSION }));
    const c = await docker.createContainer({
      name: `${prefix}-update-${Math.random().toString(16).slice(2, 8)}`, Image: self.Config.Image, Cmd: ['node', 'server/updater.js'],
      Labels: { 'horizoncraft.role': 'update' },
      Env: [`SELF=${self.Id}`, `DATA_DIR=${DATA_DIR}`, `SHA=${latest.sha}`, `TARBALL=${TARBALL(latest.sha)}`, `FROM_VERSION=${VERSION}`, ...(proxy ? [`DL_PROXY=${proxy}`] : [])],
      HostConfig: { Binds: binds, AutoRemove: true, RestartPolicy: { Name: 'no' }, Memory: 512 * 1024 * 1024, ...(self.HostConfig.NetworkMode && self.HostConfig.NetworkMode !== 'default' ? { NetworkMode: self.HostConfig.NetworkMode } : {}) },
    });
    await c.start();
  } catch (e) {
    fs.writeFileSync(STATUS, JSON.stringify({ state: 'error', error: 'Не удалось запустить обновление: ' + e.message, at: Date.now(), from: VERSION }));
    throw bad('Не удалось запустить обновление: ' + e.message, 500);
  } finally { starting = false; }
  return info();
}

export function startChecks() {
  setTimeout(() => check(true).catch(() => {}), 20e3).unref?.();
  setInterval(() => check().catch(() => {}), 30 * 60e3).unref?.();
}

export function register(r, { h }) {
  r.get('/panel/update', (req, res) => { check().catch(() => {}); res.json(info()); });
  r.post('/panel/update/check', h(async (req, res) => { await check(true); res.json(info()); }));
  r.post('/panel/update', h(async (req, res) => res.json(await start())));
}

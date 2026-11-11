import { fetch as ufetch, ProxyAgent } from 'undici';
import * as store from './store.js';
import * as P from './proxy.js';
import { getGateway } from './dock.js';

/* Запросы самой панели к CurseForge. При включённом переключателе идут через выбранный узел прокси. */
const agents = new Map();

export function panelEndpoint() {
  return store.get().settings.panelProxy?.on ? P.activeEndpoint(getGateway()) : null;
}

/** Запрос напрямую (ep пустой) или через HTTP-вход выбранного узла прокси. */
export async function proxyFetch(ep, url, init = {}) {
  if (!ep) return fetch(url, init);
  let agent = agents.get(ep.http);
  if (!agent) { agent = new ProxyAgent({ uri: `http://${ep.http}`, connectTimeout: 15000 }); agents.set(ep.http, agent); }
  return ufetch(url, { ...init, dispatcher: agent });
}
export const cfFetch = (url, init = {}) => proxyFetch(panelEndpoint(), url, init);

/** Точка прокси по переключателю { on }: постоянный вход активного узла; null, если выключено или узел не выбран. */
export function endpointOf(p) {
  return p?.on ? P.activeEndpoint(getGateway()) : null;
}

/** Два пробных запроса: сам ключ и поиск. Возвращает коды ответа (0, если связи нет). */
export async function probeCurseForge(key) {
  const call = async path => {
    try {
      return (await cfFetch('https://api.curseforge.com/v1' + path, {
        headers: { 'x-api-key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(20000),
      })).status;
    } catch { return 0; }
  };
  return { games: await call('/games/432'), search: await call('/mods/search?gameId=432&pageSize=1'), viaProxy: !!panelEndpoint() };
}
export const searchState = pr => (pr.search === 200 ? true : pr.search === 403 ? false : null);

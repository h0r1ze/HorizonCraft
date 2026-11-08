import crypto from 'crypto';
import fs from 'fs';

/* Режим агента: если задан AGENT_TOKEN, эту панель можно подключить как ноду к главной панели.
   Главная панель ходит в API по заголовку Authorization: Bearer <токен>. */
export const AGENT_TOKEN = String(process.env.AGENT_TOKEN || '').trim();
export const AGENT = AGENT_TOKEN.length >= 24;
if (AGENT_TOKEN && !AGENT) console.warn('AGENT_TOKEN короче 24 символов, режим агента выключен');

export const VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version; }
  catch { return ''; }
})();

const digest = s => crypto.createHash('sha256').update(String(s)).digest();

export function agentAuth(headers) {
  if (!AGENT) return false;
  const m = /^Bearer (.+)$/.exec(headers.authorization || '');
  return !!m && crypto.timingSafeEqual(digest(m[1]), digest(AGENT_TOKEN));
}

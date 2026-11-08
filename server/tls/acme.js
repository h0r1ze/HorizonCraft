import crypto from 'crypto';
import net from 'net';
import { request, Agent } from 'undici';

/* Клиент ACME (RFC 8555) для Let's Encrypt. Написан без внешних библиотек, потому что нужны две новые возможности:
   сертификаты на IP-адрес и выбор профиля «shortlived» (160 часов), которых нет в готовых пакетах.
   Проверка владения: http-01 (порт 80). Для IP-адресов Let's Encrypt других способов не допускает. */

export const DIRECTORY = {
  production: 'https://acme-v02.api.letsencrypt.org/directory',
  staging: 'https://acme-staging-v02.api.letsencrypt.org/directory',
};

const b64u = b => Buffer.from(b).toString('base64url');
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class AcmeError extends Error {
  constructor(message, extra = {}) { super(message); this.name = 'AcmeError'; Object.assign(this, extra); }
}

export class Acme {
  /** directory: адрес каталога ACME; accountKey: KeyObject P-256; insecure: не проверять сертификат самого ACME-сервера (только для тестов). */
  constructor({ directory, accountKey, email = '', insecure = false, log = () => {} }) {
    this.directoryUrl = directory; this.key = accountKey; this.email = email; this.log = log;
    this.dispatcher = insecure ? new Agent({ connect: { rejectUnauthorized: false } }) : undefined;
    this.nonces = [];
    const jwk = accountKey.export({ format: 'jwk' });
    this.jwk = { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y };
    this.thumb = b64u(crypto.createHash('sha256').update(JSON.stringify(this.jwk)).digest());
  }

  async raw(url, opts = {}) {
    const r = await request(url, { dispatcher: this.dispatcher, headersTimeout: 30000, bodyTimeout: 60000, ...opts, headers: { 'user-agent': 'HorizonCraft', ...opts.headers } });
    const buf = Buffer.from(await r.body.arrayBuffer());
    const nonce = r.headers['replay-nonce'];
    if (nonce) this.nonces.push(nonce);
    return { status: r.statusCode, headers: r.headers, buf };
  }

  async directory() {
    if (this.dir) return this.dir;
    let r;
    try { r = await this.raw(this.directoryUrl, { method: 'GET', headers: { 'user-agent': 'HorizonCraft' } }); }
    catch (e) { throw new AcmeError(`Не удалось связаться с сервером Let's Encrypt (${e.message}). Проверьте доступ панели в интернет.`, { network: true }); }
    if (r.status !== 200) throw new AcmeError(`Каталог ACME ответил ${r.status}`);
    return (this.dir = JSON.parse(r.buf.toString('utf8')));
  }

  async nonce() {
    if (this.nonces.length) return this.nonces.pop();
    const d = await this.directory();
    const r = await this.raw(d.newNonce, { method: 'HEAD' });
    if (!r.headers['replay-nonce']) throw new AcmeError('ACME-сервер не выдал nonce');
    return this.nonces.pop();
  }

  /** Подписанный запрос. payload '' означает POST-as-GET. */
  async post(url, payload, { useJwk = false, accept } = {}) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const protectedHdr = { alg: 'ES256', nonce: await this.nonce(), url, ...(useJwk ? { jwk: this.jwk } : { kid: this.kid }) };
      const p64 = b64u(JSON.stringify(protectedHdr)), d64 = payload === '' ? '' : b64u(JSON.stringify(payload));
      const sig = crypto.sign('sha256', Buffer.from(`${p64}.${d64}`), { key: this.key, dsaEncoding: 'ieee-p1363' });
      const r = await this.raw(url, {
        method: 'POST', body: JSON.stringify({ protected: p64, payload: d64, signature: b64u(sig) }),
        headers: { 'content-type': 'application/jose+json', 'user-agent': 'HorizonCraft', ...(accept ? { accept } : {}) },
      });
      const isJson = /json/.test(String(r.headers['content-type'] || ''));
      const json = isJson ? JSON.parse(r.buf.toString('utf8') || '{}') : null;
      if (r.status >= 400) {
        if (json?.type === 'urn:ietf:params:acme:error:badNonce' && attempt < 3) continue;
        throw new AcmeError(json?.detail || `ACME ответил ${r.status}`, { type: json?.type, status: r.status, subproblems: json?.subproblems });
      }
      return { ...r, json };
    }
  }

  async account() {
    const d = await this.directory();
    const r = await this.post(d.newAccount, { termsOfServiceAgreed: true, ...(this.email ? { contact: [`mailto:${this.email}`] } : {}) }, { useJwk: true });
    this.kid = r.headers.location;
    if (!this.kid) throw new AcmeError('ACME-сервер не вернул адрес учётной записи');
    return this.kid;
  }

  /**
   * Выпуск сертификата.
   *   names: домены и IP-адреса; profile: например 'shortlived' (обязателен для IP);
   *   csr: DER-запрос; challenge: { present({identifier, token, keyAuth}) → async cleanup }.
   */
  async issue({ names, profile = '', csr, challenge, onStatus = () => {}, timeoutMs = 180000 }) {
    const d = await this.directory();
    if (!this.kid) { onStatus('Регистрация учётной записи ACME'); await this.account(); }
    const identifiers = names.map(v => ({ type: net.isIP(v) ? 'ip' : 'dns', value: v }));
    onStatus('Создание заказа на сертификат');
    const order = await this.post(d.newOrder, { identifiers, ...(profile ? { profile } : {}) });
    const orderUrl = order.headers.location;
    const cleanups = [];
    try {
      for (const url of order.json.authorizations) {
        const a = (await this.post(url, '')).json;
        if (a.status === 'valid') continue;
        const ch = a.challenges.find(c => c.type === challenge.type);
        if (!ch) throw new AcmeError(`Сервер не предлагает проверку ${challenge.type} для ${a.identifier.value}`);
        const keyAuth = `${ch.token}.${this.thumb}`;
        onStatus(`Проверка владения ${a.identifier.value}`);
        cleanups.push(await challenge.present({ identifier: a.identifier.value, token: ch.token, keyAuth }));
        await this.post(ch.url, {});
        const t0 = Date.now();
        for (;;) {
          await sleep(1500);
          const cur = (await this.post(url, '')).json;
          if (cur.status === 'valid') break;
          if (cur.status === 'invalid') {
            const err = cur.challenges.find(c => c.error)?.error;
            throw new AcmeError(`Let's Encrypt не смог проверить ${a.identifier.value}: ${err?.detail || 'проверка не пройдена'}`, { type: err?.type, validation: true });
          }
          if (Date.now() - t0 > timeoutMs) throw new AcmeError('Проверка владения не завершилась вовремя');
        }
      }
      onStatus('Выпуск сертификата');
      await this.post(order.json.finalize, { csr: b64u(csr) });
      const t1 = Date.now();
      let cur;
      for (;;) {
        cur = (await this.post(orderUrl, '')).json;
        if (cur.status === 'valid') break;
        if (cur.status === 'invalid') throw new AcmeError('Let\'s Encrypt отклонил заказ: ' + (cur.error?.detail || 'неизвестная причина'));
        if (Date.now() - t1 > timeoutMs) throw new AcmeError('Выпуск сертификата не завершился вовремя');
        await sleep(1500);
      }
      onStatus('Загрузка сертификата');
      const c = await this.post(cur.certificate, '', { accept: 'application/pem-certificate-chain' });
      return { chain: c.buf.toString('utf8'), order: cur };
    } finally {
      for (const fn of cleanups) { try { await fn?.(); } catch {} }
    }
  }
}

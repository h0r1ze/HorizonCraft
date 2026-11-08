import crypto from 'crypto';
import net from 'net';
import { seq, set, octets, bits, utf8, bool, ctx, int, oid, time, altNames, OID } from './der.js';

/* Сертификаты без внешних программ: самоподписанный, запрос на выпуск (CSR) для ACME, разбор и проверка пары
   сертификат + ключ. Ключи эллиптические (P-256): они быстрые, их принимают браузеры и Let's Encrypt, в том числе
   для сертификатов на IP-адрес. */

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });

export const pem = (label, der) => `-----BEGIN ${label}-----\n${der.toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n$/, '')}\n-----END ${label}-----\n`;
export const newKey = () => crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
export const keyPem = k => k.export({ type: 'pkcs8', format: 'pem' });
const spki = k => crypto.createPublicKey(k).export({ type: 'spki', format: 'der' });
const sign = (data, key) => crypto.sign('sha256', data, { key, dsaEncoding: 'der' });
const algId = () => seq(oid(OID.ecdsaSha256));
const name = cn => seq(...(cn ? [set(seq(oid(OID.commonName), utf8(cn)))] : []));

/** Допустимые имена: домены и IP-адреса. */
export function cleanNames(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : String(list || '').split(/[\s,;]+/)) {
    const n = String(raw).trim().toLowerCase().replace(/^\[|\]$/g, '');
    if (!n) continue;
    if (!net.isIP(n) && !/^(?=.{1,253}$)([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(n)) throw bad(`Недопустимое имя или IP-адрес: ${String(raw).slice(0, 60)}`);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** Запрос на сертификат (PKCS#10) с именами в SAN. Subject пустой: Let's Encrypt берёт имена из SAN. */
export function makeCsr(key, names) {
  const ext = seq(seq(oid(OID.subjectAltName), octets(altNames(names))));
  const attrs = ctx(0, seq(oid(OID.extensionRequest), set(ext)));
  const info = seq(int(0), name(''), spki(key), attrs);
  return seq(info, algId(), bits(sign(info, key)));
}

/** Самоподписанный сертификат для перечисленных имён и адресов. */
export function selfSigned(names, { days = 397, key = newKey() } = {}) {
  if (!names.length) throw bad('Нужно хотя бы одно имя или IP-адрес');
  const now = Date.now(), from = new Date(now - 3600e3), to = new Date(now + days * 86400e3);
  const ski = crypto.createHash('sha1').update(crypto.createPublicKey(key).export({ type: 'spki', format: 'der' })).digest();
  const exts = seq(
    seq(oid(OID.basicConstraints), bool(true), octets(seq())),
    seq(oid(OID.keyUsage), bool(true), octets(Buffer.from([0x03, 0x02, 0x07, 0x80]))),                 // digitalSignature
    seq(oid(OID.extKeyUsage), octets(seq(oid(OID.serverAuth)))),
    seq(oid(OID.subjectKeyId), octets(octets(ski))),
    seq(oid(OID.subjectAltName), octets(altNames(names))),
  );
  const subject = name(names.find(n => !net.isIP(n)) || names[0]);
  const serial = crypto.randomBytes(16); serial[0] &= 0x7f;
  const tbs = seq(ctx(0, int(2)), int(serial), algId(), subject, seq(time(from), time(to)), subject, spki(key), ctx(3, exts));
  const cert = seq(tbs, algId(), bits(sign(tbs, key)));
  return { cert: pem('CERTIFICATE', cert), key: keyPem(key) };
}

/** Сведения о первом сертификате в цепочке PEM. */
export function certInfo(certPem) {
  const x = new crypto.X509Certificate(certPem);
  const san = (x.subjectAltName || '').split(/,\s*/).filter(Boolean).map(s => s.replace(/^(DNS|IP Address):/, '')).map(s => s.trim());
  const from = new Date(x.validFrom), to = new Date(x.validTo);
  return {
    subject: x.subject.replace(/^CN=/, '') || '', issuer: x.issuer.replace(/\n/g, ', ').replace(/CN=|O=|C=/g, '').trim(),
    san, notBefore: from.getTime(), notAfter: to.getTime(), lifetimeMs: to - from,
    fingerprint: x.fingerprint256, selfSigned: x.subject === x.issuer && x.verify(x.publicKey), serial: x.serialNumber,
  };
}

/** Проверка загруженной пары: ключ подходит к сертификату, срок не вышел, цепочка читается. */
export function checkPair(certPem, keyText) {
  let x, key;
  try { x = new crypto.X509Certificate(certPem); } catch { throw bad('Не удалось прочитать сертификат. Нужен текст в формате PEM (-----BEGIN CERTIFICATE-----).'); }
  try { key = crypto.createPrivateKey(keyText); } catch { throw bad('Не удалось прочитать закрытый ключ. Нужен PEM без пароля (-----BEGIN PRIVATE KEY-----).'); }
  if (!x.checkPrivateKey(key)) throw bad('Закрытый ключ не подходит к этому сертификату');
  if (new Date(x.validTo).getTime() < Date.now()) throw bad('Срок действия сертификата уже истёк');
  if (new Date(x.validFrom).getTime() > Date.now() + 86400e3) throw bad('Срок действия сертификата ещё не начался');
  return certInfo(certPem);
}

/** Подходит ли сертификат к имени (с учётом звёздочки в первой метке домена). */
export function coversHost(info, host) {
  const h = String(host).toLowerCase();
  return info.san.some(s => { s = s.toLowerCase(); return s === h || (s.startsWith('*.') && h.split('.').slice(1).join('.') === s.slice(2) && !net.isIP(h)); });
}

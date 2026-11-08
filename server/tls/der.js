import net from 'net';

/* Минимальный кодировщик ASN.1 DER: ровно столько, сколько нужно для запроса сертификата (PKCS#10) и самоподписанного
   сертификата X.509. Подпись и разбор делает node:crypto, здесь только сборка структур. */

const len = n => {
  if (n < 0x80) return Buffer.from([n]);
  const b = [];
  for (let x = n; x > 0; x = Math.floor(x / 256)) b.unshift(x & 255);
  return Buffer.from([0x80 | b.length, ...b]);
};
export const tlv = (tag, ...parts) => {
  const body = Buffer.concat(parts.map(p => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
  return Buffer.concat([Buffer.from([tag]), len(body.length), body]);
};
export const seq = (...p) => tlv(0x30, ...p);
export const set = (...p) => tlv(0x31, ...p);
export const octets = b => tlv(0x04, b);
export const bits = b => tlv(0x03, Buffer.from([0]), b);
export const utf8 = s => tlv(0x0c, Buffer.from(String(s), 'utf8'));
export const bool = v => tlv(0x01, Buffer.from([v ? 0xff : 0]));
export const ctx = (n, ...p) => tlv(0xa0 | n, ...p);          // [n] составной
export const ctxPrim = (n, b) => tlv(0x80 | n, b);              // [n] простой (неявный тип)

/** Целое неотрицательное: число или Buffer. */
export function int(v) {
  let b = Buffer.isBuffer(v) ? v : Buffer.from(v.toString(16).padStart(Math.ceil(v.toString(16).length / 2) * 2, '0'), 'hex');
  while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b = b.subarray(1);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}

export function oid(s) {
  const a = s.split('.').map(Number);
  const out = [a[0] * 40 + a[1]];
  for (const n of a.slice(2)) {
    const t = [n & 0x7f];
    for (let x = n >> 7; x > 0; x >>= 7) t.unshift((x & 0x7f) | 0x80);
    out.push(...t);
  }
  return tlv(0x06, Buffer.from(out));
}

const two = n => String(n).padStart(2, '0');
/** UTCTime (до 2049 года), GeneralizedTime дальше. */
export function time(d) {
  const y = d.getUTCFullYear(), rest = `${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}${two(d.getUTCHours())}${two(d.getUTCMinutes())}${two(d.getUTCSeconds())}Z`;
  return y < 2050 ? tlv(0x17, Buffer.from(String(y).slice(2) + rest)) : tlv(0x18, Buffer.from(y + rest));
}

/** Байты IP-адреса для SAN: 4 для IPv4, 16 для IPv6. */
export function ipBytes(ip) {
  const v = net.isIP(ip);
  if (v === 4) return Buffer.from(ip.split('.').map(Number));
  if (v !== 6) throw new Error('Это не IP-адрес: ' + ip);
  let s = ip.replace(/%.*$/, '');
  const m4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (m4) { const q = m4[1].split('.').map(Number); s = s.slice(0, -m4[1].length) + ((q[0] << 8) | q[1]).toString(16) + ':' + ((q[2] << 8) | q[3]).toString(16); }
  const [h, t] = s.split('::');
  const head = h ? h.split(':') : [], tail = t ? t.split(':') : [];
  const mid = new Array(8 - head.length - tail.length).fill('0');
  const w = [...head, ...(s.includes('::') ? mid : []), ...tail].map(x => parseInt(x || '0', 16));
  const out = Buffer.alloc(16);
  w.forEach((x, i) => out.writeUInt16BE(x, i * 2));
  return out;
}

export const OID = {
  ecdsaSha256: '1.2.840.10045.4.3.2', commonName: '2.5.4.3', subjectAltName: '2.5.29.17', basicConstraints: '2.5.29.19',
  keyUsage: '2.5.29.15', extKeyUsage: '2.5.29.37', serverAuth: '1.3.6.1.5.5.7.3.1', subjectKeyId: '2.5.29.14',
  extensionRequest: '1.2.840.113549.1.9.14',
};

/** SAN: имена DNS и IP-адреса. */
export function altNames(names) {
  return seq(...names.map(n => (net.isIP(n) ? ctxPrim(7, ipBytes(n)) : ctxPrim(2, Buffer.from(n, 'ascii')))));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOST = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const TEXT = /^[^\r\n\0]{0,300}$/;

/** Разбирает ссылку vless:// и возвращает исходящее подключение xray и краткое описание. */
export function vlessOutbound(raw, tag = 'proxy') {
  const link = String(raw || '').trim();
  if (!/^vless:\/\//i.test(link)) throw new Error('Ссылка должна начинаться с vless://');
  if (link.length > 2000 || /[\r\n]/.test(link)) throw new Error('Ссылка слишком длинная или содержит переносы строк');
  let u;
  try { u = new URL(link); } catch { throw new Error('Не удалось разобрать ссылку vless://'); }
  const id = decodeURIComponent(u.username);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const port = Number(u.port || 443);
  if (!UUID.test(id)) throw new Error('В ссылке неверный идентификатор пользователя (UUID)');
  if (!(HOST.test(host) || /^[0-9a-f:]+$/i.test(host))) throw new Error('В ссылке неверный адрес сервера');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('В ссылке неверный порт');

  const q = u.searchParams;
  const get = (k, d = '') => {
    const v = q.get(k) ?? d;
    if (!TEXT.test(v)) throw new Error(`Недопустимое значение параметра ${k}`);
    return v;
  };
  const type = get('type', 'tcp').toLowerCase();
  const security = get('security', 'none').toLowerCase();
  if (!['tcp', 'ws', 'grpc', 'http', 'h2', 'httpupgrade', 'xhttp', 'splithttp'].includes(type)) throw new Error(`Транспорт ${type} не поддерживается`);
  if (!['none', 'tls', 'reality'].includes(security)) throw new Error(`Защита ${security} не поддерживается`);
  if (security === 'none') throw new Error('VLESS без шифрования (security=none) небезопасен, и xray его не принимает. Нужна ссылка с security=tls или security=reality.');

  const stream = { network: type === 'http' ? 'h2' : type === 'splithttp' ? 'xhttp' : type, security };
  if (security === 'tls') {
    stream.tlsSettings = {
      serverName: get('sni') || get('host') || host,
      fingerprint: get('fp', 'chrome'),
      ...(get('alpn') ? { alpn: get('alpn').split(',') } : {}),
    };
  } else {
    if (!get('pbk')) throw new Error('Для Reality в ссылке нужен публичный ключ (pbk)');
    if (!get('sni')) throw new Error('Для Reality в ссылке нужен параметр sni');
    stream.realitySettings = {
      serverName: get('sni'), fingerprint: get('fp', 'chrome'),
      publicKey: get('pbk'), shortId: get('sid'), spiderX: get('spx'),
    };
  }
  const path = get('path', '/'), hostHdr = get('host');
  if (stream.network === 'ws') stream.wsSettings = { path, ...(hostHdr ? { headers: { Host: hostHdr } } : {}) };
  else if (stream.network === 'grpc') stream.grpcSettings = { serviceName: get('serviceName'), multiMode: get('mode') === 'multi' };
  else if (stream.network === 'httpupgrade') stream.httpupgradeSettings = { path, ...(hostHdr ? { host: hostHdr } : {}) };
  else if (stream.network === 'xhttp') stream.xhttpSettings = { path, ...(hostHdr ? { host: hostHdr } : {}), ...(get('mode') ? { mode: get('mode') } : {}) };
  else if (stream.network === 'h2') stream.httpSettings = { path, ...(hostHdr ? { host: [hostHdr] } : {}) };

  const flow = get('flow');
  const outbound = {
    tag, protocol: 'vless',
    settings: { vnext: [{ address: host, port, users: [{ id, encryption: get('encryption', 'none'), ...(flow ? { flow } : {}) }] }] },
    streamSettings: stream,
  };
  const mask = host.length > 8 ? host.slice(0, 3) + '***' + host.slice(-4) : host;
  let name = '';
  try { name = decodeURIComponent(u.hash.replace(/^#/, '')); } catch { name = u.hash.replace(/^#/, ''); }
  return { outbound, summary: { host: mask, port, network: stream.network, security, name: name.slice(0, 80) } };
}

/** Один узел, оформленный как отдельный конфиг xray (нужен для проверки ссылки). */
export function parseVless(raw) {
  const { outbound, summary } = vlessOutbound(raw);
  return {
    summary,
    config: {
      log: { loglevel: 'warning' },
      inbounds: [{ tag: 'http-in', listen: '0.0.0.0', port: 10809, protocol: 'http', settings: { allowTransparent: false } }],
      outbounds: [outbound, { tag: 'direct', protocol: 'freedom' }],
    },
  };
}

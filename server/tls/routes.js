import * as T from './index.js';
import { firstCert, script, OSES } from './trust.js';
import * as PC from './portchange.js';

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });

/** Маршруты настройки HTTPS: /api/tls (доступны только после входа). */
export function register(r, { h }) {
  r.get('/tls', (req, res) => res.json(T.status(req)));

  r.put('/tls', h(async (req, res) => {
    await T.update(req.body && typeof req.body === 'object' ? req.body : {});
    res.json(T.status(req));
  }));

  // Выпустить сертификат Let's Encrypt заново (кнопка «Обновить сейчас»)
  r.post('/tls/renew', h(async (req, res) => {
    const m = T.cfg().mode;
    if (m !== 'letsencrypt-domain' && m !== 'letsencrypt-ip') throw bad('Обновление нужно только для сертификатов Let\'s Encrypt');
    await T.issue('manual');
    res.json(T.status(req));
  }));

  // Создать новый самоподписанный сертификат (например, после смены адресов)
  r.post('/tls/selfsigned', h(async (req, res) => {
    if (T.cfg().mode !== 'selfsigned') throw bad('Включите режим «Самоподписанный»');
    await T.ensure({ force: true });
    res.json(T.status(req));
  }));

  // Свой сертификат: PEM с цепочкой и закрытый ключ без пароля
  r.post('/tls/custom', h(async (req, res) => {
    const { cert, key } = req.body || {};
    if (typeof cert !== 'string' || typeof key !== 'string' || cert.length > 200000 || key.length > 20000) throw bad('Вставьте сертификат и закрытый ключ в формате PEM');
    const info = T.setCustom(cert.trim() + '\n', key.trim() + '\n');
    res.json({ ...T.status(req), info });
  }));

  // Открытая часть текущего сертификата: её можно добавить в доверенные, чтобы браузер не ругался
  r.get('/tls/cert.pem', (req, res) => {
    const pem = T.certPem();
    if (!pem) return res.status(404).json({ error: 'Сертификата пока нет' });
    res.set('Content-Type', 'application/x-pem-file');
    res.set('Content-Disposition', 'attachment; filename="horizoncraft.pem"');
    res.send(pem);
  });

  // Смена порта панели: пересоздаёт контейнер панели с новым портом (вместо ./set-port.sh)
  r.post('/tls/port', h(async (req, res) => {
    const out = await PC.change(req.body?.port);
    res.status(202).json(out);
  }));

  // Сертификат в формате DER для телефонов (Android и iOS предлагают установить .crt)
  r.get('/tls/cert.crt', (req, res) => {
    const c = firstCert(T.certPem());
    if (!c) return res.status(404).json({ error: 'Сертификата пока нет' });
    res.set('Content-Type', 'application/x-x509-ca-cert');
    res.set('Content-Disposition', 'attachment; filename="horizoncraft.crt"');
    res.send(c.der);
  });

  // Готовый установщик сертификата в доверенные: /api/tls/trust/windows | mac | linux (?lang=ru|en)
  r.get('/tls/trust/:os', (req, res) => {
    const c = firstCert(T.certPem());
    if (!c) return res.status(404).json({ error: 'Сертификата пока нет' });
    // адрес панели, как его открыл пользователь: после установки скрипт открывает его в браузере заново
    const s = OSES.includes(req.params.os) ? script(req.params.os, c, req.query.lang === 'en' ? 'en' : 'ru', `https://${req.headers.host || ''}/`) : null;
    if (!s) return res.status(404).json({ error: 'Неизвестная система' });
    res.set('Content-Type', s.type + '; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${s.name}"`);
    res.set('Cache-Control', 'no-store');
    res.send(s.body);
  });
}

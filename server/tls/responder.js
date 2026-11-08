import http from 'http';

/* Крошечный ответчик для проверки http-01. Его запускает панель в отдельном временном контейнере на порту 80 хоста:
   сам контейнер панели порт 80 не публикует и ничего не занимает, пока сертификат не выпускается.
   Переменные: CHALLENGES (JSON {токен: ключ-авторизации}), PORT, TTL (секунд до самоостановки). */

const map = JSON.parse(process.env.CHALLENGES || '{}');
const port = Number(process.env.PORT || 8080);
const srv = http.createServer((req, res) => {
  const m = /^\/\.well-known\/acme-challenge\/([A-Za-z0-9_-]{10,128})$/.exec((req.url || '').split('?')[0]);
  if (m && Object.prototype.hasOwnProperty.call(map, m[1])) { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(map[m[1]]); }
  res.writeHead(404); res.end();
});
srv.listen(port, () => console.log('READY'));
setTimeout(() => process.exit(0), Math.max(30, Number(process.env.TTL || 300)) * 1000).unref();

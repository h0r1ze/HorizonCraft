#!/usr/bin/env bash
# Аварийный возврат панели на обычный HTTP, если HTTPS настроен неудачно и страница не открывается.
#   ./disable-https.sh
#
# Панель на пару секунд останавливается; Minecraft-серверы продолжают работать.
# После входа настройте шифрование заново: Настройки → Безопасность.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

die() { echo "✘ $*" >&2; exit 1; }
[ -f .env ] || die "Нет файла .env. Сначала запустите ./install.sh"

DOCKER=(docker)
docker info >/dev/null 2>&1 || DOCKER=(sudo docker)

# Режим пишется в panel.json при остановленной панели (иначе она перезапишет файл из памяти).
JS='const fs=require("fs"),f=process.env.DATA_DIR+"/panel.json";'
JS+='let d={};try{d=JSON.parse(fs.readFileSync(f,"utf8"))}catch{}'
JS+='d.tls=Object.assign(d.tls||{},{mode:"off"});'
JS+='fs.writeFileSync(f+".tmp",JSON.stringify(d,null,2));fs.renameSync(f+".tmp",f);'

echo "==> Остановка панели"
"${DOCKER[@]}" compose stop panel >/dev/null
trap '"${DOCKER[@]}" compose start panel >/dev/null 2>&1 || true' EXIT

echo "==> Отключение шифрования"
"${DOCKER[@]}" compose run --rm --no-deps --entrypoint node panel -e "$JS"

echo "==> Запуск панели"
"${DOCKER[@]}" compose start panel >/dev/null
trap - EXIT

PORT="$(sed -n 's/^PANEL_PORT=//p' .env | tail -n1)"; PORT="${PORT:-8088}"
IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"; IP="${IP:-localhost}"
echo
echo "✔ Панель снова работает по HTTP: http://$IP:$PORT"
echo "  Это небезопасно. Включите HTTPS в панели: Настройки → Безопасность."

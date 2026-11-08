#!/usr/bin/env bash
# Сброс пароля администратора HorizonCraft.
#   ./reset-password.sh              сгенерирует новый пароль и покажет его
#   ./reset-password.sh MyNewPass    задаст указанный (не короче 8 символов)
#
# Панель на пару секунд останавливается; Minecraft-серверы продолжают работать.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

die() { echo "✘ $*" >&2; exit 1; }
[ -f .env ] || die "Нет файла .env. Сначала запустите ./install.sh"

DOCKER=(docker)
docker info >/dev/null 2>&1 || DOCKER=(sudo docker)

GENERATED=""
NEW_PASSWORD="${1:-}"
if [ -z "$NEW_PASSWORD" ]; then
  NEW_PASSWORD="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 16 || true)"
  GENERATED=1
fi
[ "${#NEW_PASSWORD}" -ge 8 ] || die "Пароль должен быть не короче 8 символов."
export NEW_PASSWORD

# Хеш пароля пишется в panel.json при остановленной панели (иначе она перезапишет файл из памяти).
JS='const fs=require("fs"),b=require("bcryptjs"),f=process.env.DATA_DIR+"/panel.json";'
JS+='let d={};try{d=JSON.parse(fs.readFileSync(f,"utf8"))}catch{}'
JS+='d.user={hash:b.hashSync(process.env.NEW_PASSWORD,10)};'
JS+='fs.writeFileSync(f+".tmp",JSON.stringify(d,null,2));fs.renameSync(f+".tmp",f);'

echo "==> Остановка панели"
"${DOCKER[@]}" compose stop panel >/dev/null
trap '"${DOCKER[@]}" compose start panel >/dev/null 2>&1 || true' EXIT

echo "==> Запись нового пароля"
"${DOCKER[@]}" compose run --rm --no-deps -e NEW_PASSWORD --entrypoint node panel -e "$JS"

echo "==> Запуск панели"
"${DOCKER[@]}" compose start panel >/dev/null
trap - EXIT

echo
echo "✔ Пароль изменён."
if [ -n "$GENERATED" ]; then echo "  Новый пароль: $NEW_PASSWORD"; fi
echo "  Смените его на свой в панели: Настройки → Пароль."

#!/usr/bin/env bash
# Смена порта, на котором открывается панель.
#   ./set-port.sh            покажет текущий порт
#   ./set-port.sh 8443       сменит порт на 8443 и перезапустит панель
#
# Minecraft-серверы продолжают работать. Если вы пробросили порт на роутере или открыли его в файрволе,
# сделайте то же для нового порта. Сертификат Let's Encrypt проверяет адрес по порту 80 и от порта панели не зависит.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

die() { echo "✘ $*" >&2; exit 1; }
[ -f .env ] || die "Нет файла .env. Сначала запустите ./install.sh"

CUR="$(sed -n 's/^PANEL_PORT=//p' .env | tail -n1)"; CUR="${CUR:-8088}"
NEW="${1:-}"
if [ -z "$NEW" ]; then echo "Текущий порт панели: $CUR. Сменить: ./set-port.sh <порт>"; exit 0; fi
case "$NEW" in ''|*[!0-9]*) die "Порт должен быть числом." ;; esac
{ [ "$NEW" -ge 1 ] && [ "$NEW" -le 65535 ]; } || die "Порт от 1 до 65535."
[ "$NEW" != "$CUR" ] || { echo "Порт уже $CUR, менять нечего."; exit 0; }

if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | awk 'NR > 1 { print $4 }' | grep -Eq "[:.]${NEW}\$"; then
  die "Порт $NEW уже занят другой программой. Выберите другой."
fi

DOCKER=(docker)
docker info >/dev/null 2>&1 || DOCKER=(sudo docker)

if grep -q '^PANEL_PORT=' .env; then sed -i "s/^PANEL_PORT=.*/PANEL_PORT=$NEW/" .env; else printf 'PANEL_PORT=%s\n' "$NEW" >> .env; fi
echo "==> Перезапуск панели на порту $NEW"
"${DOCKER[@]}" compose up -d >/dev/null

# Docker открывает порт сразу, поэтому ждём настоящий ответ панели (по HTTPS или по HTTP, смотря что включено)
ready() {
  command -v curl >/dev/null 2>&1 || { (exec 3<>"/dev/tcp/127.0.0.1/$NEW") 2>/dev/null && sleep 3; return; }
  local c
  for scheme in https http; do
    c="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 3 "$scheme://127.0.0.1:$NEW/api/me" 2>/dev/null || true)"
    case "$c" in 200|401) SCH=$scheme; return 0 ;; esac
  done
  return 1
}
SCH=https
UP=""
for _ in $(seq 1 40); do if ready; then UP=1; break; fi; sleep 1; done
[ -n "$UP" ] || die "Панель не ответила на порту $NEW. Верните прежний порт: ./set-port.sh $CUR"

IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"; IP="${IP:-localhost}"
echo "✔ Порт панели: $NEW"
echo "  Адрес: $SCH://$IP:$NEW"
echo "  Ноды, подключённые к этой панели по старому порту, нужно указать заново, если это нода."

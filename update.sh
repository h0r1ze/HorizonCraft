#!/usr/bin/env bash
# Обновление HorizonCraft до последней версии. Minecraft-серверы при этом не перезапускаются:
# это отдельные контейнеры, перезапускается только сама панель.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

[ -f .env ] || { echo "Нет файла .env. Сначала запустите ./install.sh" >&2; exit 1; }

DOCKER=(docker)
docker info >/dev/null 2>&1 || DOCKER=(sudo docker)

if [ -d .git ]; then
  echo "==> Загрузка обновлений"
  git pull --ff-only
fi

echo "==> Пересборка и перезапуск панели"
"${DOCKER[@]}" compose up -d --build
"${DOCKER[@]}" image prune -f >/dev/null 2>&1 || true

echo "✔ Готово"

# Установки, сделанные до появления HTTPS, продолжают работать по HTTP: напомним, как включить шифрование
if ! grep -q '^TLS_MODE=' .env; then
  echo
  echo "i Если вы ещё не включили HTTPS, панель работает по HTTP без шифрования."
  echo "  Включить можно в панели: Настройки → Безопасность (Let's Encrypt по домену или IP-адресу, самоподписанный или свой сертификат)."
fi

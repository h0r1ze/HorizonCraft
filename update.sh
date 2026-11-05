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

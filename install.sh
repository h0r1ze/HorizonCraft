#!/usr/bin/env bash
# HorizonCraft: установщик.
#
#   ./install.sh                                  из склонированного репозитория
#   curl -fsSL https://raw.githubusercontent.com/h0r1ze/HorizonCraft/main/install.sh | bash
#
# Режим агента (машина станет нодой для главной панели):
#   ./install.sh --agent
#   curl -fsSL https://raw.githubusercontent.com/h0r1ze/HorizonCraft/main/install.sh | bash -s -- --agent
#
# Переменные (необязательно): ADMIN_PASSWORD, PANEL_PORT, DATA_DIR, TZ,
#   HORIZONCRAFT_DIR (куда клонировать, по умолчанию ~/horizoncraft), INSTALL_DOCKER=1
set -euo pipefail

REPO_URL="${HORIZONCRAFT_REPO:-https://github.com/h0r1ze/HorizonCraft.git}"
INSTALL_DIR="${HORIZONCRAFT_DIR:-$HOME/horizoncraft}"

if [ -t 1 ]; then
  B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; C=$'\033[36m'; D=$'\033[2m'; N=$'\033[0m'
else
  B=; G=; Y=; R=; C=; D=; N=
fi
step() { printf '\n%s==>%s %s%s%s\n' "$C" "$N" "$B" "$*" "$N"; }
ok()   { printf '  %s✔%s %s\n' "$G" "$N" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
die()  { printf '\n%s✘ %s%s\n' "$R" "$*" "$N" >&2; exit 1; }

# Вопрос да/нет. Без терминала (например, в cron) ответ всегда «нет».
ask() {
  { : </dev/tty; } 2>/dev/null || return 1
  local a
  printf '  %s [y/N] ' "$1" >&2
  read -r a </dev/tty || return 1
  [[ "$a" =~ ^[YyДд] ]]
}

# Случайная строка из букв и цифр заданной длины.
rand() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1" || true; }

AGENT_MODE="${AGENT:-}"
for arg in "$@"; do
  case "$arg" in
    --agent) AGENT_MODE=1 ;;
    -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]:-/dev/null}" 2>/dev/null | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Неизвестный параметр: $arg (доступно: --agent)" ;;
  esac
done

printf '%s\n' "${G}${B}"
cat <<'BANNER'
  _   _            _                ____            __ _
 | | | | ___  _ __(_)_______  _ __ / ___|_ __ __ _ / _| |_
 | |_| |/ _ \| '__| |_  / _ \| '_ \ |   | '__/ _` | |_| __|
 |  _  | (_) | |  | |/ / (_) | | | | |___| | | (_| |  _| |_
 |_| |_|\___/|_|  |_/___\___/|_| |_|\____|_|  \__,_|_|  \__|
BANNER
printf '%s  Панель управления Minecraft-серверами%s\n' "${N}${D}" "$N"

[ "$(uname -s)" = Linux ] || die "Поддерживается только Linux: панели нужен Docker и сокет /var/run/docker.sock."

# ---------------------------------------------------------------- Docker
step "Проверка Docker"
if ! command -v docker >/dev/null 2>&1; then
  warn "Docker не найден."
  if [ "${INSTALL_DOCKER:-}" = 1 ] || ask "Установить Docker официальным скриптом get.docker.com?"; then
    command -v curl >/dev/null 2>&1 || die "Для установки Docker нужен curl."
    curl -fsSL https://get.docker.com | sh
  else
    die "Установите Docker (https://docs.docker.com/engine/install/) и запустите скрипт снова. Или: INSTALL_DOCKER=1 ./install.sh"
  fi
fi

DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  if command -v sudo >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
    DOCKER=(sudo docker)
    warn "Пользователь не в группе docker, использую sudo. Чтобы не вводить sudo: sudo usermod -aG docker \$USER (и перезайти)"
  else
    die "Нет доступа к Docker. Проверьте, что служба запущена: sudo systemctl start docker"
  fi
fi
"${DOCKER[@]}" compose version >/dev/null 2>&1 \
  || die "Не найден Docker Compose v2. Установите: sudo apt install docker-compose-plugin"
ok "Docker $("${DOCKER[@]}" version --format '{{.Server.Version}}' 2>/dev/null || echo '?'), Compose доступен"

# ---------------------------------------------------------------- Исходники
SELF="${BASH_SOURCE[0]:-}"
if [ -n "$SELF" ] && [ -f "$SELF" ] && [ -f "$(dirname "$SELF")/docker-compose.yml" ] && [ -f "$(dirname "$SELF")/Dockerfile" ]; then
  cd "$(dirname "$SELF")"
else
  step "Загрузка HorizonCraft в $INSTALL_DIR"
  command -v git >/dev/null 2>&1 || die "Нужен git: sudo apt install git"
  if [ -d "$INSTALL_DIR/.git" ]; then
    git -C "$INSTALL_DIR" pull --ff-only
  else
    git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
  fi
  cd "$INSTALL_DIR"
fi
ok "Каталог проекта: $PWD"

# ---------------------------------------------------------------- Настройка (.env)
step "Настройка"
NEW_PASS=""
if [ -f .env ]; then
  ok "Файл .env уже существует, оставляю без изменений"
else
  PANEL_PORT="${PANEL_PORT:-8088}"
  DATA_DIR="${DATA_DIR:-$PWD/data}"
  ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

  if [ -z "$ADMIN_PASSWORD" ]; then
    ADMIN_PASSWORD="$(rand 16)"
    NEW_PASS=1
  fi
  [ "${#ADMIN_PASSWORD}" -ge 8 ] || die "Пароль должен быть не короче 8 символов."
  case "$ADMIN_PASSWORD" in *[[:space:]\"\'\$\#\\\`]*) die "В пароле не должно быть пробелов и символов \" ' \$ # \\ \`" ;; esac
  case "$DATA_DIR" in /*) ;; *) die "DATA_DIR должен быть абсолютным путём, а не '$DATA_DIR'." ;; esac
  case "$DATA_DIR" in *[[:space:]]*) die "В пути DATA_DIR не должно быть пробелов." ;; esac
  case "$PANEL_PORT" in ''|*[!0-9]*) die "PANEL_PORT должен быть числом." ;; esac

  TZ_NAME="${TZ:-}"
  [ -n "$TZ_NAME" ] || TZ_NAME="$(timedatectl show -p Timezone --value 2>/dev/null || true)"
  [ -n "$TZ_NAME" ] || TZ_NAME="$(cat /etc/timezone 2>/dev/null || true)"
  [ -n "$TZ_NAME" ] || TZ_NAME=UTC

  (
    umask 077
    cat > .env <<EOF
# Создано install.sh. Не публикуйте этот файл.
ADMIN_PASSWORD=$ADMIN_PASSWORD
DATA_DIR=$DATA_DIR
PANEL_PORT=$PANEL_PORT
TZ=$TZ_NAME
EOF
  )
  ok "Создан .env (права 600), часовой пояс: $TZ_NAME"
fi

envval() { sed -n "s/^$1=//p" .env | tail -n1; }

# Режим агента: токен, по которому главная панель управляет этой машиной.
if [ -n "$AGENT_MODE" ]; then
  if [ -z "$(envval AGENT_TOKEN)" ]; then
    [ -z "$(tail -c1 .env)" ] || printf '\n' >> .env
    (umask 077; printf 'AGENT_TOKEN=%s\n' "$(rand 48)" >> .env)
    ok "Включён режим агента (создан AGENT_TOKEN)"
  else
    ok "Режим агента уже включён, токен из .env сохранён"
  fi
fi

PANEL_PORT="$(envval PANEL_PORT)"; PANEL_PORT="${PANEL_PORT:-8088}"
DATA_DIR="$(envval DATA_DIR)"
[ -n "$DATA_DIR" ] || die "В .env не задан DATA_DIR."

mkdir -p "$DATA_DIR" 2>/dev/null || sudo mkdir -p "$DATA_DIR" || die "Не удалось создать $DATA_DIR"
ok "Данные будут храниться в $DATA_DIR"

if ! "${DOCKER[@]}" ps --format '{{.Names}}' | grep -qx horizoncraft; then
  if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]${PANEL_PORT}\$"; then
    die "Порт $PANEL_PORT уже занят. Измените PANEL_PORT в .env и запустите скрипт снова."
  fi
fi

# ---------------------------------------------------------------- Запуск
step "Сборка и запуск (при первом запуске это занимает 1–3 минуты)"
"${DOCKER[@]}" compose up -d --build

step "Ожидание запуска панели"
UP=""
for _ in $(seq 1 60); do
  if (exec 3<>"/dev/tcp/127.0.0.1/$PANEL_PORT") 2>/dev/null; then UP=1; break; fi
  sleep 1
done
if [ -z "$UP" ]; then
  warn "Панель не ответила за 60 секунд. Посмотрите журнал: ${DOCKER[*]} compose logs --tail 50 panel"
else
  ok "Панель запущена"
fi

# Адрес машины в сети. Любой из способов может отсутствовать на минимальной системе, поэтому все с запасом.
IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
[ -n "$IP" ] || IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit }}' || true)"
IP="${IP:-localhost}"

printf '\n%s%s  Готово!%s\n\n' "$G" "$B" "$N"
printf '  Адрес панели:  %s%shttp://%s:%s%s\n' "$B" "$C" "$IP" "$PANEL_PORT" "$N"
if [ -n "$NEW_PASS" ]; then
  printf '  Пароль:        %s%s%s   %s(сохранён в %s/.env)%s\n' "$B" "$(envval ADMIN_PASSWORD)" "$N" "$D" "$PWD" "$N"
  printf '  %sСмените пароль после первого входа: Настройки → Пароль.%s\n' "$Y" "$N"
else
  printf '  Пароль:        см. ADMIN_PASSWORD в %s/.env (если вы не меняли его в панели)\n' "$PWD"
fi
if [ -n "$AGENT_MODE" ]; then
  cat <<EOF

  ${B}Данные для подключения ноды${N}
   Адрес:  ${B}${C}http://${IP}:${PANEL_PORT}${N}
   Токен:  ${B}$(envval AGENT_TOKEN)${N}

   В главной панели откройте ${B}Настройки → Ноды → Подключить ноду${N} и вставьте адрес и токен.
   ${Y}Токен даёт полный доступ к Docker на этой машине.${N} Откройте порт ${PANEL_PORT} только для главной панели,
   например: sudo ufw allow from <IP главной панели> to any port ${PANEL_PORT} proto tcp
   Не выставляйте его в интернет без VPN или обратного прокси с HTTPS.
EOF
fi
cat <<EOF

  ${B}Дальше${N}
   • Обновление:        ./update.sh
   • Забыли пароль:     ./reset-password.sh
   • Порты серверов Minecraft (по умолчанию 25565+) откройте в файрволе и пробросьте на роутере.
   • Панель работает по HTTP и управляет Docker, не выставляйте порт $PANEL_PORT в интернет
     без VPN или обратного прокси с HTTPS.

EOF

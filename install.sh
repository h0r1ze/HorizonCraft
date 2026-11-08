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
# HTTPS (если не заданы, установщик спросит; без терминала по умолчанию самоподписанный сертификат):
#   TLS_MODE=selfsigned | letsencrypt-domain | letsencrypt-ip | custom | off
#   TLS_HOST=адрес панели (домен или IP), ACME_EMAIL=почта для Let's Encrypt (необязательно)
#   TLS_CERT=/путь/cert.pem и TLS_KEY=/путь/key.pem для режима custom
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

# Терминал для вопросов: при запуске через curl | bash стандартный ввод занят самим скриптом, поэтому читаем с /dev/tty.
TTY_DEV="${HC_TTY:-/dev/tty}"
TTY_OK=""
if (exec 9<"$TTY_DEV") 2>/dev/null; then exec 9<"$TTY_DEV"; TTY_OK=1; fi
have_tty() { [ -n "$TTY_OK" ]; }

# Вопрос да/нет. Без терминала (например, в cron) ответ всегда «нет».
ask() {
  have_tty || return 1
  local a
  printf '  %s [y/N] ' "$1" >&2
  read -r a <&9 || return 1
  [[ "$a" =~ ^[YyДд] ]]
}

# Вопрос с ответом по умолчанию. Без терминала возвращает значение по умолчанию.
prompt() {
  local a
  have_tty || { printf '%s' "$2"; return 0; }
  printf '  %s [%s]: ' "$1" "$2" >&2
  read -r a <&9 || a=""
  printf '%s' "${a:-$2}"
}

# 0, если порт на этой машине свободен.
port_free() {
  command -v ss >/dev/null 2>&1 || return 0
  ! ss -ltn 2>/dev/null | awk 'NR > 1 { print $4 }' | grep -Eq "[:.]$1\$"
}

# Частный или служебный IPv4: Let's Encrypt на такие адреса сертификаты не выдаёт.
private_ip() {
  case "$1" in
    10.*|127.*|0.*|192.168.*|169.254.*|192.0.0.*|198.18.*|198.19.*) return 0 ;;
    172.1[6-9].*|172.2[0-9].*|172.3[0-1].*) return 0 ;;
    100.6[4-9].*|100.[7-9][0-9].*|100.1[01][0-9].*|100.12[0-7].*) return 0 ;;
  esac
  return 1
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
  DATA_DIR="${DATA_DIR:-$PWD/data}"
  ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

  # ---- порт панели: по умолчанию 443, если свободен, иначе 8443 или 8088; администратор может указать любой
  PANEL_PORT="${PANEL_PORT:-}"
  if [ -z "$PANEL_PORT" ]; then
    DEF_PORT=8088
    for c in 443 8443; do if port_free "$c"; then DEF_PORT=$c; break; fi; done
    if have_tty; then
      printf '\n  %sПорт панели%s: на нём будет открываться веб-интерфейс.\n' "$B" "$N" >&2
      port_free 443 || printf '  %sПорт 443 занят другой программой, предлагаю %s.%s\n' "$D" "$DEF_PORT" "$N" >&2
      while :; do
        PANEL_PORT="$(prompt 'Порт панели (1-65535)' "$DEF_PORT")"
        case "$PANEL_PORT" in ''|*[!0-9]*) warn "Порт должен быть числом."; continue ;; esac
        if [ "$PANEL_PORT" -lt 1 ] || [ "$PANEL_PORT" -gt 65535 ]; then warn "Порт от 1 до 65535."; continue; fi
        port_free "$PANEL_PORT" || { warn "Порт $PANEL_PORT уже занят, выберите другой."; continue; }
        break
      done
    else
      PANEL_PORT="$DEF_PORT"
    fi
  fi

  # ---- HTTPS: как в 3x-ui, сертификат по домену или по IP-адресу
  TLS_MODE="${TLS_MODE:-}"; TLS_HOST="${TLS_HOST:-}"; ACME_EMAIL="${ACME_EMAIL:-}"
  LOCAL_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  [ -n "$LOCAL_IP" ] || LOCAL_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit }}' || true)"
  if [ -z "$TLS_MODE" ]; then
    if have_tty; then
      cat >&2 <<MENU

  ${B}Шифрование (HTTPS)${N}: панель управляет Docker, поэтому доступ к ней нужно шифровать.
    1) Самоподписанный сертификат ${D}(локальная сеть; браузер предупредит один раз)${N}
    2) Let's Encrypt для домена ${D}(нужны домен и свободный порт 80, открытый из интернета)${N}
    3) Let's Encrypt для публичного IP-адреса ${D}(сертификат на 6 суток, продлевается сам; нужен порт 80)${N}
    4) Свой сертификат ${D}(файлы .crt и .key)${N}
    5) Без шифрования, обычный HTTP ${D}(не рекомендуется)${N}
MENU
      case "$(prompt 'Выберите вариант' 1)" in
        2) TLS_MODE=letsencrypt-domain ;; 3) TLS_MODE=letsencrypt-ip ;; 4) TLS_MODE=custom ;; 5) TLS_MODE=off ;; *) TLS_MODE=selfsigned ;;
      esac
    else
      TLS_MODE=selfsigned
    fi
  fi
  case "$TLS_MODE" in selfsigned|letsencrypt-domain|letsencrypt-ip|custom|off) ;; *) die "Неизвестный TLS_MODE: $TLS_MODE (доступно: selfsigned, letsencrypt-domain, letsencrypt-ip, custom, off)" ;; esac

  case "$TLS_MODE" in
    selfsigned)
      [ -n "$TLS_HOST" ] || TLS_HOST="$(prompt 'Адрес, по которому вы будете открывать панель (IP или имя)' "${LOCAL_IP:-localhost}")"
      ;;
    letsencrypt-domain)
      [ -n "$TLS_HOST" ] || TLS_HOST="$(prompt 'Домен панели (его запись A должна указывать на этот сервер)' '')"
      case "$TLS_HOST" in *.*) ;; *) die "Для Let's Encrypt нужен домен, например panel.example.com." ;; esac
      case "$TLS_HOST" in *[!A-Za-z0-9.-]*) die "В домене допустимы только буквы, цифры, точка и дефис." ;; esac
      [ -n "$ACME_EMAIL" ] || ACME_EMAIL="$(prompt 'Почта для Let'"'"'s Encrypt (необязательно)' '')"
      ;;
    letsencrypt-ip)
      if [ -z "$TLS_HOST" ]; then
        PUB_IP=""
        if have_tty && command -v curl >/dev/null 2>&1; then
          printf '  %sОпределяю внешний адрес через api.ipify.org…%s\n' "$D" "$N" >&2
          PUB_IP="$(curl -4 -fsS --max-time 6 https://api.ipify.org 2>/dev/null || true)"
        fi
        TLS_HOST="$(prompt 'Публичный IP-адрес этого сервера' "$PUB_IP")"
      fi
      case "$TLS_HOST" in *[!0-9.]*|'') die "Укажите IPv4-адрес, например 203.0.113.10." ;; esac
      if private_ip "$TLS_HOST" && [ -z "${ACME_DIRECTORY:-}" ]; then
        die "$TLS_HOST это локальный адрес: Let's Encrypt не выдаёт сертификаты на такие адреса. Для локальной сети выберите самоподписанный сертификат (вариант 1), для интернета укажите публичный IP или домен."
      fi
      [ -n "$ACME_EMAIL" ] || ACME_EMAIL="$(prompt 'Почта для Let'"'"'s Encrypt (необязательно)' '')"
      ;;
    custom)
      TLS_CERT="${TLS_CERT:-}"; TLS_KEY="${TLS_KEY:-}"
      [ -n "$TLS_CERT" ] || TLS_CERT="$(prompt 'Путь к файлу сертификата (PEM, с цепочкой)' '')"
      [ -n "$TLS_KEY" ] || TLS_KEY="$(prompt 'Путь к файлу закрытого ключа (PEM, без пароля)' '')"
      [ -r "$TLS_CERT" ] || die "Не удалось прочитать сертификат: ${TLS_CERT:-путь не указан}"
      [ -r "$TLS_KEY" ] || die "Не удалось прочитать ключ: ${TLS_KEY:-путь не указан}"
      ;;
  esac
  case "$TLS_MODE" in letsencrypt-*)
    port_free 80 || warn "Порт 80 сейчас занят. Let's Encrypt проверяет адрес именно по нему: освободите порт 80 до выпуска сертификата, иначе панель временно будет работать с самоподписанным."
    ;;
  esac

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
TLS_MODE=$TLS_MODE
TLS_HOST=$TLS_HOST
ACME_EMAIL=$ACME_EMAIL
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
TLS_MODE="$(envval TLS_MODE)"; TLS_MODE="${TLS_MODE:-off}"; TLS_HOST="$(envval TLS_HOST)"
[ -n "$DATA_DIR" ] || die "В .env не задан DATA_DIR."

mkdir -p "$DATA_DIR" 2>/dev/null || sudo mkdir -p "$DATA_DIR" || die "Не удалось создать $DATA_DIR"
ok "Данные будут храниться в $DATA_DIR"

# Свой сертификат: копируем файлы в папку данных, панель подхватит их при запуске
if [ -n "${TLS_CERT:-}" ] && [ -n "${TLS_KEY:-}" ]; then
  mkdir -p "$DATA_DIR/tls" 2>/dev/null || sudo mkdir -p "$DATA_DIR/tls"
  ( umask 077; cp "$TLS_CERT" "$DATA_DIR/tls/custom.pem" && cp "$TLS_KEY" "$DATA_DIR/tls/custom.key" ) 2>/dev/null \
    || sudo sh -c "umask 077; cp '$TLS_CERT' '$DATA_DIR/tls/custom.pem' && cp '$TLS_KEY' '$DATA_DIR/tls/custom.key'" \
    || die "Не удалось скопировать сертификат в $DATA_DIR/tls"
  ok "Свой сертификат скопирован в $DATA_DIR/tls"
fi

if ! "${DOCKER[@]}" ps --format '{{.Names}}' | grep -qx horizoncraft; then
  if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]${PANEL_PORT}\$"; then
    die "Порт $PANEL_PORT уже занят. Измените PANEL_PORT в .env и запустите скрипт снова."
  fi
fi

# ---------------------------------------------------------------- Запуск
step "Сборка и запуск (при первом запуске это занимает 1–3 минуты)"
"${DOCKER[@]}" compose up -d --build

step "Ожидание запуска панели"
# Docker открывает порт сразу, ещё до старта самого приложения, поэтому ждём настоящий ответ панели
panel_ready() {
  if command -v curl >/dev/null 2>&1; then
    local c scheme=https
    [ "$TLS_MODE" = off ] && scheme=http
    c="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 3 "$scheme://127.0.0.1:$PANEL_PORT/api/me" 2>/dev/null || true)"
    [ -n "$c" ] && [ "$c" != 000 ]
  else
    (exec 3<>"/dev/tcp/127.0.0.1/$PANEL_PORT") 2>/dev/null && sleep 3
  fi
}
UP=""
for _ in $(seq 1 60); do
  if panel_ready; then UP=1; break; fi
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

# Адрес и схема, по которым открывать панель
SCHEME=https; [ "$TLS_MODE" = off ] && SCHEME=http
HOST_SHOW="$IP"; [ -n "$TLS_HOST" ] && [ "$TLS_MODE" != off ] && HOST_SHOW="$TLS_HOST"
URL="$SCHEME://$HOST_SHOW"
if [ "$SCHEME" = https ] && [ "$PANEL_PORT" = 443 ]; then :; elif [ "$SCHEME" = http ] && [ "$PANEL_PORT" = 80 ]; then :; else URL="$URL:$PANEL_PORT"; fi

# Let's Encrypt выпускает сертификат уже после запуска: дождёмся результата, чтобы сказать о нём сразу
LE_RESULT=""
case "$TLS_MODE" in letsencrypt-*)
  step "Выпуск сертификата Let's Encrypt (до 2 минут)"
  for _ in $(seq 1 60); do
    LOGS="$("${DOCKER[@]}" compose logs --no-color --tail 60 panel 2>&1 || true)"
    if printf '%s' "$LOGS" | grep -q 'TLS: сертификат выпущен'; then LE_RESULT=ok; break; fi
    if printf '%s' "$LOGS" | grep -q 'TLS: не удалось выпустить сертификат'; then LE_RESULT=fail; break; fi
    sleep 2
  done
  case "$LE_RESULT" in
    ok) ok "Сертификат Let's Encrypt выпущен" ;;
    fail) warn "Сертификат выпустить не удалось: $(printf '%s' "$LOGS" | grep 'TLS: не удалось выпустить сертификат' | tail -n1 | sed 's/^.*сертификат: //')"
          warn "Пока панель работает с временным самоподписанным сертификатом. Исправьте причину и нажмите «Обновить сейчас» в Настройках → Безопасность." ;;
    *) warn "Выпуск ещё идёт. Состояние смотрите в панели: Настройки → Безопасность." ;;
  esac
  ;;
esac

# Отпечаток сертификата, чтобы сверить его с предупреждением браузера
FP=""
if [ "$TLS_MODE" = selfsigned ] && [ -r "$DATA_DIR/tls/cert.pem" ] && command -v openssl >/dev/null 2>&1; then
  FP="$(openssl x509 -in "$DATA_DIR/tls/cert.pem" -noout -fingerprint -sha256 2>/dev/null | sed 's/^.*=//' || true)"
fi

printf '\n%s%s  Готово!%s\n\n' "$G" "$B" "$N"
printf '  Адрес панели:  %s%s%s%s\n' "$B" "$C" "$URL" "$N"
case "$TLS_MODE" in
  selfsigned)
    printf '  %sСертификат самоподписанный: при первом заходе браузер покажет предупреждение, продолжите вход.%s\n' "$Y" "$N"
    [ -z "$FP" ] || printf '  Отпечаток SHA-256: %s\n' "$FP"
    ;;
  off) printf '  %sШифрование выключено: пароль идёт по сети открытым текстом. Включите HTTPS: Настройки → Безопасность.%s\n' "$Y" "$N" ;;
esac
if [ -n "$NEW_PASS" ]; then
  printf '  Пароль:        %s%s%s   %s(сохранён в %s/.env)%s\n' "$B" "$(envval ADMIN_PASSWORD)" "$N" "$D" "$PWD" "$N"
  printf '  %sСмените пароль после первого входа: Настройки → Пароль.%s\n' "$Y" "$N"
else
  printf '  Пароль:        см. ADMIN_PASSWORD в %s/.env (если вы не меняли его в панели)\n' "$PWD"
fi
AGENT_TLS_NOTE=""
[ "$TLS_MODE" = off ] || AGENT_TLS_NOTE="Связь с нодой шифруется (HTTPS). Если сертификат самоподписанный, главная панель попросит подтвердить его отпечаток."
if [ -n "$AGENT_MODE" ]; then
  cat <<EOF

  ${B}Данные для подключения ноды${N}
   Адрес:  ${B}${C}${URL}${N}
   Токен:  ${B}$(envval AGENT_TOKEN)${N}

   В главной панели откройте ${B}Настройки → Ноды → Подключить ноду${N} и вставьте адрес и токен.
   ${Y}Токен даёт полный доступ к Docker на этой машине.${N} Откройте порт ${PANEL_PORT} только для главной панели,
   например: sudo ufw allow from <IP главной панели> to any port ${PANEL_PORT} proto tcp
   ${AGENT_TLS_NOTE}
EOF
fi
cat <<EOF

  ${B}Дальше${N}
   • Обновление:        ./update.sh
   • Забыли пароль:     ./reset-password.sh
   • Сменить порт:      в панели (Настройки → Безопасность) или ./set-port.sh 8443
   • Не открывается по HTTPS: ./disable-https.sh вернёт обычный HTTP, затем настройте шифрование в панели
   • Порты серверов Minecraft (по умолчанию 25565+) откройте в файрволе и пробросьте на роутере.
   • Панель управляет Docker. Для доступа из интернета оставляйте HTTPS включённым (Настройки → Безопасность).

EOF

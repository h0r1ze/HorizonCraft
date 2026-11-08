import crypto from 'crypto';

/* Установщики сертификата панели в список доверенных. Браузер не может изменить хранилище сертификатов системы,
   поэтому панель отдаёт готовый файл: Windows (.bat), macOS (.command), Linux (.sh) и сам сертификат для телефонов (.crt).
   Внутри только открытая часть сертификата. После установки браузер перестаёт предупреждать о самоподписанном сертификате. */

export const OSES = ['windows', 'mac', 'linux'];
const BLOCK = /-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\s]+?)-----END CERTIFICATE-----/;

/** Первый сертификат из PEM (у цепочки это сам сертификат панели): {der, b64 (строки по 64), fp}. */
export function firstCert(pem) {
  const m = BLOCK.exec(String(pem || ''));
  if (!m) return null;
  const b64 = m[1].replace(/\s+/g, '');
  const der = Buffer.from(b64, 'base64');
  if (!der.length) return null;
  const fp = crypto.createHash('sha256').update(der).digest('hex').toUpperCase().match(/../g).join(':');
  return { der, b64: b64.match(/.{1,64}/g), fp, short: fp.replace(/:/g, '').slice(0, 12).toLowerCase() };
}

const T = {
  ru: {
    intro: 'Установка сертификата панели HorizonCraft в список доверенных.',
    fp: 'Отпечаток SHA-256 (он должен совпасть с тем, что показано в панели):',
    win: 'Windows спросит подтверждение: нажмите Да.',
    ok: 'Готово. Чтобы предупреждение исчезло, браузер нужно перезапустить.',
    ask: 'Закрыть браузеры и открыть панель заново? Несохранённые данные на открытых страницах могут пропасть. Введите Y и нажмите Enter, любой другой ответ пропустит этот шаг.',
    askSh: 'Закрыть браузеры и открыть панель заново? Несохранённые данные на открытых страницах могут пропасть. [y/N]',
    manual: 'Тогда перезапустите браузер сами: в Chrome введите chrome://restart, в Edge edge://restart.',
    fail: 'Не удалось установить сертификат.',
    again: 'После создания нового сертификата в панели запустите установку заново.',
    key: 'Нажмите любую клавишу, чтобы закрыть окно...',
    mac: 'macOS попросит пароль от этого пользователя.',
    nss: 'Chrome и Chromium: установлено.',
    sys: 'Система (curl, Firefox через системное хранилище): установлено.',
    ff: 'Firefox хранит сертификаты отдельно: Настройки, Приватность и защита, Сертификаты, Просмотр сертификатов, Импорт.',
    none: 'Не нашёл способа установки на этой системе.',
  },
  en: {
    intro: 'Installing the HorizonCraft panel certificate as trusted.',
    fp: 'SHA-256 fingerprint (it must match the one shown in the panel):',
    win: 'Windows will ask for confirmation: click Yes.',
    ok: 'Done. The browser has to be restarted for the warning to go away.',
    ask: 'Close the browsers and open the panel again? Unsaved data on open pages may be lost. Type Y and press Enter, any other answer skips this step.',
    askSh: 'Close the browsers and open the panel again? Unsaved data on open pages may be lost. [y/N]',
    manual: 'Then restart the browser yourself: type chrome://restart in Chrome, edge://restart in Edge.',
    fail: 'Could not install the certificate.',
    again: 'After a new certificate is created in the panel, run the installer again.',
    key: 'Press any key to close this window...',
    mac: 'macOS will ask for the password of this user.',
    nss: 'Chrome and Chromium: installed.',
    sys: 'System store (curl, system-wide trust): installed.',
    ff: 'Firefox keeps certificates separately: Settings, Privacy and Security, Certificates, View Certificates, Import.',
    none: 'No way to install found on this system.',
  },
};
const clean = s => s.replace(/[\r\n]+/g, ' ');

/** Текст установщика: {name, type, body} или null, если ОС неизвестна. */
export function script(os, cert, lang = 'ru', url = '') {
  const t = T[lang === 'en' ? 'en' : 'ru'];
  url = /^https:\/\/[A-Za-z0-9.\-:\[\]]{1,80}\/?$/.test(url) ? url : '';
  const pem = ['-----BEGIN CERTIFICATE-----', ...cert.b64, '-----END CERTIFICATE-----'];
  if (os === 'windows') {
    // в окне cmd нельзя использовать скобки и &|<>^% в тексте: они ломают блок echo
    const w = s => clean(s).replace(/[()&|<>^%!"]/g, ' ');
    const lines = [
      '@echo off', 'chcp 65001 >nul', 'title HorizonCraft', 'setlocal',
      `set "F=%TEMP%\\horizoncraft-${cert.short}.crt"`,
      '> "%F%" (', ...pem.map(l => `echo ${l}`), ')',
      'echo.', `echo ${w(t.intro)}`, `echo ${w(t.fp)}`, `echo ${cert.fp}`, 'echo.', `echo ${w(t.win)}`, 'echo.',
      'certutil -user -addstore Root "%F%" >nul',
      'if errorlevel 1 goto bad',
      `echo ${w(t.ok)}`, `echo ${w(t.again)}`, 'echo.',
      'set "A="', `set /p "A=${w(t.ask)} "`,
      'if /i not "%A%"=="Y" goto end',
      'for %%B in (chrome msedge brave firefox opera vivaldi) do taskkill /IM %%B.exe >nul 2>&1',
      'ping -n 4 127.0.0.1 >nul',
      ...(url ? [`start "" "${url}"`] : []),
      'goto end',
      ':bad', `echo ${w(t.fail)}`,
      ':end', 'del "%F%" >nul 2>&1', 'echo.', 'pause',
    ];
    return { name: 'horizoncraft-trust-windows.bat', type: 'application/x-bat', body: lines.join('\r\n') + '\r\n' };
  }
  const q = s => `'${clean(s).replace(/'/g, `'\\''`)}'`;
  const head = ['F="$(mktemp)" || exit 1', 'cat > "$F" <<\'HC_PEM\'', ...pem, 'HC_PEM', `echo ${q(t.intro)}`, `echo ${q(t.fp)}`, `echo ${q(cert.fp)}`, 'echo'];
  if (os === 'mac') {
    const lines = ['#!/bin/bash', ...head, `echo ${q(t.mac)}`,
      'if security add-trusted-cert -r trustRoot -k "$HOME/Library/Keychains/login.keychain-db" "$F"; then', `  echo ${q(t.ok)}`, `  echo ${q(t.again)}`,
      `  printf '%s ' ${q(t.askSh)}; read -r ans`,
      '  case "$ans" in y|Y)',
      '    for app in "Google Chrome" "Microsoft Edge" "Brave Browser" Firefox Safari Opera; do osascript -e "if application \\"$app\\" is running then tell application \\"$app\\" to quit" >/dev/null 2>&1; done',
      '    sleep 3',
      ...(url ? [`    open '${url}'`] : []),
      `    ;; *) echo ${q(t.manual)} ;;`, '  esac',
      'else', `  echo ${q(t.fail)}`, 'fi',
      'rm -f "$F"', `read -n 1 -s -r -p ${q(t.key)}`, 'echo'];
    return { name: 'horizoncraft-trust-mac.command', type: 'application/x-sh', body: lines.join('\n') + '\n' };
  }
  if (os === 'linux') {
    const lines = ['#!/bin/sh', ...head, 'done=0', 'tried=0', 'NSS="$HOME/.pki/nssdb"',
      'if command -v certutil >/dev/null 2>&1; then',
      '  tried=1',
      '  mkdir -p "$NSS"',
      '  [ -f "$NSS/cert9.db" ] || certutil -d "sql:$NSS" -N --empty-password',
      '  certutil -d "sql:$NSS" -D -n HorizonCraft >/dev/null 2>&1',
      `  if certutil -d "sql:$NSS" -A -t "P,," -n HorizonCraft -i "$F"; then echo ${q(t.nss)}; done=1; fi`,
      'fi',
      'if command -v update-ca-certificates >/dev/null 2>&1; then',
      '  tried=1',
      `  if sudo cp "$F" /usr/local/share/ca-certificates/horizoncraft.crt && sudo update-ca-certificates >/dev/null; then echo ${q(t.sys)}; done=1; fi`,
      'elif command -v update-ca-trust >/dev/null 2>&1; then',
      '  tried=1',
      `  if sudo cp "$F" /etc/pki/ca-trust/source/anchors/horizoncraft.pem && sudo update-ca-trust; then echo ${q(t.sys)}; done=1; fi`,
      'fi',
      'rm -f "$F"',
      'if [ "$done" = 1 ]; then',
      `  echo ${q(t.ok)}; echo ${q(t.again)}`,
      `  printf '%s ' ${q(t.askSh)}; read -r ans`,
      '  case "$ans" in y|Y)',
      '    for p in chrome chromium chromium-browser google-chrome brave brave-browser microsoft-edge firefox opera vivaldi-bin; do pkill -TERM -x "$p" >/dev/null 2>&1; done',
      '    sleep 3',
      ...(url ? [`    (xdg-open '${url}' >/dev/null 2>&1 &)`] : []),
      `    ;; *) echo ${q(t.manual)} ;;`, '  esac',
      `elif [ "$tried" = 1 ]; then echo ${q(t.fail)}; echo ${q(t.ff)}; exit 1; else echo ${q(t.none)}; exit 1; fi`,
      `echo ${q(t.ff)}`];
    return { name: 'horizoncraft-trust-linux.sh', type: 'application/x-sh', body: lines.join('\n') + '\n' };
  }
  return null;
}

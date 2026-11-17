FROM node:22-alpine
# nftables и iptables нужны режиму TUN: ими панель настраивает перехват трафика сервера
RUN apk add --no-cache tzdata unzip nftables iptables tar
WORKDIR /app
# package-lock.json закрепляет точные версии и контрольные суммы зависимостей: сборка ставит ровно то, что проверено.
# Звёздочка оставляет сборку рабочей, если файла нет (обновление из старой версии панели, которая его не копирует).
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
COPY server ./server
COPY public ./public
EXPOSE 8088
CMD ["node", "server/index.js"]

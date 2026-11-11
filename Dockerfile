FROM node:22-alpine
# nftables и iptables нужны режиму TUN: ими панель настраивает перехват трафика сервера
RUN apk add --no-cache tzdata unzip nftables iptables tar
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server ./server
COPY public ./public
EXPOSE 8088
CMD ["node", "server/index.js"]

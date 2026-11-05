FROM node:22-alpine
RUN apk add --no-cache tzdata unzip
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server ./server
COPY public ./public
EXPOSE 8088
CMD ["node", "server/index.js"]

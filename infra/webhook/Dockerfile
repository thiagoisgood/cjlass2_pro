FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# 创建日志目录
RUN mkdir -p /app/logs

EXPOSE 9000

CMD ["node", "server.js"]

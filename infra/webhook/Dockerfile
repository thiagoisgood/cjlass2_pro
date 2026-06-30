FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# 创建日志目录
RUN mkdir -p /app/logs

EXPOSE 9000

CMD ["node", "server.js"]

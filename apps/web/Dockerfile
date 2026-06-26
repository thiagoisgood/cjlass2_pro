FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --audit=false --fund=false
COPY packages/shared packages/shared
COPY apps/web apps/web
ARG VITE_API_BASE_URL=http://127.0.0.1:3001/api/v1
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build -w @cjlass2/shared && npm run build -w @cjlass2/web

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --omit=dev --audit=false --fund=false
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/web/dist apps/web/dist
EXPOSE 5173
CMD ["npm", "run", "preview", "-w", "@cjlass2/web", "--", "--host", "0.0.0.0"]

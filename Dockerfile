# syntax=docker/dockerfile:1

FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
# better-sqlite3 找不到對應平台的預編譯檔時要自己編，需要編譯器
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
	&& rm -rf /var/lib/apt/lists/*

# 先裝套件，只有 lockfile 變了才會重跑這層
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY . .
# 環境變數都是選填（src/env.ts），build 時不用給假值；真正的值在執行時由 docker-compose 帶入
RUN pnpm build

# 拿掉開發用套件，只留執行時需要的（better-sqlite3、three），已編好的原生模組會保留
RUN pnpm install --frozen-lockfile --prod

# ---- runtime ----
# 跟 build 用同一個 base image：跨 stage 複製 node_modules（含原生模組）要平台一致，不要換成 alpine
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3100
ENV HOST=0.0.0.0
EXPOSE 3100

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/package.json ./package.json

# 資料表在第一次連線時自動建立（db/schema.sql 已經打包進 build），不用另外跑 migration
CMD ["node", "build/index.js"]
